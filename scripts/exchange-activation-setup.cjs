'use strict';
// BE-006 item 5b part 4: the setup steps of the Windows exchange activation
// proof, kept apart from the Windows script so Linux tests run the very same
// steps. It runs the operator's setup command (scripts/piraiders-setup.cjs)
// as its own process, exactly as an operator would, and checks its answers:
// the first run sets up both private stores, the second changes nothing, and
// --pin-offline (app closed) pins the one approved, prepared button.
//
// Only the command's fixed-vocabulary answer is kept (steps, codes, counts):
// never its other output. Proof and test use only; synthetic data only.
const {execFile}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');

function fail(code,extra){throw Object.assign(Error(code),{code},extra);}
const FIXED=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// The answer reduced to its fixed parts: {ok, step, code, done} where done
// holds words or (for offline) counts. Anything else makes it null.
function fixedAnswer(text){
  let value;try{value=JSON.parse(String(text).trim());}catch{return null;}
  if(!value||typeof value!=='object'||typeof value.ok!=='boolean'||typeof value.step!=='string'||!FIXED.test(value.step))return null;
  if(value.code!==null&&(typeof value.code!=='string'||!FIXED.test(value.code)))return null;
  if(!value.done||typeof value.done!=='object'||Array.isArray(value.done))return null;
  const done={};
  for(const [key,v] of Object.entries(value.done)){
    if(!FIXED.test(key))return null;
    if(key==='offline'){
      if(!v||typeof v!=='object'||Array.isArray(v))return null;
      const counts={};for(const [k,n] of Object.entries(v)){if(!FIXED.test(k)||!Number.isSafeInteger(n)||n<0)return null;counts[k]=n;}
      done.offline=counts;
    }else if(typeof v==='string'&&FIXED.test(v))done[key]=v;else return null;
  }
  return{ok:value.ok,step:value.step,code:value.code,done};
}

// Runs `node scripts/piraiders-setup.cjs --machine <file> [--pin-offline]`
// from appRoot. Answers {exitCode, answer} (answer null when unreadable).
function runSetupCommand(machineFile,{appRoot,pin=false,nodeExecutable=process.execPath,timeoutMs=120000}={}){
  return new Promise((resolve,reject)=>{
    if(typeof machineFile!=='string'||!path.isAbsolute(machineFile)||typeof appRoot!=='string'||!path.isAbsolute(appRoot)||typeof pin!=='boolean')return reject(Object.assign(Error('SETUP_OPTIONS_INVALID'),{code:'SETUP_OPTIONS_INVALID'}));
    const args=[path.join(appRoot,'scripts','piraiders-setup.cjs'),'--machine',machineFile,...(pin?['--pin-offline']:[])];
    execFile(nodeExecutable,args,{cwd:appRoot,timeout:timeoutMs,windowsHide:true,shell:false,maxBuffer:65536,encoding:'utf8'},(error,stdout)=>{
      if(error&&(error.killed||typeof error.code!=='number'))return reject(Object.assign(Error('SETUP_COMMAND_FAILED'),{code:'SETUP_COMMAND_FAILED'}));
      resolve({exitCode:error?error.code:0,answer:fixedAnswer(stdout)});
    });
  });
}

function refused(code,result){
  const a=result&&result.answer;
  fail(code,{answerCode:a&&typeof a.code==='string'?a.code:null,exitCode:result&&Number.isInteger(result.exitCode)?result.exitCode:null});
}
function stores(result){return{journal:result.answer.done.journal,approvals:result.answer.done.approvals};}
function passed(result){
  const a=result&&result.answer;
  return !!a&&result.exitCode===0&&a.ok===true&&a.step==='done'&&a.code===null&&a.done.machine==='checked'&&a.done.source==='direct'&&a.done.feed==='checked';
}

// First run: both stores made now. Second run: both there, nothing changed.
function checkSetupTwice(first,second){
  if(!passed(first)||first.answer.done.journal!=='initialized'||first.answer.done.approvals!=='initialized')refused('SETUP_FIRST_RUN_UNEXPECTED',first);
  if(!passed(second)||second.answer.done.journal!=='present'||second.answer.done.approvals!=='present')refused('SETUP_SECOND_RUN_CHANGED',second);
  return{first:stores(first),second:stores(second)};
}

// --pin-offline after one online preparation: exactly the one button pinned.
function checkPinned(result){
  const a=result&&result.answer,o=a&&a.done&&a.done.offline;
  if(!passed(result)||a.done.journal!=='present'||a.done.approvals!=='present'||!o||o.pinned!==1||o.unchanged!==0||o.notPrepared!==0||o.ineligible!==0)refused('SETUP_PIN_UNEXPECTED',result);
  return{...o};
}

// Every file of both private stores with its content hash (tests: "the
// second run wrote nothing").
async function storeBytes(source){
  const out={};
  async function walk(dir,prefix){
    for(const e of(await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){
      const file=path.join(dir,e.name),name=prefix+'/'+e.name;
      if(e.isDirectory())await walk(file,name);else out[name]=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    }
  }
  await walk(source.journalDirectory,'journal');await walk(source.approvalDirectory,'approvals');
  return out;
}

module.exports={runSetupCommand,checkSetupTwice,checkPinned,storeBytes,fixedAnswer};
