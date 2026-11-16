'use strict';
const path=require('node:path');
function xml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
// Only consumes a validated local profile. Never accepts arbitrary XML/args or
// stores the private producer URL in a configuration file.
function preparedCasparConfig(profile,directory,options={}){
  // Trusted managed-launch formatting policy, never event/profile data. Other
  // callers retain the original absolute-path representation by default.
  if(!options||Object.getPrototypeOf(options)!==Object.prototype||Reflect.ownKeys(options).some(key=>key!=='relativePaths')||(Object.hasOwn(options,'relativePaths')&&typeof options.relativePaths!=='boolean'))throw Error('CONFIG_PATH_POLICY');
  const relativePaths=options.relativePaths===true;
  if(!path.isAbsolute(directory)||/[\x00-\x1f]/.test(directory))throw Error('CONFIG_DIRECTORY');
  const folder=name=>xml(relativePaths?name+'/':path.join(directory,name)+path.sep);
  const output=profile.output;
  if(!output||!['none','ndi'].includes(output.type)||(output.type==='ndi'&&(typeof output.name!=='string'||!output.name.trim()||output.name.length>64||/[^\x20-\x7e]/.test(output.name))))throw Error('CONFIG_OUTPUT');
  const consumers=output.type==='ndi'?'<consumers><ndi><name>'+xml(output.name)+'</name><allow-fields>false</allow-fields></ndi></consumers>':'<consumers/>';
  return '<?xml version="1.0" encoding="utf-8"?>\n<configuration><paths><media-path>'+folder('media')+'</media-path><log-path disabled="true">'+folder('log')+'</log-path><data-path>'+folder('data')+'</data-path><template-path>'+folder('template')+'</template-path></paths><log-level>info</log-level><channels><channel><video-mode>1080p3000</video-mode><color-depth>8</color-depth>'+consumers+'</channel></channels><controllers/><osc><disable-send-to-amcp-clients>true</disable-send-to-amcp-clients></osc><ndi><auto-load>false</auto-load></ndi><html><enable-gpu>false</enable-gpu><remote-debugging-port>0</remote-debugging-port><cache-path/></html></configuration>\n';
}
module.exports={preparedCasparConfig};
