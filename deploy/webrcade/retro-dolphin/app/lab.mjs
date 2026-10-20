import {GameCubeSession, inspectDisc} from './session.mjs';
import {KEYS, padState, BUTTONS} from './input.mjs';
import {remoteDisc} from './transport.mjs';
import {GameCubeSaves} from './saves.mjs';
import {saveFeedback} from './save-feedback.mjs';
import {AudioController} from './vendor/src/audio.js';
import {GameCubePerf, perfEnabled, createPerfReadout} from './perf.mjs';
import {createPauseMenu} from './pause-ui.mjs';
import {createBackgroundPause} from './lifecycle.mjs';
import {createFrameSkipControl} from './frame-skip.mjs';

const get=id=>document.getElementById(id);
const recovery=window.WrcadGameCubeRecovery;
let coreIdentity=null,runtimeIdentity=null;
let canvas=get('screen'), session=null, selected=null, busy=false, animation=null, generation=0;
let selectionAbort=null, saves=null, exiting=false, sound=false, audio=null;
let perf=null, pauseMenu=null, pausing=null, escapeOpen=false,disposeSaveFeedback=null;
const pressed=new Set(), input={};
const frameSkipControl=createFrameSkipControl(window,{onChange:divisor=>session?.setFrameSkip(divisor)});
let props=null;
try {
 const encoded=new URLSearchParams(location.search).get('props');
 if(encoded) props=JSON.parse(decodeURIComponent(atob(encoded)));
} catch { get('status').textContent='Invalid game launch properties.'; }
const embedded=parent!==window;
if(embedded) { if(frameElement)frameElement.style.display='block';parent.postMessage('appLoaded',location.origin); document.body.classList.add('embedded'); }
if(props?.rom) { document.body.classList.add('library');get('title').textContent=props.title || 'GameCube'; }
let statusText='',menuVisible=false,controllerMenuVisible=false;
function status(text){statusText=text;get('status').textContent=text;}
function runtimeFailure(error){
 recovery?.fail(error);
 dispose();exiting=false;pausing=null;status(error.message);get('gamecube-failure-detail').textContent=error.message;
 get('restartGame').hidden=!selected;get('gamecube-failure').hidden=false;
}
function controls(){
 get('initialize').disabled=busy||!!session;
 for(const id of ['disc','url','selectUrl'])get(id).disabled=busy||!!session?.booted;
 get('boot').disabled=busy||!selected||!!session?.booted;
 get('close').disabled=!session&&!busy;

}
function stopFrames(){if(animation!==null)cancelAnimationFrame(animation);animation=null;}
function startFrames(){if(animation===null)animation=requestAnimationFrame(frame);}
const backgroundPause=createBackgroundPause({getSession:()=>session,
 canPause:owned=>!!owned?.booted&&!owned.closed&&!owned.paused&&!menuVisible&&!busy&&!exiting,
 canResume:owned=>owned===session&&owned.booted&&!owned.closed&&!menuVisible&&!busy&&!exiting,
 pause, resume, onError:error=>status(error.message)});
