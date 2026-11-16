'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Ajv=require('ajv/dist/2020');
const {rewriteDefaultContains}=require('../scripts/lib/exchange-schema-rewrite.cjs');
const {createExchangeSchemaGate,loadSchemas}=require('../scripts/lib/exchange-schema-gate.cjs');
const {fixtures}=require('./exchange-fixtures.cjs');
test('pinned Ajv defect reproduces in both modes and equivalent rewrite retains valid and invalid branches',()=>{
 const eligibility=loadSchemas().selection.$defs.eligibility,schema={type:'array',items:eligibility},data=[{eligible:false,reasonCodes:['FINISHED']},{eligible:true,reasonCodes:[]}];
 for(const allErrors of [false,true]){
  const original=new Ajv({strict:false,allErrors}).compile(schema);assert.equal(original(data),false,'PINNED_CONTAINS_BUG_MUST_REPRODUCE');
  const alone=new Ajv({strict:false,allErrors}).compile(eligibility);for(const item of data)assert.equal(alone(item),true);
  const fixed=new Ajv({strict:false,allErrors}).compile(rewriteDefaultContains(schema).schema);assert.equal(fixed(data),true);assert.equal(fixed([...data].reverse()),true);
  for(const invalid of [[{eligible:true,reasonCodes:['FINISHED']}],[{eligible:false,reasonCodes:[]}],[...data,{eligible:true,reasonCodes:['CANCELLED']}]])assert.equal(fixed(invalid),false);
 }
});
test('all source rules remain present, exactly three default contains change, and schemas are not mutated',()=>{
 const sources=loadSchemas(),before=JSON.stringify(sources);let changed=0;
 for(const schema of Object.values(sources)){const result=rewriteDefaultContains(schema);changed+=result.rewrittenContains;assert.equal(result.schema.$id,schema.$id);assert.equal(result.schema.$schema,schema.$schema);assert.deepEqual(result.schema.required,schema.required);}
 assert.equal(changed,3);assert.equal(JSON.stringify(sources),before);
 const dataSchema={const:{contains:'literal data'},properties:{contains:{type:'string'}}};assert.deepEqual(rewriteDefaultContains(dataSchema).schema,dataSchema);
 for(const schema of [{contains:{},minContains:0},{contains:{},maxContains:1},{unevaluatedItems:false},{properties:{x:{unevaluatedProperties:false}}}])assert.throws(()=>rewriteDefaultContains(schema),/SCHEMA_REWRITE_SCOPE/);
});
test('four strict structural gates reject altered fields without mutating inputs or granting readiness',()=>{
 const gate=createExchangeSchemaGate(),docs=fixtures(),before=JSON.stringify(docs);
 for(const [kind,value]of Object.entries(docs)){const result=gate.validate(kind,value);assert.equal(result.ok,true,kind);assert.equal(result.ready,false);assert.equal(result.semanticValidation,'pending');assert.equal(Object.isFrozen(result),true);
  const missing=structuredClone(value);delete missing.contractVersion;assert.equal(gate.validate(kind,missing).code,'SCHEMA_INVALID');
  const extra={...value,'private-source-secret':'not allowed'};const bad=gate.validate(kind,extra);assert.equal(bad.ok,false);assert.equal(JSON.stringify(bad).includes('private-source-secret'),false);
 }
 assert.equal(JSON.stringify(docs),before);assert.equal(gate.validate('private-kind-secret',docs.feed).code,'SCHEMA_KIND_INVALID');assert.equal(JSON.stringify(gate.validate('private-kind-secret',{})).includes('private-kind-secret'),false);
 assert.equal(gate.snapshot().rewrittenContains,3);assert.equal(gate.snapshot().ready,false);
});
test('date-time format is actually enforced with independent calendar, leap and offset boundary vectors',()=>{
 const gate=createExchangeSchemaGate(),feed=fixtures().feed;
 // Expected outcomes derived from RFC3339 calendar/hour/minute/offset rules;
 // these do not claim Chicago/DST/event-time semantic acceptance.
 const valid=['2024-02-29T23:59:59Z','2000-02-29T00:00:00+00:00','2026-01-01T00:00:00-06:00','2026-01-01t12:34:56.123z','2026-01-01T00:00:00+23:59','2016-12-31T23:59:60Z'];
 const invalid=['2023-02-29T00:00:00Z','1900-02-29T00:00:00Z','2026-04-31T00:00:00Z','2026-13-01T00:00:00Z','2026-00-01T00:00:00Z','2026-01-00T00:00:00Z','2026-01-01T24:00:00Z','2026-01-01T00:60:00Z','2026-01-01T00:00:61Z','2026-01-01T00:00:00+24:00','2026-01-01T00:00:00+00:60','2026-01-01T00:00:00','private-not-a-date'];
 for(const createdAt of valid)assert.equal(gate.validate('feed',{...feed,createdAt}).ok,true,createdAt);
 for(const createdAt of invalid){const result=gate.validate('feed',{...feed,createdAt});assert.equal(result.ok,false,createdAt);assert.ok(result.rules.includes('format'));assert.equal(result.ready,false);}
});
test('schema validity explicitly leaves cross-file fingerprints, calendar semantics and output authorization pending',()=>{
 const docs=fixtures(),gate=createExchangeSchemaGate();docs.selection.event.eventDate='2026-02-30';
 // eventDate is a schema pattern only. A later calendar/V1-V20 validator must
 // reject this even though its shape and current structural schema match.
 const result=gate.validate('selection',docs.selection);assert.equal(result.ok,true);assert.equal(result.ready,false);assert.equal(result.semanticValidation,'pending');
 docs.current.generationSequence=9007199254740992;assert.equal(gate.validate('current',docs.current).ok,false);
 docs.feed.epoch=-1;assert.equal(gate.validate('feed',docs.feed).ok,false);
});

