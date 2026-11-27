'use strict';
// Q-020 (part 4 of Q-016): the app runs the CasparCG the Windows ZIP carries,
// with the renderer Q-019 chose. Design: docs/design/BUNDLED_RUNTIME.md ›
// Running the bundled Caspar.
//
// The ZIP's root holds app\ (the machine's appRoot) and runtime\ beside it.
//   gpu:      runtime\caspar\casparcg.exe, unchanged; no opengl32.dll beside
//             it, so Windows loads the graphics driver's OpenGL.
//   software: runtime-software\caspar\casparcg.exe, a mirror of
//             runtime\caspar (hard links where the volume allows them, else
//             copies) with Mesa's two x64 files beside the executable, run with
//             the fixed mesa-llvmpipe-compat profile. The mirror is made by the
//             app on this PC, outside the ZIP's runtime\ folder, so the layout
//             rule (no Mesa beside the bundled Caspar) still holds there.
//   NDI:      runtime\ndi, the folder holding Processing.NDI.Lib.x64.dll.
// Answers carry fixed codes only, never a path or a file name.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');

const SOFTWARE_PROFILE='mesa-llvmpipe-compat';
const MESA_FILES=Object.freeze(['opengl32.dll','libgallium_wgl.dll']);
const MARKER='.piraiders-software-layout.json';
const MAX_FILES=4096,MAX_DEPTH=16;
function fail(code){throw Object.assign(Error(code),{code});}

function bundledLocations(appRoot){
  if(typeof appRoot!=='string'||!path.isAbsolute(appRoot))fail('BUNDLED_CASPAR_OPTIONS_INVALID');
  const root=path.dirname(path.resolve(appRoot));
  return Object.freeze({root,caspar:path.join(root,'runtime','caspar'),mesa:path.join(root,'runtime','mesa'),
    ndi:path.join(root,'runtime','ndi'),softwareRoot:path.join(root,'runtime-software'),software:path.join(root,'runtime-software','caspar')});
}
// The machine's caspar block for the bundled Caspar and the chosen renderer.
function bundledCaspar(appRoot,renderer){
  const at=bundledLocations(appRoot);
  if(renderer==='gpu')return{executable:path.join(at.caspar,'casparcg.exe'),cwd:at.caspar};
  if(renderer==='software')return{executable:path.join(at.software,'casparcg.exe'),cwd:at.software,rendererProfile:SOFTWARE_PROFILE};
  fail('BUNDLED_CASPAR_OPTIONS_INVALID');
}

// Every regular file under dir as {rel, size, mtimeMs}; a link, a device or
// anything else that is not a regular file or a folder refuses the tree.
async function listTree(dir){
  const files=[];
  async function walk(prefix,depth){
    if(depth>MAX_DEPTH)fail('SOFTWARE_LAYOUT_SOURCE_INVALID');
    const entries=await fs.readdir(path.join(dir,...prefix),{withFileTypes:true});
    for(const entry of entries){
      const rel=[...prefix,entry.name];
      const info=await fs.lstat(path.join(dir,...rel));
      if(info.isDirectory())await walk(rel,depth+1);
      else if(info.isFile()){files.push({rel:rel.join('/'),size:info.size,mtimeMs:info.mtimeMs});if(files.length>MAX_FILES)fail('SOFTWARE_LAYOUT_SOURCE_INVALID');}
      else fail('SOFTWARE_LAYOUT_SOURCE_INVALID');
    }
  }
  const top=await fs.lstat(dir);if(!top.isDirectory())fail('SOFTWARE_LAYOUT_SOURCE_INVALID');
  await walk([],0);
  return files.sort((a,b)=>a.rel<b.rel?-1:a.rel>b.rel?1:0);
}
// What the mirror must hold: Caspar's files at their places and Mesa's two
// files beside casparcg.exe. Mesa's files never replace one of Caspar's.
async function plan(at){
  const caspar=await listTree(at.caspar);
  const names=new Set(caspar.map(f=>f.rel.toLowerCase()));
  if(!names.has('casparcg.exe')||names.has('opengl32.dll'))fail('SOFTWARE_LAYOUT_SOURCE_INVALID');
  const items=caspar.map(f=>({...f,from:path.join(at.caspar,...f.rel.split('/'))}));
  for(const name of MESA_FILES){
    if(names.has(name.toLowerCase()))fail('SOFTWARE_LAYOUT_SOURCE_INVALID');
    const from=path.join(at.mesa,name),info=await fs.lstat(from);
    if(!info.isFile()||info.size<1)fail('SOFTWARE_LAYOUT_SOURCE_INVALID');
    items.push({rel:name,size:info.size,mtimeMs:info.mtimeMs,from});
  }
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(items.map(({rel,size,mtimeMs})=>[rel,size,mtimeMs]))).digest('hex');
  return{items,fingerprint};
}
async function current(at,{items,fingerprint}){
  try{
    const marker=JSON.parse(await fs.readFile(path.join(at.software,MARKER),'utf8'));
    if(!marker||marker.schemaVersion!==1||marker.fingerprint!==fingerprint)return false;
    for(const item of items){const info=await fs.lstat(path.join(at.software,...item.rel.split('/')));if(!info.isFile()||info.size!==item.size)return false;}
    return true;
  }catch{return false;}
}
async function place(from,to,link){
  try{await link(from,to);return;}catch{}
  await fs.copyFile(from,to,fs.constants.COPYFILE_EXCL);
}