function frame(){
 animation=null;if(!session?.booted||session.paused)return;
 if(menuVisible||controllerMenuVisible){session.poll();animation=requestAnimationFrame(frame);return;}
 let gamepad=null;for(const pad of navigator.getGamepads?.()||[])if(pad?.connected&&pad.mapping==='standard'){gamepad=pad;break;}
 padState(pressed,gamepad,input);
 mergeTouchInput(input);
 session.setInput(input);session.poll();animation=requestAnimationFrame(frame);
}
function dispose(){
 backgroundPause.reset();disposeSaveFeedback?.();disposeSaveFeedback=null;
 pauseMenu?.dispose();pauseMenu=null;menuVisible=false;controllerMenuVisible=false;escapeOpen=false;document.documentElement.classList.remove('gc-paused-menu');
 generation++;selectionAbort?.abort();selectionAbort=null;stopFrames();
 audio?.setSource(null);audio?.stopPump();audio?.workletNode?.disconnect();audio?.gain?.disconnect();audio?.context?.close().catch(()=>{});audio=null;sound=false;
 session?.dispose();session=null;saves=null;pressed.clear();busy=false;document.body.classList.remove('running');
 perf?.element.remove?.();perf=null;
 const replacement=canvas.cloneNode();canvas.replaceWith(replacement);canvas=replacement;
 controls();
}
async function close({leave=false}={}){
 if(exiting)return;exiting=true;recovery?.phase('closing');
 try {
  selectionAbort?.abort();
  if(session?.booted&&!session.closed){
   status('Saving memory cards…');await session.pause();stopFrames();
   await audio?.setMuted(true);await new Promise(resolve=>setTimeout(resolve,1200));
   await saves?.cards(session.adapter,{refresh:true});
  }
 }catch(error){status(error.message);if(!session?.closed){exiting=false;controls();throw error;}}
 dispose();recovery?.clear();exiting=false;status('Core is stopped.');
 if(leave&&embedded)parent.postMessage('appExiting',location.origin);
 else if(leave)location.href='/play/';
}
async function perform(action){
 if(busy||exiting)return;busy=true;
 if(!session){recovery?.begin();const current=generation;session=new GameCubeSession({canvas,nativeTimingEnabled:perfEnabled(),onStatus:text=>{if(current===generation)status(text);},onTelemetry:frame=>{if(current===generation){perf?.sample(frame);recovery?.sample(frame);}},onFatal:error=>{if(current===generation)runtimeFailure(error);}});}
 const owned=session,current=generation;controls();
 try{owned.frameSkip=frameSkipControl.value;await action(owned);}
 catch(error){if(current===generation){if(props?.rom)runtimeFailure(error);else{dispose();status(error.message);}}}
 finally{if(current===generation){busy=false;controls();backgroundPause.update();}}
}
async function select(load){
 if(busy||session?.booted)return;busy=true;selected=null;
 const current=generation,abort=selectionAbort=new AbortController();controls();
 try{const disc=await load(abort.signal);if(current!==generation||abort.signal.aborted)return;selected=disc;status(`Selected ${disc.name}${disc.remote?' — HTTP range streaming':''}.`);}
 catch(error){if(current===generation){if(props?.rom)runtimeFailure(error);else status(error.message);}}
 finally{if(current===generation){selectionAbort=null;busy=false;controls();}}
}
get('initialize').onclick=()=>perform(async owned=>{status('Initializing Dolphin core…');await owned.initialize();if(session===owned)status('Dolphin initialized. Select a disc to boot.');});
get('disc').onchange=event=>{const file=event.target.files[0];if(!file){selected=null;controls();return;}select(async()=>{await inspectDisc(file);return file;});};
get('selectUrl').onclick=()=>select(signal=>{status('Checking GameCube disc URL…');return remoteDisc(get('url').value,{signal});});
async function boot(){
 await perform(async owned=>{
  status('Booting GameCube core…');
  saves=new GameCubeSaves(props?.title||selected.name,props||{},text=>status(text));
  disposeSaveFeedback=saveFeedback(get('gamecube-save-toast'),saves);
  const metadata=await owned.boot(selected,(adapter,disc)=>saves.initialize(adapter,disc));
  if(session!==owned)return;
  perf=perfEnabled()?createPerfReadout():new GameCubePerf({});
  perf.setGameId(metadata.gameId);
  recovery?.identify(metadata.gameId,coreIdentity,runtimeIdentity);recovery?.phase('playing');
  audio=new AudioController();audio.requestedTransport='worklet';
  audio.setSource(frames=>owned.adapter?.mixAudio(frames));audio.setTransportBridge(config=>owned.adapter?.configureAudioWorklet(config));
  status(`Running ${metadata.title||metadata.gameId}.`);document.body.classList.add('running');canvas.tabIndex=0;canvas.focus();fitCanvas();startFrames();
  pauseMenu=createPauseMenu({root:get('gamecube-menu'),appProps:{...props,title:props?.title||metadata.title||'GameCube',app:'GameCube'},emulator:{getStateSlots:()=>saves.stateSlots(),saveStateForSlot:slot=>stateAction(false,slot),loadStateForSlot:slot=>stateAction(true,slot),deleteStateForSlot:slot=>saves.deleteState(slot),getPerformance:()=>perf?.details||'Waiting for measurements.',getSaveStatus:()=>saves?.syncStatus||(pausing?'Pausing game…':'Memory cards checked when Menu opens.'),isSaveBusy:()=>!!saves?.syncing,subscribeSaves:listener=>saves.subscribe(listener),exit:()=>close({leave:true})},onResume:resumeFromMenu,onPause:showPauseMenu});
  // Desktop games start with audio enabled, independently of the touch panel.
  // Browser permission to resume audio must never delay core startup.
  if(!matchMedia('(pointer: coarse)').matches)void toggleAudio();
 });
}
get('boot').onclick=boot;
get('restartGame').onclick=()=>{get('gamecube-failure').hidden=true;void boot();};
get('leaveFailedGame').onclick=()=>{get('gamecube-failure').hidden=true;void close({leave:true});};
async function pause(){
 pressed.clear();if(pausing)return pausing;if(!session?.booted||session.paused)return;
 stopFrames();const owned=session;
 pausing=(async()=>{
  try{await owned.pause();if(session!==owned||owned.closed)return;perf?.reset(true);recovery?.phase('paused');
   const ownedAudio=audio;
   // Browser audio and cloud networking may remain pending while an installed
   // app is suspended. Neither may own the CPU pause/resume transition.
   void ownedAudio?.setMuted(true).then(async()=>{
    if(session===owned&&owned.paused&&!owned.closed)await ownedAudio?.context?.suspend();
    if(session===owned&&!owned.paused&&!owned.closed&&sound)await resumeAudio(ownedAudio);
   }).catch(error=>{if(session===owned)status(error.message);});
   void saves?.cards(owned.adapter,{refresh:true}).catch(error=>{if(session===owned)status(error.message);});
   if(session===owned&&!owned.closed)void owned.bounded(owned.adapter.request('heapStats')).then(({heap})=>{
    if(session===owned&&!owned.closed&&owned.paused)perf?.setHeapSample(heap);
   }).catch(error=>{if(session===owned&&!owned.closed)status(error.message);});}
  catch(error){status(error.message);throw error;}
  finally{pausing=null;controls();}
 })();return pausing;
}
async function togglePause(){
 await pausing;
 if(!session?.paused)return pause();
 await resume();
}
async function resume(){
 const owned=session;await pausing;
 if(!owned?.booted||owned.closed||session!==owned)return;
 // Safari may suspend or interrupt AudioContext while the installed app is
 // away. CPU resume does not depend on browser permission to restart audio.
 await owned.resume();
 if(session!==owned||owned.closed)return;
 recovery?.phase('playing');perf?.reset();startFrames();controls();
 if(sound)void resumeAudio().then(async()=>{
  if(session===owned&&!owned.closed&&!owned.paused&&sound)await audio?.setMuted(false);
 }).catch(error=>{if(session===owned)status(error.message);});
}
async function resumeAudio(owned=audio){
 await owned?.ensureContext();
 if(owned?.context?.state==='interrupted')await owned.context.resume();
}
async function showPauseMenu(){
 if(menuVisible||busy||exiting||!session?.booted)return;
 menuVisible=true;pressed.clear();
 // Unlock browser audio on the Menu gesture; the existing master mute gain
 // still controls whether it is audible, as it does for every other core.
 if(!sound)void toggleAudio();
 document.documentElement.classList.add('gc-paused-menu');pauseMenu.show();
 try{await pause();}
 catch(error){if(session?.booted)status(error.message);}
}
async function resumeFromMenu(){
 if(busy||exiting)return;
 pauseMenu.hide();document.documentElement.classList.remove('gc-paused-menu');menuVisible=false;
 try{await resume();canvas.focus();backgroundPause.update();}catch(error){status(error.message);menuVisible=true;document.documentElement.classList.add('gc-paused-menu');pauseMenu.show();}
}
async function toggleAudio(){
 if(!audio||!session?.booted)return;
 try{sound=!sound;session.adapter.setAudioMuted(!sound);await audio.setMuted(!sound||session.paused);}
 catch(error){sound=false;status(error.message);}controls();
};
async function stateAction(load,slot){
 if(busy||!session?.booted)return;busy=true;controls();const owned=session,wasPaused=owned.paused;
 try{
  recovery?.phase(load?'loading state':'saving state');
  status(load?'Loading state…':'Saving state…');await audio?.setMuted(true);
  // Dolphin file state functions marshal onto its CPU thread and work while paused.
  await owned.pause();stopFrames();
  perf?.reset(true);
  await (load?saves.loadState(owned.adapter,slot):saves.saveState(owned.adapter,slot));
  status(load?'State loaded.':'State saved.');
 }catch(error){status(error.message);throw error;}
 finally{if(session===owned&&!owned.closed){if(!wasPaused){await resume();}recovery?.phase(owned.paused?'paused':'playing');busy=false;controls();backgroundPause.update();}}
}

