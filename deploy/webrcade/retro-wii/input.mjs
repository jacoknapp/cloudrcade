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
 // Rest is 0g on X/Y and 1g on Z until touch or opt-in phone motion is applied.
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

export const LAYOUTS=Object.freeze({nunchuk:'Remote + Nunchuk',upright:'Remote upright',sideways:'Remote sideways'});
export function applyControllerLayout(state,layout='nunchuk'){
 if(layout==='nunchuk')return state;
 state.mask=(state.mask&~(BUTTONS.L|BUTTONS.R))|(1<<14);
 state.stickX=state.stickY=128;
 if(layout==='sideways'){
  const directions=state.mask&(BUTTONS.D_UP|BUTTONS.D_DOWN|BUTTONS.D_LEFT|BUTTONS.D_RIGHT);
  state.mask&=~directions;
  for(const [from,to]of [['D_UP','D_RIGHT'],['D_RIGHT','D_DOWN'],['D_DOWN','D_LEFT'],['D_LEFT','D_UP']])
   if(directions&BUTTONS[from])state.mask|=BUTTONS[to];
  const x=state.triggerLeft-128,y=state.triggerRight-128;
  state.triggerLeft=byte(128+y);state.triggerRight=byte(128-x);
  if(state.mask&(BUTTONS.POINTER|(1<<15))){
   const pitch=((state.mask>>>16)&255)-128,yaw=state.analogB-128;
   state.mask=(state.mask&~(255<<16))|(byte(128+yaw)<<16);state.analogB=byte(128-pitch);
  }
 }
 return state;
}
// DeviceMotion axes stay in the phone's natural orientation when its screen rotates.
export function screenAxes(x,y,z,angle=0){
 const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
 return {x:c*x+s*y,y:-s*x+c*y,z};
}
// Rotate the comfortable holding pose to neutral without inventing extra gravity.
export function alignGravity(v,reference){
 const length=Math.hypot(reference.x,reference.y,reference.z);
 if(length<.1)return v;
 const x=reference.x/length,y=reference.y/length,c=reference.z/length,s=Math.hypot(x,y);
 if(s<1e-6)return c>0?v:{x:v.x,y:-v.y,z:-v.z};
 const kx=y/s,ky=-x/s,dot=kx*v.x+ky*v.y;
 const clean=n=>Math.abs(n)<1e-10?0:n;
 return {x:clean(v.x*c+ky*v.z*s+kx*dot*(1-c)),y:clean(v.y*c-kx*v.z*s+ky*dot*(1-c)),z:clean(v.z*c+(kx*v.y-ky*v.x)*s)};
}
export function applyPhoneMotion(state,sample){
 if(!sample)return state;
 state.triggerLeft=byte(128+sample.x*26);state.triggerRight=byte(128+sample.y*26);
 state.analogA=byte(128+sample.z*26);
 state.mask=(state.mask&~(255<<16))|(1<<15)|(byte(128+sample.pitch*12)<<16);
 state.analogB=byte(128+sample.yaw*12);
 return state;
}
export function attachDeviceMotion(target,{isActive,clock=()=>performance.now(),getAngle=()=>target.screen?.orientation?.angle??target.orientation??0}={}){
 let enabled=false,baseline=null,reading=null,last=0,generation=0;
 const clear=()=>{baseline=null;reading=null;};
 const receive=event=>{
  if(!enabled||target.document?.hidden||!isActive()){clear();return;}
  const a=event.accelerationIncludingGravity;
  if(!a||![a.x,a.y,a.z].every(Number.isFinite))return;
  const angle=getAngle(),g=screenAxes(a.x/9.80665,a.y/9.80665,a.z/9.80665,angle);
  if(!baseline||baseline.angle!==angle)baseline={...g,angle};
  const rate=event.rotationRate;
  const r=rate&&[rate.beta,rate.gamma].every(Number.isFinite)?screenAxes(rate.beta,rate.gamma,Number.isFinite(rate.alpha)?rate.alpha:0,angle):{x:0,y:0,z:0};
  const neutral=alignGravity(g,baseline),rotation=alignGravity(r,baseline);
  reading={...neutral,pitch:rotation.x*Math.PI/180,yaw:rotation.y*Math.PI/180};last=clock();
 };
 const disable=()=>{generation++;enabled=false;clear();target.removeEventListener('devicemotion',receive);};
 const hidden=()=>{if(target.document?.hidden)clear();};
 target.addEventListener('blur',clear);target.addEventListener('orientationchange',clear);
 target.addEventListener('pagehide',disable);target.screen?.orientation?.addEventListener('change',clear);
 target.document?.addEventListener('visibilitychange',hidden);
 return {get enabled(){return enabled;},clear,disable,
  async enable(){
   const request=++generation,api=target.DeviceMotionEvent;
   if(target.isSecureContext===false)return 'Requires HTTPS';
   if(!api)return 'Unavailable on this device';
   try{
    // Called directly from the player's tap, as required by Safari.
    if(typeof api.requestPermission==='function'&&await api.requestPermission()!=='granted')return 'Permission denied';
    if(request!==generation)return 'Off';
    enabled=true;clear();target.addEventListener('devicemotion',receive);return 'On';
   }catch(_){return 'Permission denied';}
  },
  sample(){if(!enabled||target.document?.hidden||!isActive()||clock()-last>350){clear();return null;}return reading;},
  dispose(){disable();target.removeEventListener('blur',clear);target.removeEventListener('orientationchange',clear);target.removeEventListener('pagehide',disable);target.screen?.orientation?.removeEventListener('change',clear);target.document?.removeEventListener('visibilitychange',hidden);}
 };
}
