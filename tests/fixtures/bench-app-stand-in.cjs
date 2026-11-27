'use strict';
// Q-032, Linux tests only: a stand-in for scripts/piraiders-app.cjs in the
// bench test. Same arguments (<machine file> --no-browser, from app/), same
// controller-available line, and the real Game Day web adapter and source
// service on the bench's SPX port; a synthetic runtime stands in for Caspar
// (the real entry needs Windows). It closes on the same signals and on the
// end of its parent's channel, through the same helpers as the real entry.
// BENCH_STAND_IN picks a misbehaviour for a test; BENCH_STAND_IN_PID_FILE
// receives its process id so a test can see it is gone.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const express=require('express'),session=require('express-session'),exphbs=require('express-handlebars');
const {createGameDayWeb}=require('../../scripts/lib/game-day-web.cjs');
const {bindShutdownSignals,bindParentDisconnect}=require('../../scripts/lib/shutdown-signals.cjs');
const VIEWS=path.join(__dirname,'..','..','views'),MODE=process.env.BENCH_STAND_IN||'ok';

function syntheticRuntime(){
  return async(profile,options)=>{
    const prepared=await options.preparedMedia.initial({privateRoots:options.privateRoots});
    const slideCount=prepared.deck.slides.length;let state='prepared',index=null,mode='auto';
    return{candidateAdmissionToken:()=>options.preparedMedia.admissionToken(),
      start:async()=>{state=MODE==='never-ready'?'starting':'ready';},
      close:async()=>{state='closed';options.preparedMedia.close();},
      snapshot:()=>({preparing:false,state,ready:state==='ready',windowAllowed:true,index,mode,slideCount}),
      dispatch:async action=>{
        if(MODE==='stuck-slide')return{ok:true};
        if(action==='launch')index=0;else if(action==='next')index=(index+1)%slideCount;else if(action==='previous')index=(index-1+slideCount)%slideCount;
        else if(action==='manual'||action==='auto')mode=action;else if(action==='stop')index=null;
        return{ok:true};
      }};
  };
}
async function main(){
  const args=process.argv.slice(2);
  if(process.env.BENCH_STAND_IN_PID_FILE)fs.writeFileSync(process.env.BENCH_STAND_IN_PID_FILE,String(process.pid));
  if(MODE==='refuse-start'){console.error('APP_PORT_BUSY');process.exitCode=1;return;}
  if(args.length!==2||args[1]!=='--no-browser')throw Error('APP_OPTIONS_INVALID');
  const appRoot=process.cwd(),machineFile=args[0],machine=JSON.parse(fs.readFileSync(machineFile,'utf8'));
  const configFile=path.join(appRoot,machine.spxConfigFile),port=JSON.parse(fs.readFileSync(configFile,'utf8')).general.port;
  global.config={general:{username:'',password:''}};
  const app=express();app.engine('handlebars',exphbs.engine({extname:'.handlebars'}));app.set('view engine','handlebars');app.set('views',VIEWS);
  const web=createGameDayWeb({port,appRoot,machineFile,configFile,runtimeFactory:syntheticRuntime()});
  app.use(web.guard);app.use(session({secret:'bench-stand-in',resave:false,saveUninitialized:false}));app.use(web.router);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  let stopping=null;
  const shutdown=()=>{stopping??=(async()=>{await web.close();server.closeAllConnections?.();await new Promise(r=>server.close(r));})();return stopping;};
  bindShutdownSignals(process,shutdown);
  if(MODE!=='ignore-close')bindParentDisconnect(process,shutdown);
  else{process.on('disconnect',()=>{});setInterval(()=>{},1000);}
  console.log(JSON.stringify({component:'piraiders-app',event:'controller-available',url:'http://127.0.0.1:'+port+'/game-day',browserOpened:false}));
}
main().catch(error=>{console.error(/^[A-Z_]+$/.test(error?.message||'')?error.message:'APP_START_FAILED');process.exitCode=1;});
