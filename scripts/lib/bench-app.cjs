'use strict';
// Q-032 (part of Q-024, the one-click bench test): the running application
// for the bench test's app steps. It starts the app's own entry the way
// Launch-PiRaiders.cmd does (scripts/piraiders-app.cjs <machine file>
// --no-browser, from app/), with one difference: an IPC channel, so the bench
// can close the app (it disconnects the channel; the app then closes what it
// owns, scripts/lib/shutdown-signals.cjs) and so the app closes itself if
// the bench ends in any way. On Ctrl+C in the shared console the app gets
// Ctrl+C too and closes itself.
//
// The client talks to the app's own Game Day routes over loopback with the
// page's session cookie and CSRF token, as the page does. Answers are read
// for fixed codes only; nothing here prints a path, id or name.
const path=require('node:path'),http=require('node:http'),{fork}=require('node:child_process');
const {assertPortFree}=require('../piraiders-app.cjs');

const FIXED=/^[A-Z][A-Z0-9_]{0,63}$/;
function fail(code,extra){throw Object.assign(Error(code),{code},extra);}
const sleep=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Object.assign(Error('INTERRUPTED'),{code:'INTERRUPTED'}));
  const done=()=>{clearTimeout(timer);reject(Object.assign(Error('INTERRUPTED'),{code:'INTERRUPTED'}));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',done);resolve();},ms);
  signal?.addEventListener('abort',done,{once:true});
});
// Polls `check` until it answers true, bounded; `code` on timeout.
async function until(check,code,timeoutMs,{signal,intervalMs=250,now=Date.now}={}){
  const end=now()+timeoutMs;
  for(;;){
    if(signal?.aborted)fail('INTERRUPTED');
    if(await check())return;
    if(now()>=end)fail(code);
    await sleep(intervalMs,signal);
  }
}

// One loopback request; the answer's JSON (or null) and status. Bounded.
function request(port,url,{method='GET',headers={},json,timeoutMs=60000}={}){
  return new Promise(resolve=>{
    const body=json===undefined?undefined:JSON.stringify(json);
    const req=http.request({hostname:'127.0.0.1',port,path:url,method,agent:false,timeout:timeoutMs,
      headers:{Host:'127.0.0.1:'+port,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{
      const chunks=[];let size=0;
      res.on('data',c=>{size+=c.length;if(size<=4<<20)chunks.push(c);});
      res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');let value=null;try{value=JSON.parse(text);}catch{}
        resolve({status:res.statusCode,value,text,headers:res.headers});});
      // A response cut off (timeout, app gone) answers no status; a promise resolves once.
      res.on('error',()=>resolve({status:null,value:null,text:'',headers:{}}));
      res.on('close',()=>resolve({status:null,value:null,text:'',headers:{}}));
    });
    req.on('timeout',()=>req.destroy());
    req.on('error',()=>resolve({status:null,value:null,text:'',headers:{}}));
    req.end(body);
  });
}
// The Game Day page's session and CSRF token, then {get, post} as the page
// sends them (same origin, its token). Every answer's text is kept in
// `texts` for the caller's privacy check.
async function gameDayClient(port,{timeoutMs=60000}={}){
  const origin='http://127.0.0.1:'+port,page=await request(port,'/game-day',{timeoutMs});
  const token=page.status===200&&/name="piraiders-csrf" content="([a-f0-9]{64})"/.exec(page.text);
  const cookieHeader=page.headers['set-cookie'],cookie=Array.isArray(cookieHeader)&&cookieHeader.length?String(cookieHeader[0]).split(';')[0]:null;
  if(!token||!cookie)fail('GAME_DAY_PAGE_UNAVAILABLE',{routeStatus:Number.isInteger(page.status)?page.status:null});
  const texts=[];
  const keep=r=>{texts.push(r.text);return{status:r.status,value:r.value};};
  return{texts,
    get:async url=>keep(await request(port,url,{headers:{Cookie:cookie},timeoutMs})),
    post:async(url,json)=>keep(await request(port,url,{method:'POST',json,timeoutMs,
      headers:{Origin:origin,Cookie:cookie,'X-PiRaiders-CSRF':token[1],'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'}}))};
}

