'use strict';
// Independent oracle is a test tool only, never a Windows runtime dependency.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const Ajv=require('ajv/dist/2020');
const {rewriteDefaultContains}=require('../scripts/lib/exchange-schema-rewrite.cjs');
const {loadSchemas}=require('../scripts/lib/exchange-schema-gate.cjs');
const oracle=path.resolve(__dirname,'../tests/schema-oracle.py');
function compare(original,cases){
 const rewritten=rewriteDefaultContains(original).schema;
 const reference=JSON.parse(execFileSync('python3',[oracle],{input:JSON.stringify({original,rewritten,cases}),encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024}));
 assert.deepEqual(reference.rewritten,reference.original,'INDEPENDENT_SCHEMA_EQUIVALENCE');
 for(const allErrors of [false,true]){const validate=new Ajv({strict:false,allErrors}).compile(rewritten);assert.deepEqual(cases.map(value=>!!validate(value)),reference.original,'AJV_MATCHES_INDEPENDENT_ORIGINAL');}
 return cases.length;
}
const eligibility=loadSchemas().selection.$defs.eligibility,labels=['CANCELLED','FINISHED','TENTATIVE'];
let reasonSets=[[]],level=[[]];for(let size=1;size<=3;size++){level=level.flatMap(items=>labels.map(label=>[...items,label]));reasonSets.push(...level);}
const atoms=reasonSets.flatMap(reasonCodes=>[true,false].map(eligible=>({eligible,reasonCodes}))).concat([null,false,0,'private string',{},[],{eligible:true},{reasonCodes:[]},{eligible:1,reasonCodes:[]},{eligible:true,reasonCodes:null},{eligible:true,reasonCodes:['UNKNOWN']},{eligible:true,reasonCodes:[],extra:1}]);
const cases=[[],...atoms.map(value=>[value]),...atoms.flatMap(a=>atoms.map(b=>[a,b]))];
const transitions=[{eligible:false,reasonCodes:['FINISHED']},{eligible:false,reasonCodes:['CANCELLED']},{eligible:true,reasonCodes:[]},{eligible:true,reasonCodes:['TENTATIVE']}];
for(const a of transitions)for(const b of transitions)for(const c of transitions)for(const d of transitions)cases.push([a,b,c,d]);
let comparisons=compare({type:'array',items:eligibility},cases),sites=0;
function walk(value){if(Array.isArray(value)){for(const item of value)walk(item);return;}if(!value||typeof value!=='object')return;if(Object.hasOwn(value,'contains')){
 const atoms=[null,false,1,'FINISHED',{},[],{code:'LIMIT_EXCEEDED',detail:'assets'},{code:'LIMIT_EXCEEDED',detail:'other'},'CANCELLED','TENTATIVE'];
 const inputs=[...atoms,...atoms.map(a=>[a]),...atoms.flatMap(a=>atoms.map(b=>[a,b]))];comparisons+=compare({contains:value.contains},inputs);sites++;
 }for(const child of Object.values(value))walk(child);}
walk(loadSchemas().selection);assert.equal(sites,3);
const report={event:'schema-rewrite-oracle-passed',contract:'draft0.3.1',ajv:require('ajv/package.json').version,oracle:'Python jsonschema Draft202012Validator',formatsCheckedByOracle:false,containsSites:sites,independentComparisons:comparisons,ajvAllErrorsModes:[false,true],schemaClauseDisabled:false};
const evidence=path.resolve(__dirname,'../build/exchange-schema-equivalence');fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
