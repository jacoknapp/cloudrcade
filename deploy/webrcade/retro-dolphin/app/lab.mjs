import {GameCubeSession, inspectDisc} from './session.mjs';
import {KEYS, padState} from './input.mjs';
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
if(embedded) { parent.postMessage('appLoaded',location.origin); document.body.classList.add('embedded'); }
if(props?.rom) { document.body.classList.add('library');get('title').textContent=props.title || 'GameCube'; }
function status(text){get('status').textContent=text;}
function controls(){
 get('initialize').disabled=busy||!!session;
 for(const id of ['disc','url','selectUrl'])get(id).disabled=busy||!!session?.booted;
 get('boot').disabled=busy||!selected||!!session?.booted;
 get('pause').disabled=busy||!session?.booted;
 for(const id of ['sound','save','load','slot'])get(id).disabled=busy||!session?.booted;
 get('close').disabled=!session&&!busy;
 get('pause').textContent=session?.paused?'Resume':'Pause';get('sound').textContent=sound?'Mute':'Enable sound';
}
function stopFrames(){if(animation!==null)cancelAnimationFrame(animation);animation=null;}
function startFrames(){if(animation===null)animation=requestAnimationFrame(frame);}
function frame(){
 animation=null;if(!session?.booted||session.paused)return;
 let gamepad=null;for(const pad of navigator.getGamepads?.()||[])if(pad?.connected&&pad.mapping==='standard'){gamepad=pad;break;}
 session.setInput(padState(pressed,gamepad,input));session.poll();animation=requestAnimationFrame(frame);
}
function dispose(){
 generation++;selectionAbort?.abort();selectionAbort=null;stopFrames();clearInterval(saveTimer);saveTimer=null;
 audio?.setSource(null);audio?.stopPump();audio?.workletNode?.disconnect();audio?.gain?.disconnect();audio?.context?.close().catch(()=>{});audio=null;sound=false;
 session?.dispose();session=null;saves=null;pressed.clear();busy=false;
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
  status(`Running ${metadata.title||metadata.gameId}.`);canvas.tabIndex=0;canvas.focus();startFrames();
  saveTimer=setInterval(()=>{if(session===owned&&owned.booted&&!owned.closed&&!exiting&&!busy)saves.cards(owned.adapter).catch(error=>status(error.message));},15000);
 });
}
get('boot').onclick=boot;
async function pause(){
 pressed.clear();if(!session?.booted||session.paused)return;stopFrames();
 try{await session.pause();await audio?.setMuted(true);await audio?.context?.suspend();await saves?.cards(session.adapter);}
 catch(error){status(error.message);}controls();
}
get('pause').onclick=async()=>{
 if(!session?.paused)return pause();
 try{if(sound)await audio?.ensureContext();await session.resume();if(sound)await audio?.setMuted(false);canvas.focus();startFrames();}
 catch(error){status(error.message);}controls();
};
get('sound').onclick=async()=>{
 if(!audio||!session?.booted)return;
 try{sound=!sound;session.adapter.setAudioMuted(!sound);await audio.setMuted(!sound||session.paused);}
 catch(error){sound=false;status(error.message);}controls();
};
async function stateAction(load){
 if(busy||!session?.booted)return;busy=true;controls();const owned=session,wasPaused=owned.paused;
 try{
  status(load?'Loading state…':'Saving state…');await audio?.setMuted(true);
  // Dolphin file state functions marshal onto its CPU thread and work while paused.
  await owned.pause();stopFrames();const slot=Number(get('slot').value);
  await (load?saves.loadState(owned.adapter,slot):saves.saveState(owned.adapter,slot));
  status(load?'State loaded.':'State saved.');
 }catch(error){status(error.message);}
 finally{if(session===owned&&!owned.closed){if(!wasPaused){await owned.resume();if(sound)await audio?.setMuted(false);startFrames();}busy=false;controls();}}
}
get('save').onclick=()=>stateAction(false);get('load').onclick=()=>stateAction(true);
get('backLibrary').onclick=event=>{event.preventDefault();close({leave:true});};
get('close').onclick=()=>close({leave:!!props?.rom});get('exit').onclick=()=>close({leave:true});
addEventListener('keydown',event=>{if(event.code==='Escape'){pause();return;}if(!session?.booted||session.paused||event.target?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName))return;if(KEYS[event.code]){pressed.add(KEYS[event.code]);event.preventDefault();}});
addEventListener('keyup',event=>{if(KEYS[event.code])pressed.delete(KEYS[event.code]);});
for(const button of document.querySelectorAll('[data-key]')){
 button.onpointerdown=event=>{event.preventDefault();button.setPointerCapture(event.pointerId);pressed.add(button.dataset.key);};
 button.onpointerup=button.onpointercancel=()=>pressed.delete(button.dataset.key);
}
addEventListener('blur',pause);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
addEventListener('pagehide',()=>{dispose();});
addEventListener('message',async event=>{
 if(!embedded||event.source!==parent||event.origin!==location.origin||event.data!=='exit')return;
 await close();if(!session)event.source.postMessage('exitComplete',event.origin);
});
fetch('core-info.json').then(r=>r.json()).then(info=>{get('details').textContent=`Dolphin ${info.dolphinCommit.slice(0,7)}. Device WebGPU required. Local saves and connected Nextcloud sync.`;}).catch(()=>{});
controls();
if(props?.rom){await select(signal=>remoteDisc(props.rom,{signal}));if(selected)await boot();}
