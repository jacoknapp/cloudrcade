import {build} from 'esbuild';
import {resolve,dirname,join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import sass from 'sass';
const common=resolve(process.argv[2]), output=resolve(process.argv[3]);
const options={bundle:true,format:'esm',platform:'browser',minify:true,define:{'process.env.NODE_ENV':'"production"'},
 loader:{'.js':'jsx','.scss':'empty','.css':'empty','.svg':'dataurl','.png':'dataurl','.jpg':'dataurl','.gif':'dataurl','.woff':'dataurl','.woff2':'dataurl','.ttf':'dataurl'},
 external:['crypto','util','node-fetch'],alias:{dropbox:resolve(import.meta.dirname,'node_modules/dropbox')},nodePaths:[resolve(import.meta.dirname,'node_modules')]};
await build({...options,stdin:{contents:`export {SaveManager} from ${JSON.stringify(common+'/src/app/saves.js')};export {settings} from ${JSON.stringify(common+'/src/settings/settings.js')};export {storage} from ${JSON.stringify(common+'/src/storage/storage.js')};export {Resources} from ${JSON.stringify(common+'/src/resources/index.js')};`,resolveDir:common},outfile:output});
// Preserve the pinned native CSS-module names so the existing shared mobile
// menu stylesheet applies to GameCube exactly as it does to the other cores.
const classes=JSON.parse(await readFile(join(import.meta.dirname,'ui-classes.json'),'utf8')),styles=new Map();
const uiPlugin={name:'native-menu-styles',setup(build){
 build.onLoad({filter:/\.scss$/},async({path})=>{
  let css=sass.compile(path).css;const names={};
  css=css.replace(/\.([a-zA-Z_][\w-]*)/g,(_,name)=>{names[name]=classes[name]||`gc-native-${name}`;return '.'+names[name];});
  styles.set(path,css);return{contents:'export default '+JSON.stringify(names),loader:'js'};
 });
 build.onLoad({filter:/\/react\/screens\/editor\/tabs\/savestates\.js$/},async({path})=>{
  let contents=await readFile(path,'utf8');
  // Keep a failed operation on its slot instead of resuming after an error.
  for(const method of ['saveStateForSlot','loadStateForSlot']){
   const old=method==='saveStateForSlot'?'await emulator.saveStateForSlot(slot);':'await emulator.loadStateForSlot(slot, currentSlot);';
   if(!contents.includes(old))throw new Error('Pinned save editor changed');
   contents=contents.replace(old,old.replace('await ','if (await ').replace(';', ' === false) return;'));
  }
  const old='new Date(currentSlot.time).toLocaleString([], DATE_FORMAT)';
  if(!contents.includes(old))throw new Error('Pinned slot date changed');
  contents=contents.replace(old,'currentSlot.time ? '+old+' : "Saved state"');
  if(!contents.includes('showCancel={false}'))throw new Error('Pinned slot editor changed');
  contents=contents.replace('showCancel={false}','showCancel={false} closeCallback={onClose}');
  return{contents,loader:'jsx',resolveDir:dirname(path)};
 });
}};
await build({...options,entryPoints:[join(import.meta.dirname,'pause.jsx')],outfile:join(dirname(output),'pause-ui.mjs'),plugins:[uiPlugin],alias:{...options.alias,
 '@gamecube/common-pause':join(common,'src/react/screens/pause/index.js'),
 '@gamecube/common-states':join(common,'src/react/screens/editor/tabs/savestates.js'),
 '@gamecube/common-images':join(common,'src/images/index.js'),
 '@gamecube/common-input':join(common,'src/input/index.js'),
 '@gamecube/common-resources':join(common,'src/resources/index.js')}});
await writeFile(join(dirname(output),'pause-ui.css'),[...styles.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,css])=>css).join('\n'));
