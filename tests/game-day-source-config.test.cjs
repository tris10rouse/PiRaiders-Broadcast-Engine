'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {loadGameDayMachineConfig,isGameDayMachineConfig,createLocalEventCatalog}=require('../scripts/lib/game-day-catalog.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
async function fixture(t){
  const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders source machine ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const file=path.join(parent,'machine.json');
  const raw={schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:path.join(parent,'catalog'),
    mediaRoot:path.join(parent,'offline Drive'),cacheRoot:path.join(parent,'cache'),runtimeRoot:path.join(parent,'runtime'),
    caspar:{executable:path.join(parent,'components','casparcg.exe'),cwd:path.join(parent,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}},
    source:{providerId:'approved-feed',journalDirectory:'private/journal',journalStoreId:crypto.randomUUID(),
      approvalDirectory:'private/approvals',approvalStoreId:crypto.randomUUID(),expectedCanonicalRoot:path.join(parent,'offline Drive'),
      binding:{feedId:crypto.randomUUID(),epoch:1}}};
  async function load(value=raw){await fs.writeFile(file,JSON.stringify(value));return loadGameDayMachineConfig(file,{appRoot:parent,nodeExecutable:process.execPath});}
  return{parent,file,raw,load};
}
test('strict source machine config retains explicit identities and does not contact or initialize source/private stores',async t=>{
  const f=await fixture(t),originals=new Map();let forbidden=0;
  const blocked=[f.raw.mediaRoot,path.join(f.parent,'private'),f.raw.cacheRoot,f.raw.runtimeRoot,f.raw.catalogDirectory];
  for(const name of ['stat','lstat','realpath','open','opendir','mkdir','writeFile']){
    const original=fs[name];originals.set(name,original);fs[name]=async(file,...args)=>{
      if(typeof file==='string'&&blocked.some(root=>file===root||file.startsWith(root+path.sep))){forbidden++;throw Error('UNAVAILABLE_SOURCE_OR_STORE');}
      return original.call(fs,file,...args);
    };
  }
  try{
    const machine=await f.load();assert.equal(forbidden,0);assert.equal(isGameDayMachineConfig(machine),true);
    assert.equal(isGameDayMachineConfig({...machine}),false);assert.equal(isGameDayMachineConfig(null),false);
    assert.ok(Object.isFrozen(machine.source)&&Object.isFrozen(machine.source.binding));
    assert.equal(machine.source.journalDirectory,path.join(f.parent,'private','journal'));
    assert.equal(machine.source.approvalDirectory,path.join(f.parent,'private','approvals'));
    assert.equal(machine.source.expectedCanonicalRoot,f.raw.source.expectedCanonicalRoot);
    assert.deepEqual(machine.source.binding,f.raw.source.binding);
  }finally{for(const[name,original]of originals)fs[name]=original;}
  await assert.rejects(fs.stat(path.join(f.parent,'private')),{code:'ENOENT'});
});
test('an opt-in source machine cannot silently fall back to the local lexical catalog',async t=>{
  const f=await fixture(t),machine=await f.load();
  assert.throws(()=>createLocalEventCatalog(machine),{code:'MACHINE_CONFIG_INVALID'});
});
test('legacy loader and local catalog construction retain their established path',async t=>{
  const f=await fixture(t),raw=copy(f.raw);delete raw.source;
  const machine=await f.load(raw);assert.equal(Object.hasOwn(machine,'source'),false);assert.doesNotThrow(()=>createLocalEventCatalog(machine));
});
test('source identities and retained canonical root are strict data',async t=>{
  const f=await fixture(t);
  for(const mutate of [
    x=>x.source=null,x=>x.source.providerId='Unsafe Provider',x=>x.source.providerId='x'.repeat(65),
    x=>x.source.journalStoreId='not-a-uuid',x=>x.source.approvalStoreId=x.source.journalStoreId,
    x=>x.source.binding.feedId='unknown',x=>x.source.binding.epoch=0,x=>x.source.binding.epoch=1.5,x=>x.source.binding.epoch=1000000,
    x=>x.source.expectedCanonicalRoot='relative/source',x=>x.source.expectedCanonicalRoot=f.parent+path.sep+'a'+path.sep+'..'+path.sep+'b',
    x=>x.source.binding.extra=true,x=>x.source.approve=true,x=>delete x.source.journalStoreId,
    x=>x.source.expectedCanonicalRoot=x.cacheRoot,x=>x.source.approvalDirectory=f.file,
    x=>x.source.journalDirectory=path.join(f.parent,'config','spx.json')
  ]){const raw=copy(f.raw);mutate(raw);await assert.rejects(f.load(raw),{code:'MACHINE_CONFIG_INVALID'});}
});
test('all six named roots reject pairwise overlap without examining the mount',async t=>{
  const f=await fixture(t),keys=['mediaRoot','cacheRoot','runtimeRoot','catalogDirectory','source.journalDirectory','source.approvalDirectory'];
  function get(x,key){return key.split('.').reduce((a,k)=>a[k],x);}
  function set(x,key,value){const fields=key.split('.'),last=fields.pop();fields.reduce((a,k)=>a[k],x)[last]=value;}
  for(const from of keys)for(const into of keys){if(from===into)continue;const raw=copy(f.raw);let target=get(raw,into);if(!path.isAbsolute(target))target=path.join(f.parent,target);set(raw,from,target);await assert.rejects(f.load(raw),{code:'MACHINE_CONFIG_INVALID'});}
  const raw=copy(f.raw);raw.source.approvalDirectory=path.join(raw.cacheRoot,'nested');await assert.rejects(f.load(raw),{code:'MACHINE_CONFIG_INVALID'});
});
test('retained canonical source spelling cannot contain machine or SPX config through a different alias',async t=>{
  const f=await fixture(t),canonical=path.join(f.parent,'canonical-source');await fs.mkdir(canonical);
  for(const kind of ['machine','spx'])await t.test(kind,async()=>{
    const raw=copy(f.raw);raw.mediaRoot=path.join(f.parent,'source-alias');raw.source.expectedCanonicalRoot=canonical;
    raw.spxConfigFile=kind==='spx'?'canonical-source/spx.json':'config/spx.json';
    const file=kind==='machine'?path.join(canonical,'machine.json'):f.file;
    await fs.writeFile(file,JSON.stringify(raw));
    await assert.rejects(loadGameDayMachineConfig(file,{appRoot:f.parent,nodeExecutable:process.execPath}),{code:'MACHINE_CONFIG_INVALID'});
  });
});
