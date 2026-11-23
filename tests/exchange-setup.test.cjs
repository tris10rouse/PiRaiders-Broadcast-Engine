'use strict';
// BE-006 item 5b part 1: the setup step and command for a source machine.
// Real loader, reader, journal and approval store on temporary folders;
// synthetic exchange documents from the activation fixture. No Windows here.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {loadGameDayMachineConfig}=require('../scripts/lib/game-day-catalog.cjs');
const {setupSourceMachine}=require('../scripts/lib/exchange-setup.cjs');
const {main}=require('../scripts/piraiders-setup.cjs');
const {createExchangeJournal}=require('../scripts/lib/exchange-journal.cjs');
const {createExchangeApprovalStore}=require('../scripts/lib/exchange-approval-store.cjs');
const {exchangeDocuments}=require('../scripts/exchange-activation-fixture.cjs');

async function tempRoot(t){const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders setup ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));return parent;}
// An app root, a synthetic exchange folder and a machine file whose private
// stores do not exist yet (not even their parent folder).
async function machineFile(t,change=raw=>raw){
  const parent=await tempRoot(t),appRoot=path.join(parent,'app'),exchange=path.join(parent,'exchange'),docs=exchangeDocuments();
  await fs.mkdir(path.join(appRoot,'config'),{recursive:true});await fs.writeFile(path.join(appRoot,'config','spx.json'),'{}');
  for(const [relative,bytes] of docs.files){const file=path.join(exchange,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
  for(const dir of ['cache','runtime','catalog'])await fs.mkdir(path.join(parent,dir));
  const raw={schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:path.join(parent,'catalog'),mediaRoot:exchange,cacheRoot:path.join(parent,'cache'),runtimeRoot:path.join(parent,'runtime'),
    caspar:{executable:path.join(appRoot,'components','casparcg.exe'),cwd:path.join(appRoot,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}},
    source:{providerId:'setup-test',journalDirectory:path.join(parent,'private','journal'),journalStoreId:crypto.randomUUID(),
      approvalDirectory:path.join(parent,'private','approvals'),approvalStoreId:crypto.randomUUID(),expectedCanonicalRoot:exchange,binding:{...docs.binding}}};
  const file=path.join(parent,'machine.json');await fs.writeFile(file,JSON.stringify(change(raw,parent)));
  return{parent,appRoot,file,raw,exchange,binding:docs.binding};
}
const load=m=>loadGameDayMachineConfig(m.file,{appRoot:m.appRoot,nodeExecutable:process.execPath});
async function exists(p){try{await fs.lstat(p);return true;}catch{return false;}}
async function listing(dir){return(await fs.readdir(dir)).sort();}

test('setup makes the journal with its binding and an empty approval list, once; a second run changes nothing',async t=>{
  const m=await machineFile(t),s=m.raw.source;
  const first=await setupSourceMachine(await load(m));
  assert.deepEqual({...first,done:{...first.done}},{ok:true,step:'done',code:null,done:{machine:'checked',source:'direct',feed:'checked',journal:'initialized',approvals:'initialized'}});
  const journal=await createExchangeJournal().open(s.journalDirectory,s.journalStoreId);
  assert.equal(journal.ok,true);assert.deepEqual({...journal.state.binding},m.binding);assert.equal(journal.revision,1);
  const approvals=await createExchangeApprovalStore().open(s.approvalDirectory,s.approvalStoreId);
  assert.equal(approvals.ok,true);assert.equal(approvals.revision,0);assert.deepEqual([...approvals.approvals],[]);
  const before=[await listing(s.journalDirectory),await listing(s.approvalDirectory)];
  const second=await setupSourceMachine(await load(m));
  assert.equal(second.ok,true);assert.deepEqual({...second.done},{machine:'checked',source:'direct',feed:'checked',journal:'present',approvals:'present'});
  assert.deepEqual([await listing(s.journalDirectory),await listing(s.approvalDirectory)],before);
});

test('the command prints steps and codes only, and its exit code says done, refused or wrong arguments',async t=>{
  const m=await machineFile(t),options={appRoot:m.appRoot,nodeExecutable:process.execPath};
  for(const argv of [[],['--machine'],['--machine','relative.json'],['--other',m.file],['--machine',m.file,'extra']]){
    const r=await main(argv,options);assert.equal(r.exitCode,2);assert.equal(r.answer.code,'SETUP_USAGE');}
  const bad=await main(['--machine',path.join(m.parent,'absent.json')],options);
  assert.equal(bad.exitCode,1);assert.equal(bad.answer.code,'MACHINE_CONFIG_INVALID');
  const done=await main(['--machine',m.file],options);
  assert.equal(done.exitCode,0);assert.equal(done.answer.ok,true);
  const printed=JSON.stringify(done.answer);
  for(const secret of [m.parent,m.raw.source.journalStoreId,m.raw.source.approvalStoreId,m.binding.feedId,'exchange'])assert.equal(printed.includes(secret),false,secret);
});

test('a machine file without a source is refused before anything is read',async t=>{
  const m=await machineFile(t,raw=>{const copy={...raw};delete copy.source;return copy;});
  const r=await setupSourceMachine(await load(m));
  assert.equal(r.code,'SETUP_MACHINE_NOT_SOURCE');assert.equal(r.ok,false);
  assert.equal(await exists(path.join(m.parent,'private')),false);
  // A copy of a source machine is not loader-made: refused, nothing made.
  const source=await machineFile(t);
  assert.equal((await setupSourceMachine({...(await load(source))})).code,'SETUP_MACHINE_NOT_SOURCE');
  assert.equal(await exists(path.join(source.parent,'private')),false);
});

test('an absent or redirected source root and a foreign feed make no store',async t=>{
  const absent=await machineFile(t);await fs.rm(absent.exchange,{recursive:true});
  let r=await setupSourceMachine(await load(absent));
  assert.equal(r.code,'SETUP_SOURCE_UNAVAILABLE');assert.equal(r.step,'source');assert.equal(await exists(path.join(absent.parent,'private')),false);

  const moved=await machineFile(t,(raw,parent)=>({...raw,source:{...raw.source,expectedCanonicalRoot:path.join(parent,'elsewhere')}}));
  await fs.mkdir(path.join(moved.parent,'elsewhere'));
  r=await setupSourceMachine(await load(moved));
  assert.equal(r.code,'SETUP_SOURCE_ROOT_MISMATCH');assert.deepEqual({...r.done},{machine:'checked'});assert.equal(await exists(path.join(moved.parent,'private')),false);

  const foreign=await machineFile(t,raw=>({...raw,source:{...raw.source,binding:{feedId:crypto.randomUUID(),epoch:1}}}));
  r=await setupSourceMachine(await load(foreign));
  assert.equal(r.code,'SETUP_FEED_BINDING_MISMATCH');assert.equal(r.step,'feed');assert.equal(await exists(path.join(foreign.parent,'private')),false);

  const broken=await machineFile(t);await fs.writeFile(path.join(broken.exchange,'catalog.json'),'{"not":"a catalog"}');
  r=await setupSourceMachine(await load(broken));
  assert.equal(r.step,'feed');assert.match(r.code,/^SETUP_FEED_/);assert.equal(await exists(path.join(broken.parent,'private')),false);
});

test('a store that is there but is not this machine\'s is refused, never replaced',async t=>{
  // Journal of another store id.
  const other=await machineFile(t),s=other.raw.source;
  await fs.mkdir(path.dirname(s.journalDirectory));
  assert.equal((await createExchangeJournal().initialize(s.journalDirectory,crypto.randomUUID())).ok,true);
  const beforeJournal=await listing(s.journalDirectory);
  let r=await setupSourceMachine(await load(other));
  assert.equal(r.step,'journal');assert.equal(r.code,'JOURNAL_INVALID');
  assert.deepEqual(await listing(s.journalDirectory),beforeJournal);assert.equal(await exists(s.approvalDirectory),false);

  // An empty journal folder is not "missing": refused, left empty.
  const empty=await machineFile(t);await fs.mkdir(empty.raw.source.journalDirectory,{recursive:true});
  r=await setupSourceMachine(await load(empty));
  assert.equal(r.code,'JOURNAL_INVALID');assert.deepEqual(await listing(empty.raw.source.journalDirectory),[]);

  // A journal bound to another feed.
  const bound=await machineFile(t),b=bound.raw.source,journal=createExchangeJournal();
  await fs.mkdir(path.dirname(b.journalDirectory));
  let head=await journal.initialize(b.journalDirectory,b.journalStoreId);
  head=await journal.append(b.journalDirectory,{expectedStoreId:b.journalStoreId,expectedRevision:head.revision,expectedHeadSha256:head.headSha256,
    event:{type:'confirm-binding',expectedRevision:head.revision,expectedBinding:null,binding:{feedId:crypto.randomUUID(),epoch:1},confirm:true}});
  assert.equal(head.ok,true);
  r=await setupSourceMachine(await load(bound));
  assert.equal(r.code,'SETUP_JOURNAL_BINDING_MISMATCH');assert.equal(await exists(b.approvalDirectory),false);

  // An approval list of another store id.
  const list=await machineFile(t),l=list.raw.source;
  await fs.mkdir(path.dirname(l.approvalDirectory));
  assert.equal((await createExchangeApprovalStore().initialize(l.approvalDirectory,crypto.randomUUID())).ok,true);
  const beforeList=await listing(l.approvalDirectory);
  r=await setupSourceMachine(await load(list));
  assert.equal(r.step,'approvals');assert.equal(r.code,'APPROVAL_INVALID');assert.deepEqual({...r.done}.journal,'initialized');
  assert.deepEqual(await listing(l.approvalDirectory),beforeList);
});

test('setup finishes a half-done setup: a journal without its binding, or without an approval list',async t=>{
  const m=await machineFile(t),s=m.raw.source;
  await fs.mkdir(path.dirname(s.journalDirectory));
  assert.equal((await createExchangeJournal().initialize(s.journalDirectory,s.journalStoreId)).ok,true);
  const r=await setupSourceMachine(await load(m));
  assert.equal(r.ok,true);assert.deepEqual({...r.done},{machine:'checked',source:'direct',feed:'checked',journal:'bound',approvals:'initialized'});
  const journal=await createExchangeJournal().open(s.journalDirectory,s.journalStoreId);
  assert.deepEqual({...journal.state.binding},m.binding);

  // A complete, bound journal whose approval list was never made.
  const half=await machineFile(t),h=half.raw.source;
  assert.equal((await setupSourceMachine(await load(half))).ok,true);
  await fs.rm(h.approvalDirectory,{recursive:true});
  const before=await listing(h.journalDirectory),again=await setupSourceMachine(await load(half));
  assert.equal(again.ok,true);assert.deepEqual({...again.done},{machine:'checked',source:'direct',feed:'checked',journal:'present',approvals:'initialized'});
  assert.deepEqual(await listing(h.journalDirectory),before);
});

// 5b-2: a media root reached through a link (SOURCE_MACHINE_POLICY.md ›
// Linked source root). Setup says so without a path, and the service built
// from the same machine file refreshes and reviews through it.
test('a linked media root: setup says linked, then the service refreshes and reviews through it',async t=>{
  const {createExchangeSourceService}=require('../scripts/lib/exchange-source-service.cjs');
  const m=await machineFile(t,(raw,parent)=>({...raw,mediaRoot:path.join(parent,'exchange link')}));
  await fs.symlink(m.exchange,path.join(m.parent,'exchange link'),'junction');
  const machine=await load(m);
  const r=await setupSourceMachine(machine);
  assert.equal(r.ok,true,r.code);assert.deepEqual({...r.done},{machine:'checked',source:'linked',feed:'checked',journal:'initialized',approvals:'initialized'});
  for(const secret of [m.parent,'exchange link'])assert.equal(JSON.stringify(r).includes(secret),false,'no path in the answer');
  const service=createExchangeSourceService(machine);t.after(()=>service.close());
  const refreshed=await service.refreshCatalog();
  assert.equal(refreshed.ok,true,refreshed.code);assert.equal(service.catalogState().available,true);
  const tuple=[...exchangeDocuments().identityTuple];
  const review=await service.reviewSelection(tuple);
  assert.equal(review.ok,true,review.code);assert.equal(review.approval.read,true);assert.equal(review.approval.record,null);
  // A link inside the canonical folder is still refused, alias or not.
  const catalog=path.join(m.exchange,'catalog.json'),moved=path.join(m.parent,'catalog-elsewhere.json');
  await fs.rename(catalog,moved);await fs.symlink(moved,catalog,'file');
  assert.equal((await service.refreshCatalog()).code,'UNSAFE_INPUT');
  assert.equal((await setupSourceMachine(await load(m))).code,'SETUP_FEED_UNSAFE_INPUT');
});
