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
