'use strict';
// BE-006 item 5b part 1: the operator's setup step for one source machine.
//
// Given a loader-made source machine, it checks the source root and the feed,
// then sets up the two private stores exactly once: the journal with its
// confirmed feed binding, and an empty approval list. Run again, it finds
// both and changes nothing. It never reinitializes, repairs or replaces a
// store that is there: a store it cannot open as this machine's is refused
// with the store's own code, and the operator decides what to do with it.
// A media root reached through a link is allowed when it resolves to the
// retained canonical spelling (5b-2); the answer says which it was. Not here:
// offline pins and cached startup (5b-3), and any screen. It reads the
// source, it never writes it.
const fs=require('node:fs/promises'),path=require('node:path');
const {isGameDayMachineConfig}=require('./game-day-catalog.cjs');
const {createExchangeCatalogReader}=require('./exchange-metadata-reader.cjs');
const {createExchangeJournal}=require('./exchange-journal.cjs');
const {createExchangeApprovalStore}=require('./exchange-approval-store.cjs');

function frozen(value){if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;}
function refused(step,code,done){return frozen({ok:false,step,code,done});}
function comparable(value){return process.platform==='win32'?value.toLowerCase():value;}

// Steps, in order. Each answer names only steps and codes: no paths, no ids.
//   machine  the machine file is a source machine (loaded by the caller)
//   source   'direct' (the media root is the retained canonical spelling)
//            or 'linked' (it reaches that spelling through a link or alias)
//   feed     feed and catalog read and validated with the retained binding
//   journal  'initialized' (made now, binding confirmed), 'bound' (it was
//            there without a binding; binding confirmed now) or 'present'
//   approvals 'initialized' or 'present'
async function setupSourceMachine(machine,trusted={}){
  const done={};
  if(!isGameDayMachineConfig(machine)||!machine.source)return refused('machine','SETUP_MACHINE_NOT_SOURCE',done);
  const s=machine.source,realpath=trusted.realpath??fs.realpath;
  const journal=trusted.journal??createExchangeJournal(),approvals=trusted.approvalStore??createExchangeApprovalStore();
  done.machine='checked';

  let actual;try{actual=await realpath(machine.mediaRoot);}catch{return refused('source','SETUP_SOURCE_UNAVAILABLE',done);}
  if(typeof actual!=='string'||comparable(path.resolve(actual))!==comparable(s.expectedCanonicalRoot))return refused('source','SETUP_SOURCE_ROOT_MISMATCH',done);
  done.source=comparable(path.resolve(machine.mediaRoot))===comparable(s.expectedCanonicalRoot)?'direct':'linked';

  // Read from the canonical spelling just proven equal; the reader refuses
  // links inside it. REBIND_REQUIRED means the folder holds another feed.
  const reader=createExchangeCatalogReader({root:s.expectedCanonicalRoot,binding:{feedId:s.binding.feedId,epoch:s.binding.epoch}});
  let read;try{read=await reader.captureCatalog();}finally{reader.close();}
  if(!read.ok)return refused('feed',read.code==='REBIND_REQUIRED'?'SETUP_FEED_BINDING_MISMATCH':'SETUP_FEED_'+read.code,done);
  done.feed='checked';

  const binding={feedId:s.binding.feedId,epoch:s.binding.epoch};
  let head=await journal.open(s.journalDirectory,s.journalStoreId),journalState='present';
  if(!head.ok&&head.code==='JOURNAL_MISSING'){
    try{await fs.mkdir(path.dirname(s.journalDirectory),{recursive:true,mode:0o700});}catch{return refused('journal','SETUP_JOURNAL_PARENT_FAILED',done);}
    head=await journal.initialize(s.journalDirectory,s.journalStoreId);journalState='initialized';
  }
  if(!head.ok)return refused('journal',head.code,done);
  const held=head.state.binding;
  if(held===null){
    head=await journal.append(s.journalDirectory,{expectedStoreId:s.journalStoreId,expectedRevision:head.revision,expectedHeadSha256:head.headSha256,
      event:{type:'confirm-binding',expectedRevision:head.revision,expectedBinding:null,binding,confirm:true}});
    if(!head.ok)return refused('journal',head.code,done);
    if(journalState==='present')journalState='bound';
  }else if(held.feedId!==binding.feedId||held.epoch!==binding.epoch)return refused('journal','SETUP_JOURNAL_BINDING_MISMATCH',done);
  done.journal=journalState;

  let list=await approvals.open(s.approvalDirectory,s.approvalStoreId),approvalState='present';
  if(!list.ok&&list.code==='APPROVAL_MISSING'){
    try{await fs.mkdir(path.dirname(s.approvalDirectory),{recursive:true,mode:0o700});}catch{return refused('approvals','SETUP_APPROVALS_PARENT_FAILED',done);}
    list=await approvals.initialize(s.approvalDirectory,s.approvalStoreId);approvalState='initialized';
  }
  if(!list.ok)return refused('approvals',list.code,done);
  done.approvals=approvalState;
  return frozen({ok:true,step:'done',code:null,done});
}

module.exports={setupSourceMachine};
