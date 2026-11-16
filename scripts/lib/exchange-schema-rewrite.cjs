'use strict';
// Scoped JSON Schema applicator rewrite, not a data normalizer. The supplied
// schemas use default contains only and no unevaluated* annotation consumers.
const MAPS=new Set(['$defs','definitions','properties','patternProperties','dependentSchemas']);
const ARRAYS=new Set(['allOf','anyOf','oneOf','prefixItems']);
const SINGLE=new Set(['additionalProperties','additionalItems','items','contains','not','if','then','else','propertyNames','contentSchema']);
function clone(value){return structuredClone(value);}
function rewriteDefaultContains(schema){
 let count=0;
 function visit(value){
  if(typeof value==='boolean')return value;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('SCHEMA_REWRITE_SCOPE');
  if(Object.hasOwn(value,'unevaluatedItems')||Object.hasOwn(value,'unevaluatedProperties')||Object.hasOwn(value,'minContains')||Object.hasOwn(value,'maxContains'))throw Error('SCHEMA_REWRITE_SCOPE');
  const out={};
  for(const [key,item]of Object.entries(value)){
   if(key==='contains')continue;
   if(MAPS.has(key)){if(!item||typeof item!=='object'||Array.isArray(item))throw Error('SCHEMA_REWRITE_SCOPE');out[key]=Object.fromEntries(Object.entries(item).map(([name,entry])=>[name,visit(entry)]));}
   else if(ARRAYS.has(key)){if(!Array.isArray(item))throw Error('SCHEMA_REWRITE_SCOPE');out[key]=item.map(visit);}
   else if(SINGLE.has(key))out[key]=visit(item);
   else out[key]=clone(item); // const/enum/examples are DATA, not schemas.
  }
  if(Object.hasOwn(value,'contains')){
   count++;
   // For arrays: not(all elements fail S) iff at least one matches S.
   // For nonarrays: type:array fails, hence not(...) succeeds exactly as the
   // original ignored contains keyword does. Empty arrays still fail.
   out.allOf=[...(out.allOf||[]),{not:{type:'array',items:{not:visit(value.contains)}}}];
  }
  return out;
 }
 const rewritten=visit(schema);return Object.freeze({schema:rewritten,rewrittenContains:count});
}
module.exports={rewriteDefaultContains};
