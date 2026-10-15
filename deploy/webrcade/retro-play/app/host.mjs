import {remoteDisc,localDisc,DiscDevice,CHUNK,THRESHOLD} from './disc.mjs';
import {Ps2Saves} from './saves.mjs';
import {inputState,KEYS} from './input.mjs';
import {createPauseMenu} from './pause-ui.mjs';
import {enabled} from './preferences.mjs';
import {Ps2Performance} from './perf.mjs';
import {Ps2Gpu} from './gpu.mjs';
import {pictureBounds} from './viewport.mjs';

const get=id=>document.getElementById(id),canvas=get('outputCanvas'),embedded=parent!==window;
let module=null,device=null,saves=null,menu=null,disc=null,props={},started=false,paused=false,menuVisible=false,closing=false,failed=false;
let animation=0,backgroundOwned=false,drawerOpen=false,operation=Promise.resolve(),stateBusy=false;
let performanceReadout=null,gpu=null;
let generation=0,backgroundSync=Promise.resolve();
let closePromise=null,journalStarted=false;
window.WrcadCoreCrash?.clear();
const launchAbort=new AbortController();
const keys=new Set(),touch={isControlDown:()=>false,isPadButtonDown:()=>false,getAxisValue:()=>0,isAxisLeft:()=>false,isAxisRight:()=>false,isAxisUp:()=>false,isAxisDown:()=>false};
const status=text=>{get('status').textContent=text;};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function acknowledged(){
 const end=performance.now()+60000;
 for(;;){if(failed)throw new Error('PS2 core has stopped.');const result=module.operationStatus();if(result===1)return;if(result<0)throw new Error(module.lastError()||'The PS2 core operation failed.');if(performance.now()>end)throw new Error('PS2 core timed out.');await delay(16);}
}
function command(action){const next=operation.then(async()=>{if(!module||failed)throw new Error('PS2 core is unavailable.');action();await acknowledged();});operation=next.catch(()=>{});return next;}
async function resumeAudio(){const context=module?.cloudAudio?.();if(context&&context.state!=='closed'&&context.state!=='running')await context.resume();}
function neutral(){keys.clear();if(failed)return;for(let pad=0;pad<2;pad++)module?.setInput(pad,0,128,128,128,128);}
function frame(){
 animation=0;if(!started||paused||failed)return;
 if(!drawerOpen&&!menuVisible){const pads=navigator.getGamepads?.()||[],standard=[...pads].filter(pad=>pad?.connected&&pad.mapping==='standard');
  for(let pad=0;pad<2;pad++)module.setInput(pad,...inputState(pad===0?keys:new Set(),standard[pad],pad===0?touch:null));
 }
 fitCanvas();animation=requestAnimationFrame(frame);
}
function startFrames(){if(!animation&&started&&!paused&&!failed)animation=requestAnimationFrame(frame);}
async function pause(){
 if(!started||failed)return;
 neutral();cancelAnimationFrame(animation);animation=0;
 if(paused)return operation;
 paused=true;
 try{await command(()=>module.pauseVm());}catch(error){failure(error);throw error;}
 window.WrcadCoreCrash?.phase(closing?'closing':'paused');
 performanceReadout?.reset(true);
 void module.cloudAudio?.()?.suspend().catch(()=>{});
}
async function resume(){
 if(!started||failed||closing||menuVisible||document.hidden)return;
 await operation;if(!paused)return;
 try{await command(()=>module.resumeVm());}catch(error){failure(error);throw error;}
 window.WrcadCoreCrash?.phase('playing');
 paused=false;performanceReadout?.reset();startFrames();void resumeAudio().catch(()=>{});
}
async function syncPause(){await pause();if(saves)await saves.cards();}
async function showMenu(){
 if(!started||menuVisible||closing||failed)return;
 menuVisible=true;backgroundOwned=false;neutral();document.documentElement.classList.add('ps2-paused-menu');menu.show();
 try{await syncPause();}catch(error){saves?.report(error.message);if(!module||failed)failure(error);}
}
async function hideMenu(){
 if(stateBusy||closing)return;
 await operation;menu.hide();menuVisible=false;document.documentElement.classList.remove('ps2-paused-menu');
 try{await resume();canvas.focus();}catch(error){failure(error);}
}
function screenshot(){try{const shot=document.createElement('canvas');shot.width=320;shot.height=240;shot.getContext('2d').drawImage(canvas,0,0,320,240);return shot.toDataURL('image/png');}catch{return null;}}
async function stateAction(load,slot){
 if(stateBusy||closing||!started||failed)throw new Error('PS2 is busy.');stateBusy=true;
 const path='/cloudrcade/state.zip';
 try{
  await pause();await saves.queue;
  if(load){const bytes=await saves.load(slot);module.FS.writeFile(path,bytes);await command(()=>module.loadVm(path));}
  else{const shot=screenshot();await command(()=>module.saveVm(path));const bytes=module.FS.readFile(path);return await saves.save(slot,bytes,shot);}
  saves.report('Save state loaded.');return true;
 }catch(error){saves.report(error.message);throw error;}
 finally{try{module?.FS.unlink(path);}catch{}stateBusy=false;}
}
async function dispose(){
 journalStarted=false;window.WrcadCoreCrash?.clear();
 generation++;launchAbort.abort();
 started=false;cancelAnimationFrame(animation);animation=0;neutral();menu?.dispose();menu=null;
 performanceReadout?.dispose();performanceReadout=null;
 const owned=module;module=null;window.Module=null;
 device?.close();device=null;disc?.close();
 try{owned?.PThread?.terminateAllThreads();}catch{}
 const context=owned?.cloudAudio?.();if(context&&context.state!=='closed')await context.close().catch(()=>{});
 await gpu?.dispose();gpu=null;
 document.documentElement.classList.remove('ps2-paused-menu');document.body.classList.remove('running');
}
async function exit({leave=true}={}){
 if(closing){await closePromise;if(!leave&&embedded)parent.postMessage('exitComplete',location.origin);return;}
 closing=true;
 closePromise=(async()=>{
  const end=performance.now()+60000;
  while(stateBusy){if(performance.now()>end)throw new Error('PS2 save operation is still busy. Retry exit when it finishes.');await delay(16);}
  if(started&&!failed){await syncPause();await saves.queue;}
  await dispose();
 })();
 try{
  await closePromise;closing=false;
  if(embedded)parent.postMessage(leave?'appExiting':'exitComplete',location.origin);
  else if(leave)location.href='/play/';
 }catch(error){closing=false;closePromise=null;get('retry-save').hidden=false;get('failure-detail').textContent=error.message;get('failure').hidden=false;throw error;}
}
function failure(error){
 if(failed)return;failed=true;if(journalStarted)window.WrcadCoreCrash?.fail(error);status(error.message);get('failure-detail').textContent=error.message;get('failure').hidden=false;
 console.error('PlayStation 2 core:',error);
 void dispose();
}
function fitCanvas(){
 const enabled=document.getElementById('wrcad-touch')?.classList.contains('kt-enabled');
 // Fixed default reservation is independent of a user's moved/resized controls.
 const rect=pictureBounds({safe:get('safe-area').getBoundingClientRect(),touch:matchMedia('(pointer:coarse)').matches,controls:enabled});
 for(const [name,value]of Object.entries({position:'fixed',width:rect.width+'px',height:rect.height+'px',left:rect.left+'px',top:rect.top+'px',transform:'none'}))if(canvas.style[name]!==value)canvas.style[name]=value;
}
async function boot(selected){
 if(!enabled())throw new Error('Enable PlayStation 2 in Settings → Experimental Settings before launching.');
 window.WrcadCoreCrash?.begin();journalStarted=true;
 const ownedGeneration=++generation;
 disc=selected;status('Loading PlayStation 2 core…');get('file').disabled=true;
 if(!crossOriginIsolated||typeof SharedArrayBuffer!=='function')throw new Error('PS2 requires HTTPS and cross-origin isolation.');
 const info=await fetch('./core-info.json').then(response=>{if(!response.ok)throw new Error('PS2 core information is unavailable.');return response.json();});
 const {default:Play}=await import('./core/Play.js');
 const created=await Play({canvas,locateFile:name=>new URL('./core/'+name,import.meta.url).href,
  mainScriptUrlOrBlob:new URL('./core/Play.js',import.meta.url).href,
  print:message=>console.log(message),printErr:message=>console.error(message),
  onAbort:message=>failure(new Error('PS2 core error: '+message)),
 });
 if(ownedGeneration!==generation||closing||failed){created.PThread?.terminateAllThreads();return;}
 module=created;window.Module=module;
 for(const worker of [...module.PThread.unusedWorkers,...module.PThread.runningWorkers])worker.onerror=event=>{
  event.preventDefault();
  if(module!==created||closing||failed)return;
  failure(new Error('PS2 native worker stopped: '+(event.message||'unexpected worker error')));
 };
 for(const path of ['/cloudrcade/cards/mc0','/cloudrcade/cards/mc1'])module.FS.mkdirTree(path);
 const identity=props.uid||props.rom||`${disc.name}:${disc.size}`;
 const id=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 saves=new Ps2Saves(module,props,info.stateFormatId,status);await saves.initialize(id);
 if(ownedGeneration!==generation||closing||failed)return;
 gpu=new Ps2Gpu(module,error=>failure(error));module.cloudGpu=gpu;
 await gpu.initialize(canvas);
 if(ownedGeneration!==generation||closing||failed)return;
 module.initialize();
 const extension=disc.name.split('.').pop().toLowerCase();
 if(!['iso','chd','elf'].includes(extension))throw new Error('PS2 accepts ISO, CHD and homebrew ELF files.');
 status('Starting PlayStation 2…');
 if(extension==='elf'){
  if(disc.size>THRESHOLD)throw new Error('PS2 homebrew ELF exceeds the 128 MiB limit.');
  const bytes=new Uint8Array(disc.size);
  for(let offset=0;offset<disc.size;offset+=CHUNK)bytes.set(await disc.read(offset,Math.min(CHUNK,disc.size-offset)),offset);
  if(bytes[0]!==127||bytes[1]!==69||bytes[2]!==76||bytes[3]!==70)throw new Error('Invalid PS2 ELF file.');
  module.FS.writeFile('/cloudrcade/game.elf',bytes);await command(()=>module.bootElf('/cloudrcade/game.elf'));
 }else{device=new DiscDevice(module,disc,error=>failure(error));module.discImageDevice=device;await command(()=>module.bootDiscImage('game.'+extension));}
 window.WrcadCoreCrash?.phase('playing');
 started=true;paused=false;document.body.classList.add('running');canvas.focus();fitCanvas();
 performanceReadout=new Ps2Performance(module,disc);
 menu=createPauseMenu({root:get('ps2-menu'),appProps:{...props,title:props.title||disc.name,app:'PlayStation 2'},
  emulator:{getStateSlots:()=>saves.slots(),saveStateForSlot:slot=>stateAction(false,slot),loadStateForSlot:slot=>stateAction(true,slot),deleteStateForSlot:slot=>saves.delete(slot),
   getSaveStatus:()=>saves.status,isSaveBusy:()=>saves.busy,subscribeSaves:listener=>{saves.listeners.add(listener);return()=>saves.listeners.delete(listener);},
   getPerformance:()=>performanceReadout?.details||'Waiting for a performance sample.',exit},
  onResume:hideMenu,onPause:showMenu});
 startFrames();void resumeAudio().catch(()=>{});
 if(document.hidden){backgroundOwned=true;backgroundSync=syncPause().catch(error=>saves?.report(error.message));}
}
window.app={emulator:{get started(){return started&&!failed;},get paused(){return paused;},canvas,getProps:()=>props,getDefaultAspectRatio:()=>4/3,
 controllers:{getController:()=>touch},pause(value){void(value?pause():resume()).catch(failure);return true;},showPauseMenu(){void showMenu();},updateScreenSize:fitCanvas},isPauseScreen:()=>menuVisible,isShowOverlay:()=>!started||closing};
