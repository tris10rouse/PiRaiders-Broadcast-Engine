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
module.exports={fixedFailure,systemFailure};
