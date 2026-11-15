'use strict';
const {EventEmitter}=require('node:events');

// One private owned-process generation. Native stdout/stderr are consumed here,
// never forwarded to logs: Caspar's command echoes can contain private URLs.
class CasparConsole extends EventEmitter{
  constructor(child,{timeoutMs=10000,maxLineBytes=16384,maxReplyBytes=256*1024}={}){
    super();
    if(!child?.stdin?.write||!child?.stdin?.end||!child?.stdout?.on||!child?.stderr?.on||!child?.on||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||!Number.isInteger(maxLineBytes)||maxLineBytes<128||maxLineBytes>65536||!Number.isInteger(maxReplyBytes)||maxReplyBytes<maxLineBytes||maxReplyBytes>1024*1024)throw Error('CONSOLE_OPTIONS');
    Object.assign(this,{child,timeoutMs,maxLineBytes,maxReplyBytes});this.pending=null;this.closed=false;this.sequence=0;this.buffer=Buffer.alloc(0);
    child.stdout.on('data',bytes=>this.consume(bytes));
    child.stderr.on('data',()=>{});
    child.stdout.on('error',()=>this.fail('CONSOLE_OUTPUT'));
    child.stderr.on('error',()=>this.fail('CONSOLE_OUTPUT'));
    child.stdin.on('error',()=>this.fail('CONSOLE_INPUT'));
    child.on('error',()=>this.fail('CONSOLE_PROCESS'));
    child.on('close',()=>this.fail('CONSOLE_CLOSED'));
    child.stdout.on('end',()=>this.fail('CONSOLE_OUTPUT_CLOSED'));
  }
  request(command,{status=202}={}){
    if(typeof command!=='string'||!command.length||Buffer.byteLength(command,'utf16le')>8192||/[\x00-\x1f\x7f]/.test(command)||!Number.isInteger(status)||status<200||status>299)return Promise.reject(Error('CONSOLE_COMMAND'));
    if(this.closed)return Promise.reject(Error('CONSOLE_CLOSED'));
    if(this.pending)return Promise.reject(Error('CONSOLE_BUSY'));
    if(this.sequence>=0xffffffff){this.fail('CONSOLE_SEQUENCE');return Promise.reject(Error('CONSOLE_SEQUENCE'));}
    const id='p'+(++this.sequence);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.fail('CONSOLE_TIMEOUT'),this.timeoutMs);
      this.pending={id,status,resolve,reject,timer,bytes:0};
      try{this.child.stdin.write(Buffer.from('REQ '+id+' '+command+'\r\n','utf16le'),error=>{if(error)this.fail('CONSOLE_INPUT');});}
      catch{this.fail('CONSOLE_INPUT');}
    });
  }
  consume(chunk){
    if(this.closed)return;
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    if(this.pending){this.pending.bytes+=bytes.length;if(this.pending.bytes>this.maxReplyBytes)return this.fail('CONSOLE_REPLY_LIMIT');}
    // Work in bounded pieces: a chunk may contain many short log lines.
    let offset=0;
    while(offset<bytes.length&&!this.closed){
      const end=bytes.indexOf(10,offset),limit=end<0?bytes.length:end;
      if(this.buffer.length+limit-offset>this.maxLineBytes)return this.fail('CONSOLE_LINE_LIMIT');
      this.buffer=Buffer.concat([this.buffer,bytes.subarray(offset,limit)]);
      if(end<0)return;
      // Windows CRT Unicode text output can expand AMCP CRLF to CRCRLF.
      // Accept only the two documented forms; extra control bytes still fail.
      let line=this.buffer;for(let n=0;n<2&&line[line.length-1]===13;n++)line=line.subarray(0,line.length-1);
      this.buffer=Buffer.alloc(0);offset=end+1;
      const text=line.toString('utf8');
      if(!text.startsWith('#RES '))continue;
      const match=/^#RES (p[0-9]{1,10}) ([0-9]{3})(?: [^\x00-\x1f\x7f]*)?$/.exec(text);
      if(!match||!this.pending||match[1]!==this.pending.id)return this.fail('CONSOLE_PROTOCOL');
      const p=this.pending;
      if(Number(match[2])!==p.status)return this.fail('CONSOLE_REJECTED');
      this.pending=null;clearTimeout(p.timer);p.resolve({status:p.status});
    }
  }
  fail(code){
    if(this.closed)return;this.closed=true;this.buffer=Buffer.alloc(0);
    const pending=this.pending;this.pending=null;
    if(pending){clearTimeout(pending.timer);pending.reject(Error(code));}
    // EOF terminates containment independently of a blocked native command.
    try{this.child.stdin.end();}catch{}
    this.emit('fault',{code});
  }
  close(){this.fail('CONSOLE_CLOSED');}
}
module.exports={CasparConsole};
