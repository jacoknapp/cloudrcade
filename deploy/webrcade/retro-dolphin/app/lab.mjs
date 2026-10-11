import {GameCubeSession, inspectDisc} from './session.mjs';
import {KEYS, padState, BUTTONS} from './input.mjs';
import {remoteDisc} from './transport.mjs';
import {GameCubeSaves} from './saves.mjs';
import {AudioController} from './vendor/src/audio.js';

const get=id=>document.getElementById(id);
let canvas=get('screen'), session=null, selected=null, busy=false, animation=null, generation=0;
let selectionAbort=null, saves=null, saveTimer=null, exiting=false, sound=false, audio=null;
const pressed=new Set(), input={};
let props=null;
try {
 const encoded=new URLSearchParams(location.search).get('props');
 if(encoded) props=JSON.parse(decodeURIComponent(atob(encoded)));
} catch { get('status').textContent='Invalid game launch properties.'; }
const embedded=parent!==window;
if(embedded) { if(frameElement)frameElement.style.display='block';parent.postMessage('appLoaded',location.origin); document.body.classList.add('embedded'); }
if(props?.rom) { document.body.classList.add('library');get('title').textContent=props.title || 'GameCube'; }
let statusText='',menuVisible=false;
function status(text){statusText=text;get('status').textContent=text;}
function controls(){
 get('initialize').disabled=busy||!!session;
 for(const id of ['disc','url','selectUrl'])get(id).disabled=busy||!!session?.booted;
 get('boot').disabled=busy||!selected||!!session?.booted;
 get('close').disabled=!session&&!busy;

}
function stopFrames(){if(animation!==null)cancelAnimationFrame(animation);animation=null;}
function startFrames(){if(animation===null)animation=requestAnimationFrame(frame);}
function frame(){
 animation=null;if(!session?.booted||session.paused)return;
 if(menuVisible){session.poll();animation=requestAnimationFrame(frame);return;}
 let gamepad=null;for(const pad of navigator.getGamepads?.()||[])if(pad?.connected&&pad.mapping==='standard'){gamepad=pad;break;}
 padState(pressed,gamepad,input);
 mergeTouchInput(input);
 session.setInput(input);session.poll();animation=requestAnimationFrame(frame);
}
function dispose(){
 generation++;selectionAbort?.abort();selectionAbort=null;stopFrames();clearInterval(saveTimer);saveTimer=null;
 audio?.setSource(null);audio?.stopPump();audio?.workletNode?.disconnect();audio?.gain?.disconnect();audio?.context?.close().catch(()=>{});audio=null;sound=false;
 session?.dispose();session=null;saves=null;pressed.clear();busy=false;document.body.classList.remove('running');
 const replacement=canvas.cloneNode();canvas.replaceWith(replacement);canvas=replacement;
 controls();
}
async function close({leave=false}={}){
 if(exiting)return;exiting=true;
 try {
  selectionAbort?.abort();
  if(session?.booted&&!session.closed){
   status('Saving memory cards…');await session.pause();stopFrames();
   await audio?.setMuted(true);await new Promise(resolve=>setTimeout(resolve,1200));
   await saves?.cards(session.adapter);
  }
 }catch(error){status(error.message);if(!session?.closed){exiting=false;controls();return;}}
 dispose();exiting=false;status('Core is stopped.');
 if(leave&&embedded)parent.postMessage('appExiting',location.origin);
 else if(leave)location.href='/play/';
}
async function perform(action){
 if(busy||exiting)return;busy=true;
 if(!session){const current=generation;session=new GameCubeSession({canvas,onStatus:text=>{if(current===generation)status(text);}});}
 const owned=session,current=generation;controls();
 try{await action(owned);}
 catch(error){if(current===generation){dispose();status(error.message);}}
 finally{if(current===generation){busy=false;controls();}}
}
async function select(load){
 if(busy||session?.booted)return;busy=true;selected=null;
 const current=generation,abort=selectionAbort=new AbortController();controls();
 try{const disc=await load(abort.signal);if(current!==generation||abort.signal.aborted)return;selected=disc;status(`Selected ${disc.name}${disc.remote?' — HTTP range streaming':''}.`);}
 catch(error){if(current===generation)status(error.message);}
 finally{if(current===generation){selectionAbort=null;busy=false;controls();}}
}
get('initialize').onclick=()=>perform(async owned=>{status('Initializing experimental Dolphin core…');await owned.initialize();if(session===owned)status('Dolphin initialized. Select a disc to boot.');});
get('disc').onchange=event=>{const file=event.target.files[0];if(!file){selected=null;controls();return;}select(async()=>{await inspectDisc(file);return file;});};
get('selectUrl').onclick=()=>select(signal=>{status('Checking GameCube disc URL…');return remoteDisc(get('url').value,{signal});});
async function boot(){
 await perform(async owned=>{
  status('Booting experimental GameCube core…');
  saves=new GameCubeSaves(props?.title||selected.name,props||{},text=>status(text));
  const metadata=await owned.boot(selected,(adapter,disc)=>saves.initialize(adapter,disc));
  if(session!==owned)return;
  audio=new AudioController();audio.requestedTransport='worklet';
  audio.setSource(frames=>owned.adapter?.mixAudio(frames));audio.setTransportBridge(config=>owned.adapter?.configureAudioWorklet(config));
  status(`Running ${metadata.title||metadata.gameId}.`);document.body.classList.add('running');canvas.tabIndex=0;canvas.focus();fitCanvas();startFrames();
  saveTimer=setInterval(()=>{if(session===owned&&owned.booted&&!owned.closed&&!exiting&&!busy)saves.cards(owned.adapter).catch(error=>status(error.message));},15000);
 });
}
get('boot').onclick=boot;
async function pause(){
 pressed.clear();if(!session?.booted||session.paused)return;stopFrames();
 try{await session.pause();await audio?.setMuted(true);await audio?.context?.suspend();await saves?.cards(session.adapter);}
 catch(error){status(error.message);}controls();
}
async function togglePause(){
 if(!session?.paused)return pause();
 try{if(sound)await audio?.ensureContext();await session.resume();if(sound)await audio?.setMuted(false);canvas.focus();startFrames();}
 catch(error){status(error.message);}controls();
};
async function toggleAudio(){
 if(!audio||!session?.booted)return;
 try{sound=!sound;session.adapter.setAudioMuted(!sound);await audio.setMuted(!sound||session.paused);}
 catch(error){sound=false;status(error.message);}controls();
};
async function stateAction(load,slot){
 if(busy||!session?.booted)return;busy=true;controls();const owned=session,wasPaused=owned.paused;
 try{
  status(load?'Loading state…':'Saving state…');await audio?.setMuted(true);
  // Dolphin file state functions marshal onto its CPU thread and work while paused.
  await owned.pause();stopFrames();
  await (load?saves.loadState(owned.adapter,slot):saves.saveState(owned.adapter,slot));
  status(load?'State loaded.':'State saved.');
 }catch(error){status(error.message);}
 finally{if(session===owned&&!owned.closed){if(!wasPaused){await owned.resume();if(sound)await audio?.setMuted(false);startFrames();}busy=false;controls();}}
}