// Starts the app and waits, bounded, for its controller-available line for
// the expected URL. Answers a handle; a refusal carries the app's own fixed
// code (its one stderr line) when it printed one.
async function startApp({appRoot,machineFile,url,entry=path.join(appRoot,'scripts','piraiders-app.cjs'),env=process.env,timeoutMs=60000,signal,spawnApp=fork}){
  const child=spawnApp(entry,[machineFile,'--no-browser'],{cwd:appRoot,env,execPath:process.execPath,execArgv:[],windowsHide:true,serialization:'json',stdio:['ignore','pipe','pipe','ipc']});
  const handle={child,codes:new Set(),ready:false,exited:false,exit:null};
  handle.closed=new Promise(resolve=>{
    child.once('exit',(code,sig)=>{handle.exited=true;handle.exit={code,signal:sig};resolve(handle.exit);});
    child.once('error',()=>{handle.exited=true;handle.exit={code:null,signal:null};resolve(handle.exit);});
  });
  // A spawn error is answered through `closed`; it is never thrown.
  child.on('error',()=>{});
  let out=Buffer.alloc(0),total=0;
  child.stdout.on('data',chunk=>{total+=chunk.length;if(total>65536)return;out=Buffer.concat([out,chunk]);
    for(let end;(end=out.indexOf('\n'))>=0;){const line=out.subarray(0,end).toString('utf8').trim();out=out.subarray(end+1);let v;try{v=JSON.parse(line);}catch{continue;}
      if(v&&v.component==='piraiders-app'&&v.event==='controller-available'&&v.url===url&&v.browserOpened===false)handle.ready=true;}});
  let err='';
  child.stderr.on('data',chunk=>{err=(err+chunk.toString('utf8')).slice(-4096);for(const line of err.split(/\r?\n/))if(FIXED.test(line.trim()))handle.codes.add(line.trim());});
  try{
    await until(()=>{if(handle.exited)fail([...handle.codes][0]||'APP_START_EXIT');return handle.ready;},'APP_START_TIMEOUT',timeoutMs,{signal,intervalMs:100});
  }catch(error){await closeApp(handle).catch(()=>{});throw error;}
  return handle;
}

// Closes the app: the channel is disconnected (the app closes what it owns
// and exits); if it has not exited within the bound it is ended, and the
// close fails. Then the SPX port must be free.
async function closeApp(handle,{exitBoundMs=15000,port}={}){
  if(!handle)return{exitCode:null};
  const {child}=handle;
  if(!handle.exited){try{if(child.connected)child.disconnect();}catch{}}
  let timer;const timedOut=await Promise.race([handle.closed.then(()=>false),new Promise(r=>{timer=setTimeout(()=>r(true),exitBoundMs);})]);clearTimeout(timer);
  if(timedOut){
    // Ended: asked first, then forced; either way the close failed.
    const wait=ms=>{let t;return Promise.race([handle.closed.then(()=>true),new Promise(r=>{t=setTimeout(()=>r(false),ms);})]).finally(()=>clearTimeout(t));};
    try{child.kill();}catch{}
    if(!(await wait(5000))){try{child.kill('SIGKILL');}catch{}
      // Never keep the bench alive on a process that cannot be ended.
      if(!(await wait(5000))){try{child.channel?.unref?.();child.unref();}catch{}fail('APP_NOT_ENDED');}}
    fail('APP_CLOSE_TIMEOUT');
  }
  if(port!==undefined){
    let free=false;const end=Date.now()+10000;
    while(!free&&Date.now()<end){try{await assertPortFree(port);free=true;}catch{await new Promise(r=>setTimeout(r,250));}}
    if(!free)fail('APP_PORT_BUSY_AFTER_CLOSE');
  }
  return{exitCode:handle.exit.code};
}

module.exports={startApp,closeApp,gameDayClient,until};