window.WrcadPS2={get module(){return module;},get disc(){return disc;},get saves(){return saves;},get ready(){return started&&!failed;},showMenu,hideMenu,pause,resume,exit,
 saveState:slot=>stateAction(false,slot),loadState:slot=>stateAction(true,slot),menuOpen(open){drawerOpen=open;neutral();void resumeAudio().catch(()=>{});}};
for(const event of ['pointerdown','touchend'])document.addEventListener(event,()=>{if(!paused)void resumeAudio().catch(()=>{});},true);
addEventListener('keydown',event=>{
 if(event.code==='Escape'){event.preventDefault();if(!event.repeat)void showMenu();return;}
 if(!started||paused||drawerOpen||/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName))return;
 if(KEYS[event.code]||['KeyF','KeyH','KeyT','KeyG','KeyJ','KeyL','KeyI','KeyK'].includes(event.code)){keys.add(KEYS[event.code]||event.code);event.preventDefault();void resumeAudio().catch(()=>{});}
});
addEventListener('keyup',event=>keys.delete(KEYS[event.code]||event.code));
function background(){neutral();if(started&&!paused&&!menuVisible&&!failed){backgroundOwned=true;backgroundSync=syncPause().catch(error=>saves?.report(error.message));}}
function foreground(){if(backgroundOwned&&!document.hidden){backgroundOwned=false;void backgroundSync.then(resume).catch(failure);}}
addEventListener('blur',background);addEventListener('focus',foreground);
document.addEventListener('visibilitychange',()=>document.hidden?background():foreground());
addEventListener('pagehide',event=>{if(event.persisted)background();else void dispose();});addEventListener('pageshow',foreground);
addEventListener('resize',fitCanvas);visualViewport?.addEventListener('resize',fitCanvas);visualViewport?.addEventListener('scroll',fitCanvas);
addEventListener('message',event=>{if(embedded&&event.source===parent&&event.origin===location.origin&&event.data==='exit')void exit({leave:false}).catch(()=>{});});
get('file').onchange=event=>{const file=event.target.files[0];if(file)void boot(localDisc(file)).catch(failure);};
get('restart').onclick=()=>location.reload();get('leave').onclick=()=>{if(failed){if(embedded)parent.postMessage('appExiting',location.origin);else location.href='/play/';}else void exit().catch(()=>{});};
get('retry-save').onclick=()=>{get('failure').hidden=true;void exit().catch(()=>{});};
try{
 const encoded=new URLSearchParams(location.search).get('props');if(encoded)props=JSON.parse(decodeURIComponent(atob(encoded)));
 if(embedded){if(frameElement)frameElement.style.display='block';parent.postMessage('appLoaded',location.origin);}
 if(props.rom){document.body.classList.add('library');if(!enabled())throw new Error('Enable PlayStation 2 in Settings → Experimental Settings before launching.');const selected=await remoteDisc(props.rom,{signal:launchAbort.signal});if(closing)selected.close();else await boot(selected);}
 else if(!enabled()){get('file').disabled=true;status('Enable PlayStation 2 in Settings → Experimental Settings before launching.');}
}catch(error){if(!closing)failure(error);}
