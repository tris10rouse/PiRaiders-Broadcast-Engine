'use strict';
// Real Windows proof fixture: independently contained persistent service and
// timed sender tree. Blocking this actual owner leaves both lifetime pipes open.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSupervisedProcess,createNativeWindowPolicy}=require(process.argv[2]);
async function main(){
const stateFile=process.argv[3],end=Date.now()+8000;
const productionWindow=await createNativeWindowPolicy({start:new Date(Date.now()-1000).toISOString(),end:new Date(end).toISOString(),prewarmMinutes:0});
const persistent=spawnSupervisedProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{});
const sender=spawnSupervisedProcess(process.execPath,[path.join(__dirname,'job-service.cjs'),'root',stateFile,'hold'],{}, {
 productionWindow
});
for(const child of [persistent,sender])child.once('error',()=>process.exit(3));
sender.once('exit',code=>process.send({senderExit:code}));
const timer=setInterval(()=>{try{const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));clearInterval(timer);process.send({ready:true,persistentHostPid:persistent.pid,senderHostPid:sender.pid,end,...state});}catch{}},10);
process.on('message',message=>{if(message?.block===true)process.send({blocked:true},()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000));});
setTimeout(()=>process.exit(2),30000);

}
main().catch(()=>process.exit(3));
