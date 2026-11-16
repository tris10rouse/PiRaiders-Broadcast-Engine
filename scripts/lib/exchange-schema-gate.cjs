'use strict';
// Detached structural schema gate only. Successful schemas never imply V1-V20,
// accepted content, timing eligibility, playable assets, cache or output arming.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {rewriteDefaultContains}=require('./exchange-schema-rewrite.cjs');
const BASE='https://schemas.piraiders.invalid/exchange/';
const KINDS=Object.freeze(['selection','current','feed','catalog']);
const DIR=path.join(__dirname,'exchange-schemas');
const RULES=new Set(['type','required','additionalProperties','const','enum','pattern','format','minLength','maxLength','minimum','maximum','minItems','maxItems','uniqueItems','anyOf','oneOf','allOf','not','if']);
function failed(code,kind,rules=[]){return Object.freeze({ok:false,code,...(KINDS.includes(kind)?{kind}:{}),ready:false,semanticValidation:'pending',rules:Object.freeze(rules)});}
function readSchemas(){
 const provenance=JSON.parse(fs.readFileSync(path.join(DIR,'provenance.json'),'utf8')),out={};
 if(provenance.contract!=='draft0.3.1'||provenance.schemas.length!==4)throw Error('SCHEMA_SOURCE_MISMATCH');
 for(const kind of KINDS){
  const record=provenance.schemas.find(value=>value.kind===kind),bytes=fs.readFileSync(path.join(DIR,kind+'.schema.json'));
  if(!record||record.id!==BASE+kind+'.schema.json'||bytes.length!==record.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==record.sourceSha256)throw Error('SCHEMA_SOURCE_MISMATCH');
  const schema=JSON.parse(bytes);if(schema.$id!==record.id)throw Error('SCHEMA_SOURCE_MISMATCH');out[kind]=schema;
 }
 return out;
}
function loadSchemas(){try{return readSchemas();}catch{throw Error('SCHEMA_SOURCE_MISMATCH');}}
function initializeGate(){
 const Ajv2020=require('ajv/dist/2020'),addFormats=require('ajv-formats');
 if(require('ajv/package.json').version!=='8.20.0'||require('ajv-formats/package.json').version!=='3.0.1')throw Error('SCHEMA_BACKEND_VERSION');
 const ajv=new Ajv2020({strictSchema:true,strictTypes:false,strictTuples:false,allErrors:false,ownProperties:true,coerceTypes:false,useDefaults:false,removeAdditional:false,validateFormats:true});
 ajv.addKeyword({keyword:'x-contract',schemaType:'string',valid:true});
 addFormats(ajv,{mode:'full',formats:['date-time']});
 const sources=loadSchemas();let total=0;
 for(const kind of KINDS){const rewritten=rewriteDefaultContains(sources[kind]);total+=rewritten.rewrittenContains;ajv.addSchema(rewritten.schema);}
 if(total!==3)throw Error('SCHEMA_REWRITE_SCOPE');
 const validators=Object.fromEntries(KINDS.map(kind=>[kind,ajv.getSchema(BASE+kind+'.schema.json')]));
 if(Object.values(validators).some(value=>typeof value!=='function'))throw Error('SCHEMA_SOURCE_MISMATCH');
 return Object.freeze({validate(kind,value){
  if(!KINDS.includes(kind))return failed('SCHEMA_KIND_INVALID');
  try{const validate=validators[kind];if(!validate(value)){const rules=[...new Set((validate.errors||[]).slice(0,16).map(error=>RULES.has(error.keyword)?error.keyword:'schemaRule'))];return failed('SCHEMA_INVALID',kind,rules);}}
  catch{return failed('SCHEMA_INPUT_INVALID',kind);}
  return Object.freeze({ok:true,code:'SCHEMA_VALID',kind,ready:false,semanticValidation:'pending'});
 },snapshot:()=>Object.freeze({contract:'draft0.3.1',ajv:'8.20.0',formats:'3.0.1/full-date-time',rewrittenContains:total,ready:false,semanticValidation:'pending'})});
}
function createExchangeSchemaGate(){try{return initializeGate();}catch(error){const safe=new Set(['SCHEMA_SOURCE_MISMATCH','SCHEMA_BACKEND_VERSION','SCHEMA_REWRITE_SCOPE']);throw Error(safe.has(error?.message)?error.message:'SCHEMA_BACKEND_UNAVAILABLE');}}
module.exports={createExchangeSchemaGate,loadSchemas};
