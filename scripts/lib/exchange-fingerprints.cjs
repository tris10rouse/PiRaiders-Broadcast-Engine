'use strict';
// Draft0.3.1 RFC8785 serialization restricted to its safe-integer domain.
// Hash computation only: never semantic acceptance, content readiness or arming.
const crypto=require('node:crypto');
const LIMIT=1048576,MAX_NODES=300000,MAX_DEPTH=32;
function invalid(){throw Error('FINGERPRINT_INPUT_INVALID');}
function text(value){if(typeof value!=='string'||value.length>LIMIT)invalid();for(let i=0;i<value.length;i++){const unit=value.charCodeAt(i);if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))invalid();}else if(unit>=0xdc00&&unit<=0xdfff)invalid();}return value;}
function record(value){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();const descriptors=Object.getOwnPropertyDescriptors(value);for(const key of Reflect.ownKeys(descriptors)){if(typeof key!=='string'||!descriptors[key].enumerable||!Object.hasOwn(descriptors[key],'value'))invalid();text(key);}return descriptors;}
function array(value){if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>MAX_NODES||Reflect.ownKeys(value).length!==value.length+1)invalid();const out=[];for(let i=0;i<value.length;i++){const entry=Object.getOwnPropertyDescriptor(value,String(i));if(!entry||!entry.enumerable||!Object.hasOwn(entry,'value'))invalid();out.push(entry.value);}return out;}
function encode(value){let size=0,nodes=0;const chunks=[],ancestors=new WeakSet();
 function add(part){size+=Buffer.byteLength(part,'utf8');if(size>LIMIT)invalid();chunks.push(part);}
 function visit(item,depth){if(++nodes>MAX_NODES||depth>MAX_DEPTH)invalid();if(item===null){add('null');return;}if(typeof item==='boolean'){add(item?'true':'false');return;}if(typeof item==='string'){add(JSON.stringify(text(item)));return;}if(typeof item==='number'){if(!Number.isSafeInteger(item))invalid();add(JSON.stringify(item));return;}if(typeof item!=='object'||ancestors.has(item))invalid();ancestors.add(item);
  if(Array.isArray(item)){const values=array(item);add('[');for(let i=0;i<values.length;i++){if(i)add(',');visit(values[i],depth+1);}add(']');}
  else{const entries=record(item),keys=Object.keys(entries).sort();add('{');for(let i=0;i<keys.length;i++){if(i)add(',');add(JSON.stringify(keys[i]));add(':');visit(entries[keys[i]].value,depth+1);}add('}');}ancestors.delete(item);
 }visit(value,0);return chunks.join('');
}
function safe(action){try{return action();}catch{invalid();}}
function canonicalExchangeJSON(value){return safe(()=>encode(value));}
function digest(value){return crypto.createHash('sha256').update(value,'utf8').digest('hex');}
function selectionId(tuple){return safe(()=>{const values=array(tuple);if(values.length!==5||values.some(value=>typeof value!=='string'))invalid();for(const value of values)text(value);return'sel_'+digest(encode(values)).slice(0,32);});}
function selectionFingerprints(manifest){return safe(()=>{
 // Validate JSON domain/bounds even for root fields excluded from metadata hash.
 encode(manifest);const fields=record(manifest),value=name=>{if(!Object.hasOwn(fields,name))invalid();return fields[name].value;};
 const state=value('manifestState');text(state);const assets=array(value('assets')),occurrences=array(value('occurrences')),byKey=new Map();
 for(const asset of assets){const fields=record(asset),key=fields.assetKey?.value,sha=fields.sha256?.value;if(typeof key!=='string'||byKey.has(key)||typeof sha!=='string'||!/^[0-9a-f]{64}$/.test(sha))invalid();byKey.set(key,sha);}
 const rows=occurrences.map(occurrence=>{const fields=record(occurrence),key=fields.occurrenceKey?.value,assetKey=fields.assetKey?.value,problem=fields.problem?.value;text(key);let sha=null,code=null;if(assetKey!==null){if(typeof assetKey!=='string'||!byKey.has(assetKey))invalid();sha=byKey.get(assetKey);}if(problem!==null){const detail=record(problem);code=detail.code?.value;text(code);}return[key,sha,code];});
 const excluded=new Set(['generation','generationSequence','generatedAt','playbackFingerprint','metadataFingerprint']),metadata=Object.create(null);for(const [key,entry]of Object.entries(fields))if(!excluded.has(key))metadata[key]=entry.value;
 return Object.freeze({scope:'fingerprint-computation',ready:false,semanticValidation:'pending',playbackFingerprint:digest(encode({state,occurrences:rows})),metadataFingerprint:digest(encode(metadata))});
});}
module.exports={canonicalExchangeJSON,selectionId,selectionFingerprints};
