'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixedFailure,systemFailure}=require('../scripts/ndi-proof-diagnostics.cjs');
test('native proof diagnostics preserve a labeled assertion without its sensitive value diff',()=>{
  const privateURL='http://127.0.0.1:1234/private#piraiders='+ 'A'.repeat(43);
  let error;try{assert.equal(privateURL,'other-private-value','OWNED_ROOT_IDENTITY');}catch(value){error=value;}
  assert.equal(fixedFailure(error),'OWNED_ROOT_IDENTITY');
  assert.equal(fixedFailure(Error('PROBE_RECEIVER_DISCONNECTED')),'PROBE_RECEIVER_DISCONNECTED');
  for(const message of [privateURL,'C:\\private\\node.exe','receiver: '+privateURL,'LABEL\n'+privateURL,'A'.repeat(81)]){
    assert.equal(fixedFailure(Error(message)),'ASSERTION_OR_COMPONENT_FAILED');
    assert.equal(fixedFailure(new assert.AssertionError({message,actual:privateURL,expected:'private',operator:'equal'})),message.startsWith('LABEL\n')?'LABEL':'ASSERTION_OR_COMPONENT_FAILED');
  }
  assert.equal(fixedFailure(null),'ASSERTION_OR_COMPONENT_FAILED');
});
test('native proof system diagnostics expose only known OS failure codes',()=>{
  for(const code of ['ETIMEDOUT','ENOENT','EACCES','EPERM','EINVAL','ENOBUFS']){
    const error=Object.assign(Error('private command and stderr'),{code,stdout:'private stdout',stderr:'private stderr'});
    assert.equal(systemFailure(error),code);
  }
  for(const code of [null,undefined,1,'UNKNOWN_CODE','ETIMEDOUT\nprivate','C:\\private','http://private'])assert.equal(systemFailure({code}),null);
  assert.equal(systemFailure(null),null);
});
test('uncoded proof failures get a fixed kind from real child failures, never their message',async()=>{
  const {failureKind}=require('../scripts/ndi-proof-diagnostics.cjs');
  const {execFileSync,execFile}=require('node:child_process');
  const secret='C:\\private\\exchange http://127.0.0.1:1/p#piraiders='+'A'.repeat(43);
  const hang=['-e','setTimeout(()=>{},60000)',secret];
  let sync;try{execFileSync(process.execPath,hang,{timeout:200,stdio:'ignore'});}catch(error){sync=error;}
  assert.equal(failureKind(sync),'ETIMEDOUT');
  const killed=await new Promise(resolve=>execFile(process.execPath,hang,{timeout:200},error=>resolve(error)));
  assert.equal(killed.code,null);assert.equal(failureKind(killed),'CHILD_KILLED');
  let exit;try{execFileSync(process.execPath,['-e','process.exit(3)',secret],{stdio:'ignore'});}catch(error){exit=error;}
  assert.equal(failureKind(exit),'CHILD_EXIT');
  const async=await new Promise(resolve=>execFile(process.execPath,['-e','process.exit(4)',secret],error=>resolve(error)));
  assert.equal(failureKind(async),'CHILD_EXIT');
  let assertion;try{assert.equal(secret,'other');}catch(error){assertion=error;}
  assert.equal(failureKind(assertion),'ASSERTION');
  let parse;try{JSON.parse('{'+secret);}catch(error){parse=error;}
  assert.equal(failureKind(parse),'PARSE');
  assert.equal(failureKind(new TypeError(secret)),'PROGRAM');
  assert.equal(failureKind(Error(secret)),'OTHER');
  assert.equal(failureKind(null),'NON_ERROR');assert.equal(failureKind(secret),'NON_ERROR');
  for(const value of [sync,killed,exit,async,assertion,parse])assert.doesNotMatch(failureKind(value),/private|piraiders|127/);
});
