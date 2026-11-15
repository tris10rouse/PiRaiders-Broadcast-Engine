'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {ownedCaspar,privateText,startedNoEarlierThan,fixedFailure}=require('../scripts/smoke-full-app-windows.cjs');
const {JOB_HOST}=require('../scripts/lib/windows-job-process.cjs');
const host=path.win32.normalize(JOB_HOST).toLowerCase();
// Use the exact helper path; win32 normalization keeps this portable fixture absolute.
const expectedHost=host;
function row(id,parent,ticks,executable){return{ProcessId:id,ParentProcessId:parent,CreationUtcTicks:String(ticks),ExecutablePath:executable};}
function fixtures(){return[row(10,1,100,'C:\\node.exe'),row(11,10,110,expectedHost),row(12,11,120,'C:\\node.exe'),row(13,12,130,expectedHost),row(14,13,140,'C:\\caspar\\casparcg.exe'),row(15,14,150,'C:\\caspar\\cef.exe')];}
test('log scan catches the known private capability URL shape in UTF8 and UTF16 without flagging the bare template',()=>{
 const secret='A'.repeat(43),url='http://127.0.0.1:1234/templates/piraiders/slideshow/SLIDESHOW.html#piraiders='+secret;
 assert.equal(privateText(Buffer.from(url)),true);assert.equal(privateText(Buffer.from(url,'utf16le')),true);
 assert.equal(privateText(Buffer.from('SLIDESHOW.html and ordinary fixed diagnostics')),false);
 assert.equal(privateText(Buffer.from('http://127.0.0.1:1234/templates/piraiders/slideshow/SLIDESHOW.html')),false);
});
test('owned root selection fails closed for a root outside the application tree and absent roots',()=>{
 const rows=fixtures();assert.throws(()=>ownedCaspar(rows,10,'C:\\other\\casparcg.exe'),/OWNED_CASPAR_ROOT/);
 assert.equal(ownedCaspar(rows,10,'C:\\other\\casparcg.exe',{allowAbsent:true}),null);
 rows.push(row(20,1,200,'C:\\other\\casparcg.exe'));assert.throws(()=>ownedCaspar(rows,10,'C:\\other\\casparcg.exe'),/OWNED_CASPAR_ROOT/);
});
test('owned root selection refuses multiple Caspar generations and a root without the actual containment host',()=>{
 const rows=fixtures();rows.push(row(16,13,160,'C:\\caspar\\casparcg.exe'));assert.throws(()=>ownedCaspar(rows,10,'C:\\caspar\\casparcg.exe'),/OWNED_CASPAR_ROOT/);
 rows.pop();rows[3].ExecutablePath='C:\\unowned.exe';assert.throws(()=>ownedCaspar(rows,10,'C:\\caspar\\casparcg.exe'),/OWNED_CASPAR_JOB_HOST/);
});
test('owned root selection retains complete generation identities for root and CEF',()=>{
 const result=ownedCaspar(fixtures(),10,'c:\\CASPAR\\CasparCG.exe');assert.equal(result.root.ProcessId,14);assert.equal(result.host.ProcessId,13);assert.deepEqual(result.tree.map(x=>x.ProcessId),[13,14,15]);assert.equal(result.root.CreationUtcTicks,'140');
});

test('native birth-time comparison preserves100ns tick precision at the exact UTC production boundary',()=>{
 const boundary='2026-11-15T00:00:00.000Z',ticks=621355968000000000n+BigInt(Date.parse(boundary))*10000n;
 assert.equal(startedNoEarlierThan({CreationUtcTicks:String(ticks)},boundary),true);assert.equal(startedNoEarlierThan({CreationUtcTicks:String(ticks-1n)},boundary),false);assert.equal(startedNoEarlierThan({CreationUtcTicks:String(ticks+1n)},boundary),true);assert.throws(()=>startedNoEarlierThan({CreationUtcTicks:String(ticks)},'invalid'),/WINDOW_TIMESTAMP/);
});


test('fixed failure reports retain assertion labels without expected/actual or private URL diffs',()=>{
 const secret='http://127.0.0.1:1234/private#piraiders='+ 'A'.repeat(43);
 let failure;try{assert.equal(secret,'other-private-value','OWNED_CASPAR_JOB_HOST');}catch(error){failure=error;}
 assert.equal(fixedFailure(failure),'OWNED_CASPAR_JOB_HOST');
 assert.equal(fixedFailure(new assert.AssertionError({message:secret,actual:secret,expected:'other',operator:'equal'})),'ASSERTION_OR_COMPONENT');
 assert.equal(fixedFailure(Error(secret)),'ASSERTION_OR_COMPONENT');
 assert.equal(fixedFailure(Error('PROBE_FRAME_TIMEOUT')),'PROBE_FRAME_TIMEOUT');
 assert.equal(fixedFailure(Error('FIXED_HEADER\n'+secret)),'ASSERTION_OR_COMPONENT');
});


test('same-image descendants are not mistaken for additional directly contained sender roots',()=>{
 const rows=fixtures();rows[5].ExecutablePath='C:\\caspar\\casparcg.exe';
 const result=ownedCaspar(rows,10,'C:\\caspar\\casparcg.exe');
 assert.equal(result.root.ProcessId,14);assert.deepEqual(result.tree.map(row=>row.ProcessId),[13,14,15]);
});
