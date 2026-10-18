// Wii uses the same bounded nine-field transport as GameCube, with its own ABI.
export const BUTTONS=Object.freeze({A:1,B:2,X:4,Y:8,START:16,L:32,R:64,Z:128,
 D_UP:256,D_DOWN:512,D_LEFT:1024,D_RIGHT:2048,HOME:4096,POINTER:8192});
export const KEYS=Object.freeze({KeyX:'A',KeyZ:'B',Digit1:'X',Digit2:'Y',Enter:'START',
 KeyQ:'L',KeyE:'R',Minus:'Z',Home:'HOME',ArrowUp:'D_UP',ArrowDown:'D_DOWN',
 ArrowLeft:'D_LEFT',ArrowRight:'D_RIGHT',KeyW:'STICK_UP',KeyS:'STICK_DOWN',KeyA:'STICK_LEFT',KeyD:'STICK_RIGHT'});
const PAD={0:'A',1:'B',2:'X',3:'Y',4:'L',5:'R',8:'Z',9:'START',16:'HOME',12:'D_UP',13:'D_DOWN',14:'D_LEFT',15:'D_RIGHT'};
const byte=n=>Math.max(0,Math.min(255,Math.round(n)));
const axis=(value=0,invert=false)=>!Number.isFinite(value)||Math.abs(value)<=.2?128:
 byte(128+(invert?-1:1)*Math.sign(value)*(Math.min(1,Math.abs(value))-.2)/.8*96);
export function padState(pressed=new Set(),pad=null,state={}){
 if(pad?.mapping!=='standard')pad=null;
 state.mask=0;for(const key of pressed)state.mask|=BUTTONS[key]||0;
 if(pad)for(const [index,key]of Object.entries(PAD))if(pad.buttons[index]?.pressed)state.mask|=BUTTONS[key];
 state.stickX=axis(pad?.axes[0]);state.stickY=axis(pad?.axes[1],true);
 for(const [field,negative,positive]of [['stickX','STICK_LEFT','STICK_RIGHT'],['stickY','STICK_DOWN','STICK_UP']])
  if(pressed.has(negative)||pressed.has(positive))state[field]=pressed.has(negative)===pressed.has(positive)?128:pressed.has(positive)?224:32;
 state.cStickX=128;state.cStickY=128;
 // Rest is 0g on X/Y and 1g on Z; no physical device sensor access.
 state.triggerLeft=128;state.triggerRight=128;state.analogA=154;state.analogB=128;
 return state;
}
export function applyMotion(state,motion){
 if(!motion?.active)return state;
 state.mask|=BUTTONS.POINTER | (byte(128+motion.dy*96)<<16);
 if(motion.down)state.mask|=motion.secondary?BUTTONS.B:BUTTONS.A;
 state.cStickX=byte(motion.x*255);state.cStickY=byte(motion.y*255);
 // Position supplies tilt; quick drags supply bounded swing/shake acceleration.
 state.triggerLeft=byte(128+(motion.x-.5)*48+motion.dx*100);
 state.triggerRight=byte(128+(motion.y-.5)*48+motion.dy*100);
 state.analogB=byte(128+motion.dx*96);
 state.analogA=byte(154+Math.min(1,Math.hypot(motion.dx,motion.dy))*65);
 return state;
}
export function attachMotion(target,{getCanvas,isActive,clock=()=>performance.now()}={}){
 const motion={active:false,down:false,secondary:false,x:.5,y:.5,dx:0,dy:0};
 let owned=null,last=0;
 const clear=()=>{owned=null;Object.assign(motion,{active:false,down:false,secondary:false,dx:0,dy:0});};
 function update(event){
  if(!isActive()||!['mouse','touch','pen'].includes(event.pointerType))return;
  if(event.target!==getCanvas()&&event.pointerId!==owned)return;
  if(owned!==null&&event.pointerId!==owned)return;
  const bounds=getCanvas().getBoundingClientRect();if(!bounds.width||!bounds.height)return;
  const x=Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width));
  const y=Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height));
  const now=clock(),elapsed=Math.max(8,now-last);
  motion.dx=motion.active?Math.max(-1,Math.min(1,(x-motion.x)*1000/elapsed)):0;
  motion.dy=motion.active?Math.max(-1,Math.min(1,(y-motion.y)*1000/elapsed)):0;
  Object.assign(motion,{active:true,x,y});last=now;
 }
 const down=event=>{if(event.target!==getCanvas()||!isActive()||owned!==null)return;update(event);owned=event.pointerId;
  motion.down=true;motion.secondary=event.button===2;getCanvas().setPointerCapture?.(owned);event.preventDefault();};
 const up=event=>{if(event.pointerId!==owned)return;update(event);motion.down=false;owned=null;
  if(event.pointerType!=='mouse')clear();};
 const leave=event=>{if(event.target===getCanvas()&&owned===null)clear();};
 const menu=event=>{if(event.target===getCanvas()&&isActive())event.preventDefault();};
 const listeners=[['pointerdown',down],['pointermove',update],['pointerup',up],['pointercancel',clear],['pointerout',leave],['contextmenu',menu],['blur',clear]];
 for(const [name,fn]of listeners)target.addEventListener(name,fn);
 return {motion,clear,sample(){if(clock()-last>60){motion.dx=0;motion.dy=0;}return motion;},dispose(){clear();for(const [name,fn]of listeners)target.removeEventListener(name,fn);}};
}