get('backLibrary').onclick=event=>{event.preventDefault();void close({leave:true}).catch(error=>status(error.message));};
get('close').onclick=()=>{void close({leave:!!props?.rom}).catch(error=>status(error.message));};
addEventListener('keydown',event=>{if(event.code==='Escape'){if(!event.repeat)escapeOpen=!menuVisible;event.preventDefault();return;}if(menuVisible||!session?.booted||session.paused||event.target?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName))return;if(KEYS[event.code]){pressed.add(KEYS[event.code]);event.preventDefault();}});
addEventListener('keyup',event=>{if(event.code==='Escape'){if(escapeOpen){escapeOpen=false;void showPauseMenu();}return;}if(KEYS[event.code])pressed.delete(KEYS[event.code]);});
addEventListener('blur',()=>{backgroundPause.background();});
addEventListener('focus',()=>{if(!document.hidden)backgroundPause.foreground();});
document.addEventListener('visibilitychange',()=>{document.hidden?backgroundPause.background():backgroundPause.foreground();});
addEventListener('pagehide',event=>{if(event.persisted)backgroundPause.background();else dispose();});
addEventListener('pageshow',()=>{if(!document.hidden)backgroundPause.foreground();});
// A return gesture retries interrupted browser audio without changing an
// intentional menu pause or requiring a second trip through controller settings.
addEventListener('pointerdown',()=>{if(sound&&session?.booted&&!session.paused&&!document.hidden)void resumeAudio().catch(error=>status(error.message));});
addEventListener('keydown',()=>{if(sound&&session?.booted&&!session.paused&&!document.hidden)void resumeAudio().catch(error=>status(error.message));});
addEventListener('message',async event=>{
 if(!embedded||event.source!==parent||event.origin!==location.origin||event.data!=='exit')return;
 try{await close();if(!session)event.source.postMessage('exitComplete',event.origin);}catch(error){status(error.message);}
});
const controller={isControlDown:()=>false,isPadButtonDown:()=>false,getAxisValue:()=>0,
 isAxisLeft:()=>false,isAxisRight:()=>false,isAxisUp:()=>false,isAxisDown:()=>false};