// Read-only: is the software mirror there and made from the current bundle?
// 'ready', 'missing' (absent, stale or incomplete) or 'unknown' (the bundle's
// own files cannot be read).
async function softwareLayoutState(appRoot){
  const at=bundledLocations(appRoot);
  let wanted;try{wanted=await plan(at);}catch{return'unknown';}
  return await current(at,wanted)?'ready':'missing';
}
// Makes the software mirror when it is absent or was made from other files.
// Answers {layout:'ready'} (already current) or {layout:'built'}; any failure
// is SOFTWARE_LAYOUT_FAILED and leaves no half-made mirror in its place.
async function ensureSoftwareCaspar(appRoot,{link=fs.link}={}){
  const at=bundledLocations(appRoot);
  let wanted;try{wanted=await plan(at);}catch{fail('SOFTWARE_LAYOUT_FAILED');}
  if(await current(at,wanted))return Object.freeze({layout:'ready'});
  let building,retired=null;
  try{
    await fs.mkdir(at.softwareRoot,{recursive:true});
    building=await fs.mkdtemp(path.join(at.softwareRoot,'.building-'));
    for(const item of wanted.items){
      const to=path.join(building,...item.rel.split('/'));
      await fs.mkdir(path.dirname(to),{recursive:true});
      await place(item.from,to,link);
      const info=await fs.lstat(to);if(!info.isFile()||info.size!==item.size)fail('SOFTWARE_LAYOUT_FAILED');
    }
    await fs.writeFile(path.join(building,MARKER),JSON.stringify({schemaVersion:1,fingerprint:wanted.fingerprint})+'\n',{flag:'wx'});
    // The old mirror is moved aside before the new one takes its name, so a
    // refusal (a file held open on Windows) leaves the old one whole.
    try{await fs.lstat(at.software);retired=path.join(at.softwareRoot,'.retired-'+crypto.randomBytes(8).toString('hex'));await fs.rename(at.software,retired);}
    catch(error){if(retired)throw error;}
    try{await fs.rename(building,at.software);}catch(error){await fs.rename(retired,at.software).catch(()=>{});retired=null;throw error;}
    building=null;
    return Object.freeze({layout:'built'});
  }catch{fail('SOFTWARE_LAYOUT_FAILED');}
  finally{
    if(building)await fs.rm(building,{recursive:true,force:true}).catch(()=>{});
    if(retired)await fs.rm(retired,{recursive:true,force:true}).catch(()=>{});
  }
}

// What Diagnose and the Game Day page say about the Caspar this machine runs:
// from the bundle (renderer gpu or software, as chosen) or the machine file's
// own Caspar (software when it names the Mesa profile, else not known).
function casparReport(machine){
  if(machine.casparFrom==='bundle')return Object.freeze({from:'bundle',renderer:machine.graphics.renderer});
  return Object.freeze({from:'machine-file',renderer:machine.caspar.rendererProfile===SOFTWARE_PROFILE?'software':'unknown'});
}

module.exports={SOFTWARE_PROFILE,MESA_FILES,bundledLocations,bundledCaspar,softwareLayoutState,ensureSoftwareCaspar,casparReport};
