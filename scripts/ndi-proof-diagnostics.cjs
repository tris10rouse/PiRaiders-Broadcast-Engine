'use strict';
// Disposable proof diagnostics: fixed categories only, never native arguments,
// paths, stderr, assertion value diffs or private presentation capabilities.
const assert=require('node:assert/strict');
function fixedFailure(error){
  const message=error instanceof assert.AssertionError?error.message.split('\n',1)[0]:error?.message;
  return typeof message==='string'&&/^[A-Z_][A-Z_0-9]{0,79}$/.test(message)?message:'ASSERTION_OR_COMPONENT_FAILED';
}
function systemFailure(error){
  return ['ETIMEDOUT','ENOENT','EACCES','EPERM','EINVAL','ENOBUFS'].includes(error?.code)?error.code:null;
}
// Fixed vocabulary for an uncoded failure: what kind of thing failed, never its
// message, command, path or output. A child killed at its timeout (execFile)
// carries no errno code, only killed:true; execFileSync reports ETIMEDOUT.
function failureKind(error){
  if(!error||(typeof error!=='object'&&typeof error!=='function'))return 'NON_ERROR';
  if(error instanceof assert.AssertionError)return 'ASSERTION';
  if(error.killed===true)return 'CHILD_KILLED';
  const system=systemFailure(error);if(system)return system;
  if(Number.isSafeInteger(error.status)||Number.isSafeInteger(error.code))return 'CHILD_EXIT';
  if(error instanceof SyntaxError)return 'PARSE';
  if(error instanceof TypeError||error instanceof RangeError||error instanceof ReferenceError)return 'PROGRAM';
  return 'OTHER';
}
module.exports={fixedFailure,systemFailure,failureKind};