const TOUCH_BUTTONS=[[0,'D_UP'],[1,'D_DOWN'],[2,'D_LEFT'],[3,'D_RIGHT'],[4,'A'],[5,'B'],[6,'X'],[7,'Y'],[8,'L'],[9,'R'],[10,'Z'],[12,'Z'],[13,'START']];
function mergeTouchInput(state){
 for(const [cid,name] of TOUCH_BUTTONS)if(controller.isControlDown(cid))state.mask|=BUTTONS[name];
 for(const [field,index,isX,invert] of [['stickX',0,true,false],['stickY',0,false,true],['cStickX',1,true,false],['cStickY',1,false,true]]){
  // The overlay already applies its radial deadzone. A second component
  // threshold loses slow movement and snaps diagonals to cardinal directions.
  const value=controller.getAxisValue(index,isX);if(value)state[field]=Math.round(128+(invert?-1:1)*96*value);
 }
 if(state.mask&BUTTONS.L)state.triggerLeft=255;if(state.mask&BUTTONS.R)state.triggerRight=255;
 if(state.mask&BUTTONS.A)state.analogA=255;if(state.mask&BUTTONS.B)state.analogB=255;
}
function fitCanvas(){
 if(!session?.booted)return;
 const viewport=visualViewport, width=viewport?.width||innerWidth;
 let height=viewport?.height||innerHeight;
 if(navigator.maxTouchPoints>0&&height>width&&document.getElementById('wrcad-touch')?.classList.contains('kt-enabled')){const pad=document.querySelector('.kt-pad'),style=pad&&getComputedStyle(pad);height=Math.max(100,height-(parseFloat(style?.height)||400)-(parseFloat(style?.bottom)||12)-20);}
 const w=Math.min(width,height*4/3),h=w*3/4;
 for(const [key,value]of Object.entries({position:'fixed',width:w+'px',height:h+'px',left:((viewport?.offsetLeft||0)+width/2)+'px',top:((viewport?.offsetTop||0)+height/2)+'px',transform:'translate(-50%,-50%)'}))if(canvas.style[key]!==value)canvas.style[key]=value;
}
window.app={emulator:{get started(){return !!session?.booted&&!session.closed;},get paused(){return !!session?.paused;},
 get canvas(){return canvas;},controllers:{getController:()=>controller},getProps:()=>props||{},getDefaultAspectRatio:()=>4/3,
 pause(value){if(!!session?.paused!==!!value)void(value?pause():togglePause()).catch(error=>status(error.message));return true;},showPauseMenu(){void showPauseMenu();},updateScreenSize:fitCanvas},
 isPauseScreen:()=>menuVisible,isShowOverlay:()=>!session?.booted||exiting};