test('actual bounded filesystem capture feeds all four structural validators without granting readiness',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
 const {createExchangeMetadataReader}=require('../scripts/lib/exchange-metadata-reader.cjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders schema capture '));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const docs=fixtures(),tuple=docs.selection.identityTuple;
 const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
 const selectionId='sel_'+digest(JSON.stringify(tuple)).slice(0,32);
 docs.selection.selectionId=docs.current.selectionId=selectionId;
 docs.current.manifestPath='selections/'+selectionId+'/generations/'+docs.current.generation+'/manifest.json';
 const manifest=Buffer.from(JSON.stringify(docs.selection));docs.current.manifestSha256=digest(manifest);
 const descriptor=Object.fromEntries(['selectionId','identityTuple','generation','generationSequence','manifestPath','manifestSha256','playbackFingerprint','manifestState','metadataFingerprint'].map(key=>[key,docs.current[key]]));
 docs.catalog.events=[{...docs.selection.event,eventType:'Synthetic',homeSchool:'Synthetic',venue:'Synthetic',playbackArea:'Stadium Playback',boardOnly:false,eventBoard:{...docs.selection.board},selections:[{...descriptor,origin:'event',targetBoardKey:tuple[2],displayLabel:'synthetic',templateButtonKey:null,labelShared:false,occurrenceCount:0}]}];
 for(const [relative,bytes]of [['feed.json',Buffer.from(JSON.stringify(docs.feed))],['catalog.json',Buffer.from(JSON.stringify(docs.catalog))],['selections/'+selectionId+'/current.json',Buffer.from(JSON.stringify(docs.current))],[docs.current.manifestPath,manifest]]){const file=path.join(root,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
 const reader=createExchangeMetadataReader({root,binding:{feedId:docs.feed.feedId,epoch:1,identityTuple:tuple}});t.after(()=>reader.close());
 const captured=await reader.capture();assert.equal(captured.ok,true);assert.equal(captured.ready,false);assert.equal(Object.getPrototypeOf(captured.pin.manifest),null);
 const gate=createExchangeSchemaGate();for(const [kind,value]of [['feed',captured.pin.feed],['catalog',captured.pin.catalog],['current',captured.pin.current],['selection',captured.pin.manifest]]){const result=gate.validate(kind,value);assert.equal(result.ok,true,kind+':'+result.code);assert.equal(result.ready,false);assert.equal(result.semanticValidation,'pending');}
 // A schema-valid envelope still has deliberately uncomputed fingerprints and
 // missing event times. It cannot be promoted into a playable/armed candidate.
 assert.equal(reader.lastPin(),captured.pin);assert.equal(captured.pin.ready,false);assert.equal(captured.pin.manifest.event.timing.operatingWindow,null);
});