get('backLibrary').onclick=event=>{event.preventDefault();close({leave:true});};
get('close').onclick=()=>close({leave:!!props?.rom});
addEventListener('keydown',event=>{if(event.code==='Escape'){dispatchEvent(new Event('cloudrcade-game-menu'));event.preventDefault();return;}if(menuVisible||!session?.booted||session.paused||event.target?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName))return;if(KEYS[event.code]){pressed.add(KEYS[event.code]);event.preventDefault();}});
addEventListener('keyup',event=>{if(KEYS[event.code])pressed.delete(KEYS[event.code]);});
addEventListener('blur',pause);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
addEventListener('pagehide',()=>{dispose();});
addEventListener('message',async event=>{
 if(!embedded||event.source!==parent||event.origin!==location.origin||event.data!=='exit')return;
 await close();if(!session)event.source.postMessage('exitComplete',event.origin);
});
const controller={isControlDown:()=>false,isPadButtonDown:()=>false,getAxisValue:()=>0,
 isAxisLeft:()=>false,isAxisRight:()=>false,isAxisUp:()=>false,isAxisDown:()=>false};
const TOUCH_BUTTONS=[[0,'D_UP'],[1,'D_DOWN'],[2,'D_LEFT'],[3,'D_RIGHT'],[4,'A'],[5,'B'],[6,'X'],[7,'Y'],[8,'L'],[9,'R'],[10,'Z'],[12,'Z'],[13,'START']];
function mergeTouchInput(state){
 for(const [cid,name] of TOUCH_BUTTONS)if(controller.isControlDown(cid))state.mask|=BUTTONS[name];
 for(const [field,index,isX,invert] of [['stickX',0,true,false],['stickY',0,false,true],['cStickX',1,true,false],['cStickY',1,false,true]]){
  const value=controller.getAxisValue(index,isX);if(Math.abs(value)>.2)state[field]=Math.round(128+(invert?-1:1)*96*value);
 }
 if(state.mask&BUTTONS.L)state.triggerLeft=255;if(state.mask&BUTTONS.R)state.triggerRight=255;
 if(state.mask&BUTTONS.A)state.analogA=255;if(state.mask&BUTTONS.B)state.analogB=255;
}
function fitCanvas(){
 if(!session?.booted)return;
 const viewport=visualViewport, width=viewport?.width||innerWidth;
 let height=viewport?.height||innerHeight;
 if(navigator.maxTouchPoints>0&&height>width){const pad=document.querySelector('.kt-pad');height=Math.max(100,height-(pad?parseFloat(getComputedStyle(pad).height)||260:260)-16);}
 const w=Math.min(width,height*4/3),h=w*3/4;
 Object.assign(canvas.style,{position:'fixed',width:w+'px',height:h+'px',left:((viewport?.offsetLeft||0)+width/2)+'px',top:((viewport?.offsetTop||0)+height/2)+'px',transform:'translate(-50%,-50%)'});
}
window.app={emulator:{get started(){return !!session?.booted&&!session.closed;},get paused(){return !!session?.paused;},
 get canvas(){return canvas;},controllers:{getController:()=>controller},getProps:()=>props||{},getDefaultAspectRatio:()=>4/3,
 pause(value){if(!!session?.paused!==!!value)void(value?pause():togglePause()).catch(error=>status(error.message));return true;},showPauseMenu(){dispatchEvent(new Event('cloudrcade-game-menu'));},updateScreenSize:fitCanvas},
 isPauseScreen:()=>false,isShowOverlay:()=>!session?.booted||exiting};
window.WrcadGameCube={get ready(){return !!session?.booted&&!session.closed;},get busy(){return busy||exiting;},get paused(){return !!session?.paused;},get sound(){return sound;},get status(){return statusText;},
 togglePause,toggleAudio,fitCanvas,saveState:slot=>stateAction(false,slot),loadState:slot=>stateAction(true,slot),exit:()=>close({leave:true}),menuOpen(open){menuVisible=!!open;pressed.clear();if(open&&!sound)void toggleAudio().catch(error=>status(error.message));if(open)session?.setInput({mask:0,stickX:128,stickY:128,cStickX:128,cStickY:128,triggerLeft:0,triggerRight:0,analogA:0,analogB:0});},
};
addEventListener('resize',fitCanvas);visualViewport?.addEventListener('resize',fitCanvas);
fetch('core-info.json').then(r=>r.json()).then(info=>{get('details').textContent=`Dolphin ${info.dolphinCommit.slice(0,7)}. Device WebGPU required. Local saves and connected Nextcloud sync.`;}).catch(()=>{});
controls();
if(props?.rom){await select(signal=>remoteDisc(props.rom,{signal}));if(selected)await boot();}