window.WrcadGameCube={get ready(){return !!session?.booted&&!session.closed;},get busy(){return busy||exiting;},get paused(){return !!session?.paused;},get sound(){return sound;},get status(){return statusText;},
 togglePause,toggleAudio,fitCanvas,showPauseMenu,saveState:slot=>stateAction(false,slot),loadState:slot=>stateAction(true,slot),exit:()=>close({leave:true}),menuOpen(open){controllerMenuVisible=!!open;pressed.clear();fitCanvas();if(open&&!sound)void toggleAudio().catch(error=>status(error.message));if(open)session?.setInput({mask:0,stickX:128,stickY:128,cStickX:128,cStickY:128,triggerLeft:0,triggerRight:0,analogA:0,analogB:0});},
};
addEventListener('resize',fitCanvas);visualViewport?.addEventListener('resize',fitCanvas);
fetch('core-info.json').then(r=>r.json()).then(info=>{coreIdentity=info.artifacts?.['dolphin-core-upstream.wasm'];runtimeIdentity=info.hostPatchSha256;recovery?.identify(null,coreIdentity,runtimeIdentity);get('details').textContent=`Dolphin ${info.dolphinCommit.slice(0,7)}. Device WebGPU required. Local saves and connected Nextcloud sync.`;}).catch(()=>{});
controls();
if(document.hidden)backgroundPause.background();
if(props?.rom){await select(signal=>remoteDisc(props.rom,{signal}));if(selected)await boot();}
