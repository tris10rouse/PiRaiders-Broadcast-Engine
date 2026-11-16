'use strict';
// Detached, read-only draft0.3.1 metadata capture. NO schema/semantic acceptance,
// asset reads, cache publication, Drive writes, output integration or arming.
const fs=require('node:fs/promises');
const {constants}=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {parseExchangeJSON}=require('./exchange-json.cjs');
const LIMITS=Object.freeze({feed:65536,current:65536,catalog:5242880,manifest:1048576});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const CODES=new Set(['METADATA_INVALID','INPUT_UNAVAILABLE','INPUT_CHANGED','UNSAFE_INPUT','LIMIT_EXCEEDED','REBIND_REQUIRED','SELECTION_ABSENT','METADATA_CONFLICT','METADATA_STALE','CAPTURE_TIMEOUT','READER_BUSY','READER_CLOSED']);
const descriptorKeys=['feedId','epoch','selectionId','identityTuple','generation','generationSequence','manifestState','playbackFingerprint','metadataFingerprint','manifestPath','manifestSha256'];
function fail(code){throw Error(code);}
function record(value,allowed,required=[]){object(value);if(![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key))||Object.values(Object.getOwnPropertyDescriptors(value)).some(item=>!Object.hasOwn(item,'value')||!item.enumerable))fail('METADATA_INVALID');return value;}
function object(value){if(!value||typeof value!=='object'||Array.isArray(value))fail('METADATA_INVALID');return value;}
function safeInteger(value,min=0,max=Number.MAX_SAFE_INTEGER){return Number.isSafeInteger(value)&&value>=min&&value<=max;}
function frozen(value){if(value&&typeof value==='object'){for(const item of Object.values(value))frozen(item);Object.freeze(value);}return value;}
function hash(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function equalDescriptor(a,b){return descriptorKeys.every(key=>key==='identityTuple'?sameTuple(a[key],b[key]):a[key]===b[key]);}
function sameTuple(a,b){return Array.isArray(a)&&Array.isArray(b)&&a.length===5&&b.length===5&&a.every((value,index)=>value===b[index]);}
function signature(stat){return[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');}
function identity(stat){return[stat.dev,stat.ino].join(':');}
function canonical(value){return process.platform==='win32'?value.toLowerCase():value;}
function within(root,file){const relative=path.relative(canonical(root),canonical(file));return !path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);}
async function noLinks(file){let cursor=path.parse(file).root;for(const segment of path.relative(cursor,file).split(path.sep).filter(Boolean)){cursor=path.join(cursor,segment);const stat=await fs.lstat(cursor,{bigint:true});if(stat.isSymbolicLink()||(cursor!==file&&!stat.isDirectory()))fail('UNSAFE_INPUT');}}
function selectedId(tuple){return'sel_'+hash(Buffer.from(JSON.stringify(tuple))).slice(0,32);}
function descriptor(raw,feedId,epoch,expected){
  object(raw);const result=Object.fromEntries(descriptorKeys.map(key=>[key,key==='feedId'?feedId:key==='epoch'?epoch:raw[key]]));
  if(result.selectionId!==expected.selectionId||!sameTuple(result.identityTuple,expected.identityTuple)||!safeInteger(result.generationSequence,1,9999999999)||!['complete','incomplete','empty','removed'].includes(result.manifestState)||![result.manifestSha256,result.playbackFingerprint,result.metadataFingerprint].every(value=>typeof value==='string'&&SHA.test(value)))fail('METADATA_INVALID');
  const match=typeof result.generation==='string'&&/^e([1-9][0-9]{0,5})-g([0-9]{10})-([0-9a-f]{12})$/.exec(result.generation);
  if(!match||Number(match[1])!==epoch||Number(match[2])!==result.generationSequence||match[3]!==result.metadataFingerprint.slice(0,12))fail('METADATA_INVALID');
  const required='selections/'+result.selectionId+'/generations/'+result.generation+'/manifest.json';if(result.manifestPath!==required)fail('UNSAFE_INPUT');
  return frozen(result);
}
function result(code,pin){return Object.freeze({ok:code==='METADATA_CAPTURED',code,ready:false,semanticValidation:'pending',...(pin?{pin}:{})});}
function createExchangeMetadataReader(options){
  record(options,['root','binding','timeoutMs'],['root','binding']);
  const {root,binding,timeoutMs=5000}=options;
  if(typeof root!=='string'||root.length>4096||/[\x00-\x1f\x7f]/.test(root)||!path.isAbsolute(root)||!safeInteger(timeoutMs,10,30000))fail('METADATA_INVALID');
  record(binding,['feedId','epoch','identityTuple'],['feedId','epoch','identityTuple']);if(typeof binding.feedId!=='string'||!UUID.test(binding.feedId)||!safeInteger(binding.epoch,1,999999)||!Array.isArray(binding.identityTuple)||Object.getPrototypeOf(binding.identityTuple)!==Array.prototype||binding.identityTuple.length!==5||Reflect.ownKeys(binding.identityTuple).length!==6||Array.from({length:5},(_,index)=>Object.getOwnPropertyDescriptor(binding.identityTuple,String(index))).some(item=>!item||!Object.hasOwn(item,'value')||!item.enumerable)||binding.identityTuple.some(value=>typeof value!=='string'||value.length>255||/[\x00-\x1f\x7f]/.test(value))||!/^\d{4}-\d{4}$/.test(binding.identityTuple[0])||!binding.identityTuple[1]||!['event','season'].includes(binding.identityTuple[3])||!binding.identityTuple[4]||binding.identityTuple[3]==='season'&&!binding.identityTuple[2])fail('METADATA_INVALID');
  const expected=frozen({feedId:binding.feedId,epoch:binding.epoch,identityTuple:[...binding.identityTuple],selectionId:selectedId(binding.identityTuple)}),inputRoot=path.resolve(root);
  let flight=null,lastPin=null,closed=false,lastCode=null;
  async function capturePhysical(run){
    function active(){if(closed)fail('READER_CLOSED');if(!run.valid||performance.now()>=run.deadline){run.valid=false;fail('CAPTURE_TIMEOUT');}}
    active();await noLinks(inputRoot);const rootStat=await fs.lstat(inputRoot,{bigint:true});if(!rootStat.isDirectory())fail('UNSAFE_INPUT');const rootReal=await fs.realpath(inputRoot),rootIdentity=identity(rootStat);
    async function readDocument(relative,kind){
      active();const file=path.join(inputRoot,...relative.split('/'));
      if(!within(inputRoot,file))fail('UNSAFE_INPUT');await noLinks(file);if(!within(rootReal,await fs.realpath(file)))fail('UNSAFE_INPUT');active();
      const before=await fs.lstat(file,{bigint:true});if(!before.isFile())fail('UNSAFE_INPUT');if(before.size>BigInt(LIMITS[kind]))fail('LIMIT_EXCEEDED');
      let handle;
      try{
        handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));active();if(signature(await handle.stat({bigint:true}))!==signature(before))fail('INPUT_CHANGED');
        const bytes=Buffer.alloc(LIMITS[kind]+1);let length=0;
        for(;;){active();const part=await handle.read(bytes,length,bytes.length-length,length);length+=part.bytesRead;if(length>LIMITS[kind])fail('LIMIT_EXCEEDED');if(!part.bytesRead)break;}
        active();await noLinks(file);const after=await fs.lstat(file,{bigint:true});if(!after.isFile()||signature(after)!==signature(before)||signature(await handle.stat({bigint:true}))!==signature(before)||BigInt(length)!==before.size||!within(rootReal,await fs.realpath(file))||identity(await fs.lstat(inputRoot,{bigint:true}))!==rootIdentity||canonical(await fs.realpath(inputRoot))!==canonical(rootReal))fail('INPUT_CHANGED');
        const delivered=bytes.subarray(0,length);return{value:parseExchangeJSON(delivered),sha256:hash(delivered)};
      }finally{await handle?.close();}
    }
    const feed=await readDocument('feed.json','feed');object(feed.value);
    if(feed.value.contractVersion!=='piraiders-event-feed/1'||typeof feed.value.feedId!=='string'||!UUID.test(feed.value.feedId)||!safeInteger(feed.value.epoch,1,999999)||feed.value.publisher!=='PiRaiders Scheduler')fail('METADATA_INVALID');
    if(feed.value.feedId!==expected.feedId||feed.value.epoch!==expected.epoch)fail('REBIND_REQUIRED');
    const catalog=await readDocument('catalog.json','catalog');object(catalog.value);
    if(catalog.value.contractVersion!=='piraiders-event-catalog/1'||catalog.value.feedId!==expected.feedId||catalog.value.epoch!==expected.epoch||!safeInteger(catalog.value.catalogSequence,1,9999999999)||!Array.isArray(catalog.value.events)||catalog.value.events.length>800)fail('METADATA_INVALID');
    if(catalog.value.schoolYear!==expected.identityTuple[0])fail('SELECTION_ABSENT');
    let selected=null;
    for(const event of catalog.value.events){object(event);if(!Array.isArray(event.selections)||event.selections.length>100)fail('METADATA_INVALID');for(const selection of event.selections){object(selection);if(selection.selectionId===expected.selectionId){if(selected)fail('METADATA_INVALID');selected=descriptor(selection,expected.feedId,expected.epoch,expected);if(event.eventKey!==expected.identityTuple[1])fail('METADATA_INVALID');}}}
    if(!selected)fail('SELECTION_ABSENT');
    let current=null;
    try{current=await readDocument('selections/'+expected.selectionId+'/current.json','current');}catch(error){if(error.code!=='ENOENT')throw error;}
    if(current){object(current.value);if(current.value.contractVersion!=='piraiders-event-current/1'||current.value.feedId!==expected.feedId||current.value.epoch!==expected.epoch)fail('METADATA_INVALID');const next=descriptor(current.value,expected.feedId,expected.epoch,expected);if(next.generationSequence===selected.generationSequence&&!equalDescriptor(next,selected))fail('METADATA_CONFLICT');if(next.generationSequence>=selected.generationSequence)selected=next;}
    const manifest=await readDocument(selected.manifestPath,'manifest');if(manifest.sha256!==selected.manifestSha256)fail('METADATA_INVALID');object(manifest.value);
    if(manifest.value.contractVersion!=='piraiders-event-selection/1')fail('METADATA_INVALID');
    for(const key of descriptorKeys.filter(key=>!['manifestPath','manifestSha256'].includes(key))){if(key==='identityTuple'?!sameTuple(manifest.value[key],selected[key]):manifest.value[key]!==selected[key])fail('METADATA_INVALID');}
    const pin=frozen({ready:false,semanticValidation:'pending',scope:'transport-metadata',descriptor:selected,catalogSequence:catalog.value.catalogSequence,documentDigests:{feed:feed.sha256,catalog:catalog.sha256,current:current?.sha256||null,manifest:manifest.sha256},feed:feed.value,catalog:catalog.value,current:current?.value||null,manifest:manifest.value});
    active();if(lastPin){if(pin.catalogSequence<lastPin.catalogSequence||pin.descriptor.generationSequence<lastPin.descriptor.generationSequence)fail('METADATA_STALE');if(pin.catalogSequence===lastPin.catalogSequence&&pin.documentDigests.catalog!==lastPin.documentDigests.catalog||pin.descriptor.generationSequence===lastPin.descriptor.generationSequence&&pin.documentDigests.manifest!==lastPin.documentDigests.manifest)fail('METADATA_CONFLICT');}
    return pin;
  }
  function capture(){
    if(closed)return Promise.resolve(result('READER_CLOSED'));if(flight)return Promise.resolve(result('READER_BUSY'));
    const run={valid:true,deadline:performance.now()+timeoutMs};flight=run;let timer;
    const physical=capturePhysical(run).then(pin=>{if(closed)fail('READER_CLOSED');if(!run.valid||performance.now()>=run.deadline){run.valid=false;fail('CAPTURE_TIMEOUT');}lastPin=pin;return result('METADATA_CAPTURED',pin);}).catch(error=>result(CODES.has(error.message)?error.message:['ENOENT','ENOTDIR'].includes(error.code)?'INPUT_UNAVAILABLE':error.code==='ELOOP'?'UNSAFE_INPUT':'INPUT_UNAVAILABLE')).finally(()=>{if(flight===run)flight=null;clearTimeout(timer);});
    const deadline=new Promise(resolve=>{run.cancel=()=>{clearTimeout(timer);resolve(result('READER_CLOSED'));};timer=setTimeout(()=>{run.valid=false;resolve(result('CAPTURE_TIMEOUT'));},timeoutMs);});
    return Promise.race([physical,deadline]).then(value=>{lastCode=value.code;return value;});
  }
  return Object.freeze({capture,lastPin:()=>lastPin,snapshot:()=>Object.freeze({busy:flight!==null,closed,lastCode,hasPin:lastPin!==null}),close(){closed=true;if(flight){flight.valid=false;flight.cancel();}}});
}
module.exports={createExchangeMetadataReader};
