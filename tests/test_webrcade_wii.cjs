// Wii input and save contracts. No games, keys or accounts; synthetic device sensor events only.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../deploy/webrcade/retro-wii');
(async()=>{
 const {padState,applyMotion,attachMotion,BUTTONS,applyControllerLayout,applyPhoneMotion,attachDeviceMotion,screenAxes,alignGravity}=await import(pathToFileURL(path.join(root,'input.mjs')));
 const rest=padState();assert.equal(rest.triggerLeft,128);assert.equal(rest.triggerRight,128);assert.equal(rest.analogA,154);assert.equal(rest.mask,0);
 const keys=padState(new Set(['A','L','R','HOME','STICK_UP']));assert.equal(keys.mask,BUTTONS.A|BUTTONS.L|BUTTONS.R|BUTTONS.HOME);assert.equal(keys.stickY,224);
 assert.equal(keys.triggerLeft,128,'C must not overwrite accelerometer X');assert.equal(keys.analogA,154,'A must not overwrite accelerometer Z');
 const pad={mapping:'standard',axes:[1,-1],buttons:Array.from({length:17},()=>({pressed:false}))};pad.buttons[9].pressed=true;
 assert.equal(padState(new Set(),pad).mask,BUTTONS.START);assert.equal(padState(new Set(),pad).stickY,224);
 assert.equal(padState(new Set(),{...pad,mapping:''}).mask,0);
 const input=applyMotion(padState(),{active:true,down:true,x:1,y:0,dx:1,dy:-1});
 assert(input.mask&BUTTONS.A);assert(input.mask&BUTTONS.POINTER);assert.equal(input.cStickX,255);assert.equal(input.cStickY,0);assert(input.triggerLeft>128);assert(input.triggerRight<128);
 const target=new EventTarget();let now=100,enabled=true;
 const canvas={getBoundingClientRect:()=>({left:20,top:10,width:200,height:100}),setPointerCapture(){}};
 const motion=attachMotion(target,{getCanvas:()=>canvas,isActive:()=>enabled,clock:()=>now});
 function send(type,props={}){const e=new Event(type,{cancelable:true});for(const [k,v]of Object.entries({target:canvas,pointerType:'touch',pointerId:1,clientX:120,clientY:60,button:0,...props}))Object.defineProperty(e,k,{value:v});target.dispatchEvent(e);return e;}
 assert(send('pointerdown').defaultPrevented);assert.equal(motion.motion.x,.5);assert.equal(motion.motion.y,.5);assert(motion.motion.down);
 now+=16;send('pointermove',{clientX:180});assert(motion.sample().dx>0);now+=70;assert.equal(motion.sample().dx,0,'motion acceleration decays without new events');
 send('pointerup');assert(!motion.motion.active&&!motion.motion.down,'touch release clears pointer and click');
 send('pointerdown',{pointerType:'mouse',button:2});assert(applyMotion(padState(),motion.sample()).mask&BUTTONS.B);
 send('pointercancel');assert(!motion.motion.active);send('pointerdown');target.dispatchEvent(new Event('blur'));assert(!motion.motion.active);
 enabled=false;send('pointerdown');assert(!motion.motion.active,'menus and pause do not send motion');
 enabled=true;send('pointerdown',{target:{}});assert(!motion.motion.active,'controller overlay touches do not become pointer gestures');motion.dispose();
 const sideways=applyControllerLayout(padState(new Set(['D_UP','D_LEFT','L','STICK_UP'])),'sideways');
 assert.equal(sideways.mask&(BUTTONS.D_RIGHT|BUTTONS.D_UP),BUTTONS.D_RIGHT|BUTTONS.D_UP);
 assert(sideways.mask&(1<<14),'Remote-only modes disconnect the extension');assert(!(sideways.mask&BUTTONS.L));assert.equal(sideways.stickY,128);
 assert(!(applyControllerLayout(padState(),'nunchuk').mask&(1<<14)));
 const portrait=screenAxes(1,0,0,0),landscape=screenAxes(1,0,0,90),reverse=screenAxes(1,0,0,270);
 assert.equal(portrait.x,1);assert(Math.abs(landscape.y+1)<1e-9);assert(Math.abs(reverse.y-1)<1e-9);
 const tilted=alignGravity({x:0,y:0,z:1},{x:0,y:1,z:0});assert(Math.abs(Math.hypot(tilted.x,tilted.y,tilted.z)-1)<1e-9,'recenter rotates gravity, not a false shake-producing offset');
 const device=new EventTarget();device.document=new EventTarget();device.screen={orientation:new EventTarget()};device.screen.orientation.angle=0;
 let permissions=0,active=true,time=500;
 device.DeviceMotionEvent={requestPermission:async()=>{permissions++;return 'granted';}};
 const sensor=attachDeviceMotion(device,{isActive:()=>active,clock:()=>time});
 assert.equal(permissions,0,'access is never requested on page load');assert.equal(await sensor.enable(),'On');assert.equal(permissions,1);
 function accelerate(x,y,z,rate={beta:0,gamma:0}){const e=new Event('devicemotion');Object.defineProperties(e,{accelerationIncludingGravity:{value:{x,y,z}},rotationRate:{value:rate}});device.dispatchEvent(e);}
 accelerate(0,9.80665,0);assert.deepEqual(sensor.sample(),{x:0,y:0,z:1,pitch:0,yaw:0});
 accelerate(9.80665,9.80665,0,{beta:90,gamma:0});assert.equal(sensor.sample().x,1);
 const physical=applyPhoneMotion(padState(),sensor.sample());assert.equal(physical.triggerLeft,154);assert(physical.mask&(1<<15));assert(!(physical.mask&BUTTONS.POINTER),'physical motion does not invent IR coordinates');
 device.screen.orientation.angle=90;accelerate(9.80665,0,0);assert.equal(sensor.sample().x,0,'screen rotation automatically recenters');
 accelerate(9.80665,9.80665,0);assert(Math.abs(sensor.sample().x-1)<1e-9,'screen-relative axes follow landscape');
 active=false;assert.equal(sensor.sample(),null,'paused/menu input returns neutral');active=true;accelerate(0,9.80665,0);assert.equal(sensor.sample().x,0);
 time+=400;assert.equal(sensor.sample(),null,'stale sensor readings never stick');
 sensor.disable();accelerate(9.80665,0,0);assert.equal(sensor.sample(),null);sensor.dispose();
 const denied=new EventTarget();denied.DeviceMotionEvent={requestPermission:async()=> 'denied'};
 const blocked=attachDeviceMotion(denied,{isActive:()=>true});assert.equal(await blocked.enable(),'Permission denied');assert(!blocked.enabled);blocked.dispose();
 const missing=attachDeviceMotion(new EventTarget(),{isActive:()=>true});assert.equal(await missing.enable(),'Unavailable on this device');missing.dispose();
 const {importNand,exportNand}=await import(pathToFileURL(path.join(root,'nand.mjs')));
 const files=new Map(),dirs=new Set(['/']);
 const fs={mkdirTree(p){for(let s=p;s;s=s.slice(0,s.lastIndexOf('/')))dirs.add(s);},writeFile:(p,b)=>files.set(p,new Uint8Array(b)),readFile:p=>files.get(p),
 readdir(p){p=p.replace(/\/$/,'');if(!dirs.has(p))throw Error('missing');return ['.','..',...new Set([...dirs,...files.keys()].filter(v=>v.startsWith(p+'/')).map(v=>v.slice(p.length+1).split('/')[0]).filter(Boolean))];},
 lstat:p=>({mode:dirs.has(p)?'dir':'file'}),isDir:m=>m==='dir',isFile:m=>m==='file'};
 const saved=[{name:'00010000/52544545/data/save.dat',content:Uint8Array.of(1,2,3)}];
 assert.equal(importNand(fs,saved),1);assert.equal(files.size,2,'both persistent and temporary NAND roots restored');
 assert.deepEqual(exportNand(fs),saved,'session and persistent copies merge into one record');
 for(const name of ['../../keys.bin','00010000/52544545/content/boot.app','00010000/52544545/data/../ticket','00010000/52544545/data/a\\b'])assert.throws(()=>importNand(fs,[{name,content:new Uint8Array(1)}]),/Invalid Wii save path/);
 console.log('PASS Wii Remote/Nunchuk masks, neutral acceleration, touch/mouse geometry and release, pause isolation, NAND data-only roundtrip/path validation');
})().catch(e=>{console.error(e);process.exitCode=1;});
