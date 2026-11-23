'use strict';
// BE-006 item 5a part 3: the evidence check of the Windows exchange activation
// job. Every file the job retains is listed; a file outside the allowed names,
// or one whose bytes name the proof folder, the exchange folder or a private
// store, fails the check (and can be removed before upload).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {auditEvidence,removeViolations,privateVariants,activationPrivatePaths}=require('../scripts/proof-evidence-privacy.cjs');
const ROOT=path.join(__dirname,'..');

async function folder(t){
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders evidence ')));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const evidence=path.join(dir,'evidence');await fs.mkdir(evidence);return{dir,evidence};
}
const PROOF='D:\\a\\Engine\\build\\exchange-activation-proof',EXCHANGE=PROOF+'\\proof\\exchange',STORE=PROOF+'\\proof\\private\\approvals';
const PRIVATE=[PROOF,EXCHANGE,STORE];

test('clean synthetic evidence passes and is listed',async t=>{
  const {evidence}=await folder(t);
  await fs.writeFile(path.join(evidence,'exchange-launch-red.png'),Buffer.from([0x89,0x50,0x4e,0x47,1,2,3]));
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({event:'passed',frames:[{name:'exchange-launch-red'}]}));
  const audit=await auditEvidence(evidence,PRIVATE);
  assert.deepEqual(audit.violations,[]);
  assert.deepEqual(audit.files.map(f=>f.name),['exchange-launch-red.png','result.json']);
});

for(const [label,text] of [
  ['raw Windows path',`{"root":"${'x'} ${EXCHANGE}\\event.json"}`],
  ['JSON-escaped path',JSON.stringify({root:EXCHANGE+'\\event.json'})],
  ['forward slashes',JSON.stringify({root:STORE.split('\\').join('/')})],
  ['other letter case',JSON.stringify({root:PROOF.toUpperCase()})],
]){
  test('a retained file naming a private path fails: '+label,async t=>{
    const {evidence}=await folder(t);
    await fs.writeFile(path.join(evidence,'result.json'),text);
    const audit=await auditEvidence(evidence,PRIVATE);
    assert.deepEqual(audit.violations,[{name:'result.json',reason:'NAMES_PRIVATE_PATH'}]);
  });
}

test('a path inside binary data (UTF-16 text in a PNG) fails',async t=>{
  const {evidence}=await folder(t);
  await fs.writeFile(path.join(evidence,'frame.png'),Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0,0]),Buffer.from(EXCHANGE,'utf16le'),Buffer.from([0,9])]));
  assert.deepEqual((await auditEvidence(evidence,PRIVATE)).violations,[{name:'frame.png',reason:'NAMES_PRIVATE_PATH'}]);
});

test('names outside the allowed set fail: partial frames, other types, folders, upper case',async t=>{
  const {evidence}=await folder(t);
  await fs.writeFile(path.join(evidence,'exchange-next-green.0123abcd.partial'),'x');
  await fs.writeFile(path.join(evidence,'notes.txt'),'synthetic');
  await fs.writeFile(path.join(evidence,'Frame.png'),'x');
  await fs.mkdir(path.join(evidence,'nested'));await fs.writeFile(path.join(evidence,'nested','a.png'),'x');
  const audit=await auditEvidence(evidence,PRIVATE);
  assert.deepEqual(audit.violations,[
    {name:'Frame.png',reason:'NAME_NOT_ALLOWED'},
    {name:'exchange-next-green.0123abcd.partial',reason:'NAME_NOT_ALLOWED'},
    {name:'nested',reason:'NAME_NOT_ALLOWED'},
    {name:'notes.txt',reason:'NAME_NOT_ALLOWED'}]);
});

test('violations never carry the private text, only fixed reasons',async t=>{
  const {evidence}=await folder(t);
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({root:EXCHANGE}));
  const text=JSON.stringify(await auditEvidence(evidence,PRIVATE));
  for(const p of PRIVATE)assert.equal(text.toLowerCase().includes(p.toLowerCase()),false);
  assert.equal(text.includes('Engine'),false);
});

test('removeViolations deletes only offending entries',async t=>{
  const {evidence}=await folder(t);
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({root:STORE}));
  await fs.writeFile(path.join(evidence,'exchange-stop-black.png'),'ok');
  await fs.mkdir(path.join(evidence,'nested'));
  const removed=await removeViolations(evidence,(await auditEvidence(evidence,PRIVATE)).violations);
  assert.deepEqual(removed,2);
  assert.deepEqual((await fs.readdir(evidence)).sort(),['exchange-stop-black.png']);
  assert.deepEqual((await auditEvidence(evidence,PRIVATE)).violations,[]);
});

