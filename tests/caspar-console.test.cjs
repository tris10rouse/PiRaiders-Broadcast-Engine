'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {CasparConsole}=require('../scripts/lib/caspar-console.cjs');
// Real pipes and a synthetic peer exercise framing/failure. This is not Caspar
// or Windows evidence; the dedicated Windows workflow proves those separately.
const peer=`let pending=Buffer.alloc(0);process.stdin.on('data',b=>{pending=Buffer.concat([pending,b]);let n;while((n=pending.indexOf(Buffer.from('\\r\\n','utf16le')))>=0){const s=pending.subarray(0,n).toString('utf16le');pending=pending.subarray(n+4);const m=/^REQ (p[0-9]+) (.*)$/.exec(s);if(!m)process.exit(9);const id=m[1],cmd=m[2];if(cmd==='STALL')continue;if(cmd==='CLOSE')return process.exit();if(cmd==='BAD')process.stdout.write('#RES wrong 202 PRIVATE-SECRET\\r\\n');else if(cmd==='REJECT')process.stdout.write('#RES '+id+' 400 PRIVATE-SECRET\\r\\n');else if(cmd==='BIG')process.stdout.write('x'.repeat(20000));else if(cmd==='FLOOD')process.stdout.write(('x\\n').repeat(180000));else{process.stdout.write('native echo PRIVATE-SECRET\\r\\n#RE');setTimeout(()=>process.stdout.write('S '+id+' '+(cmd==='VERSION'?201:202)+' OK\\r\\nversion payload\\r\\n'),5);}}});process.stdin.on('end',()=>process.exit());`;
function fixture(t,options){const child=spawn(process.execPath,['-e',peer],{stdio:['pipe','pipe','pipe']});const client=new CasparConsole(child,options);t.after(()=>{client.close();child.kill();});return{child,client};}
test('console client uses UTF16 private pipes and accepts only correlated bounded status',async t=>{
  const{client}=fixture(t);assert.deepEqual(await client.request('VERSION',{status:201}),{status:201});assert.deepEqual(await client.request('PLAY 1-10 "鷹 🏴"'),{status:202});
  for(const value of ['',null,'PLAY\nKILL','PLAY\0','x'.repeat(4097)])await assert.rejects(client.request(value),/CONSOLE_COMMAND/);
  await assert.rejects(client.request('VERSION',{status:400}),/CONSOLE_COMMAND/);client.close();await assert.rejects(client.request('PLAY'),/CONSOLE_CLOSED/);
});
test('native errors, malformed/foreign replies and quotas fail closed without echoing secrets',async t=>{
  for(const [command,code]of [['BAD','CONSOLE_PROTOCOL'],['REJECT','CONSOLE_REJECTED'],['BIG','CONSOLE_LINE_LIMIT'],['FLOOD','CONSOLE_REPLY_LIMIT'],['CLOSE','CONSOLE_OUTPUT_CLOSED']]){
    const{client}=fixture(t);await assert.rejects(client.request(command),error=>error.message===code&&!error.message.includes('SECRET'));assert.equal(client.closed,true);await assert.rejects(client.request('VERSION'),/CONSOLE_CLOSED/);
  }
});
test('stalled commands bound pending work and close independently; late replies cannot resurrect it',async t=>{
  const{client,child}=fixture(t,{timeoutMs:150});const pending=client.request('STALL');await assert.rejects(client.request('VERSION'),/CONSOLE_BUSY/);await assert.rejects(pending,/CONSOLE_TIMEOUT/);assert.equal(client.closed,true);
  client.consume(Buffer.from('#RES p1 202 OK\r\n'));await assert.rejects(client.request('VERSION'),/CONSOLE_CLOSED/);assert.equal(child.stdin.writableEnded,true);
});