test('a missing evidence folder or an empty private path list is refused',async t=>{
  const {dir}=await folder(t);
  await assert.rejects(auditEvidence(path.join(dir,'missing'),PRIVATE),{code:'EVIDENCE_FOLDER_MISSING'});
  await assert.rejects(auditEvidence(dir,[]),{code:'PRIVATE_PATHS_REQUIRED'});
  await assert.rejects(auditEvidence(dir,['C:']),{code:'PRIVATE_PATH_INVALID'});
});

test('privateVariants covers both separators and JSON escaping',()=>{
  const v=privateVariants(['C:\\Proof\\Ex']);
  for(const s of ['c:\\proof\\ex','c:/proof/ex','c:\\\\proof\\\\ex'])assert.ok(v.includes(s),s);
});

test('the activation job derives its private paths from the checkout and tool records',async t=>{
  const {dir}=await folder(t);
  const tools=path.join(dir,'build','caspar-proof-tools');await fs.mkdir(tools,{recursive:true});
  await fs.writeFile(path.join(tools,'tools.json'),JSON.stringify({casparDirectory:path.join(tools,'caspar')}));
  const paths=await activationPrivatePaths(dir,tools);
  const work=path.join(dir,'build','exchange-activation-proof');
  for(const p of [work,path.join(work,'proof','exchange'),path.join(work,'proof','private'),path.join(work,'proof','cache'),path.join(work,'proof','runtime'),path.join(work,'proof','catalog'),tools,path.join(tools,'caspar')])
    assert.ok(paths.includes(p),p);
});

test('the command line fails the step on a violation and passes on clean evidence',async t=>{
  const {dir,evidence}=await folder(t);
  const tools=path.join(dir,'build','caspar-proof-tools');await fs.mkdir(tools,{recursive:true});
  await fs.writeFile(path.join(tools,'tools.json'),JSON.stringify({casparDirectory:path.join(tools,'caspar')}));
  const work=path.join(dir,'build','exchange-activation-proof');
  const run=()=>spawnSync(process.execPath,[path.join(ROOT,'scripts','proof-evidence-privacy.cjs'),'activation',evidence,dir,tools],{encoding:'utf8'});
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({ok:true}));
  let r=run();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"files":1/);
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({root:path.join(work,'proof','exchange')}));
  r=run();assert.equal(r.status,1);assert.match(r.stderr,/EVIDENCE_NAMES_PRIVATE_PATH/);
  assert.deepEqual(await fs.readdir(evidence),[],'the offending file is removed before upload');
  assert.equal((r.stdout+r.stderr).includes(dir),false,'the failure line names no path');
});

test('the Windows activation proof and its job run the check',async()=>{
  const script=await fs.readFile(path.join(ROOT,'scripts','smoke-exchange-activation-windows.cjs'),'utf8');
  assert.match(script,/auditEvidence\(evidence,privatePaths\)/);
  assert.match(script,/EVIDENCE_NAMES_PRIVATE_PATH/);
  assert.match(script,/namesPrivatePath\(\[allText,/,'the whole page text is checked before it is cut');
  assert.doesNotMatch(script,/failure-ui\.png/,'no page screenshot is retained: its pixels cannot be checked');
  const job=await fs.readFile(path.join(ROOT,'.github','workflows','full-app-proof.yml'),'utf8');
  const block=job.slice(job.indexOf('actual-exchange-activation-private-ndi:'),job.indexOf('actual-extracted-full-app-private-ndi:'));
  const check=block.indexOf('node scripts/proof-evidence-privacy.cjs activation'),upload=block.indexOf('actions/upload-artifact');
  assert.ok(check>0&&check<upload,'the check runs before the upload');
  assert.match(block.slice(block.lastIndexOf('- name:',check),check),/if: always\(\)/);
});

test('a private path with non-ASCII letters is matched (UTF-8 and UTF-16)',async t=>{
  const {evidence}=await folder(t);const accented='C:\\Users\\José\\proof';
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({p:'C:/Users/José/proof/exchange'}));
  await fs.writeFile(path.join(evidence,'frame.png'),Buffer.concat([Buffer.from([0x89,0x50]),Buffer.from(accented,'utf16le')]));
  assert.deepEqual((await auditEvidence(evidence,[accented])).violations,[{name:'frame.png',reason:'NAMES_PRIVATE_PATH'},{name:'result.json',reason:'NAMES_PRIVATE_PATH'}]);
});
