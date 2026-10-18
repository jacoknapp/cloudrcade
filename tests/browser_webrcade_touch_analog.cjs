// Real shared pointer handlers and PS2/GameCube input consumers. Optional exact
// packaged N64/PSX/PSP/3DS source maps execute their real native-call boundaries.
// NODE_PATH=<playwright> [CHROME=...] [WEBRCADE_TEST_WEBKIT_PATH=...] node this-file
// WEBRCADE_TEST_ASSET_ORIGIN loads served overlay/adapters (source is default).
// WEBRCADE_TEST_ANALOG_CONSUMERS=<dir> contains <core>/js/*.map from the image.
// No ROMs, GPU, cloud accounts or operator preferences are used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {chromium,webkit,request}=require('playwright');
const root=process.env.WEBRCADE_TEST_SOURCE_ROOT||path.join(__dirname,'../deploy/webrcade');
const assets={
 'controller.js':['touch/assets/controller.js','touch-controls/controller.js'],
 'controller.css':['touch/assets/controller.css','touch-controls/controller.css'],
 'ps2.mjs':['retro-play/app/input.mjs','experimental/ps2/input.mjs'],
 'gc.mjs':['retro-dolphin/app/input.mjs','experimental/gamecube/input.mjs'],
 'lab.mjs':['retro-dolphin/app/lab.mjs','experimental/gamecube/lab.mjs']};
const hash=value=>createHash('sha256').update(value).digest('hex');
function method(source,name){
 const start=source.indexOf('  '+name+'(');assert(start>=0,name+' exists in packaged consumer');
 const end=source.indexOf('\n  }',start);assert(end>start,name+' end');
 return source.slice(start,end+4).trim();
}
function packagedConsumers(){
 const directory=process.env.WEBRCADE_TEST_ANALOG_CONSUMERS;if(!directory)return '';
 let code='';
 for(const core of ['n64','psx','psp','3ds']){
  const maps=fs.readdirSync(path.join(directory,core,'js')).filter(n=>n.endsWith('.map'));
  const sources=new Map();
  for(const name of maps){const bytes=fs.readFileSync(path.join(directory,core,'js',name)),map=JSON.parse(bytes);
   console.log('CONSUMER',core,name,hash(bytes));
   map.sources.forEach((name,i)=>sources.set(name,map.sourcesContent[i]));}
  const controls=[...sources].find(([n])=>n.endsWith('input/controls.js'))?.[1];assert(controls,core+' controls');
  const cids=controls.slice(controls.indexOf('const CIDS'),controls.indexOf('export const KCODES'));
  const source=[...sources].find(([n,s])=>core==='n64'?n==='emulator/index.js':n.endsWith('app/retrowrapper/index.js'))?.[1];assert(source,core+' poll source');
  const constants=core==='n64'?source.slice(source.indexOf('const UP ='),source.indexOf('// class N64KeyCode')):'';
  const adapter=[...sources].find(([n])=>n==='emulator/index.js')?.[1];
  const adapterConstants=core==='psp'?adapter.slice(adapter.indexOf('const BUTTONS ='),adapter.indexOf('export class Emulator')):core==='3ds'?adapter.slice(adapter.indexOf('const BUTTON_MAP ='),adapter.indexOf('// Keep every JS/worker/WASM')):'';
  const methods=method(source,'pollControls')+(core==='n64'?'':','+method(source,'sendInput'));
  code+=`if(core===${JSON.stringify(core)}){${cids}\n${constants}\nconst consumer={${methods}};
    Object.assign(consumer,{controllers:window.controllers,CONTROLLER_COUNT:1,analogMode:true,
      keyToControlMapping:{isControlDown:()=>false},isEscapeHackEnabled:()=>false,getDisableInput:()=>false,
      getControllerIndex:i=>i,n64module:{_updateControls:(...args)=>{if(!args[0])nativeCalls=args}}});
    ${[...new Set(source.match(/this\.INP_\w+/g))].map((field,i)=>`consumer.${field.slice(5)}=${1<<i};`).join('')}
    window.Module={_wrc_set_input:(...args)=>nativeCalls=args};
    ${['psp','3ds'].includes(core)?`${adapterConstants}
const adapter={${method(adapter,'applyInput')},lastInput:{}};Object.assign(adapter,consumer);
      window.nativeAxes=Array(${core==='psp'?4:8}).fill(0);
      Module._simulate_input=(port,id,value)=>{if(!port&&id>=16)nativeAxes[id-16]=value};
      Module._wrc_set_input=(...args)=>{nativeCalls=args;adapter.applyInput(Module,...args)};`:''}
    window.pollNative=()=>consumer.pollControls();
  }\n`;
 }
 return code;
}
(async()=>{
 const loaded={},origin=process.env.WEBRCADE_TEST_ASSET_ORIGIN;
 const client=origin?await request.newContext({ignoreHTTPSErrors:true}):null;
 try{for(const [name,[file,url]]of Object.entries(assets)){
  if(client){const response=await client.get(new URL(url,origin.replace(/\/?$/,'/')).href);assert(response.ok(),name+' HTTP '+response.status());loaded[name]=await response.text();}
  else loaded[name]=fs.readFileSync(path.join(root,file),'utf8');
  console.log('ASSET',origin?'served':'source',name,hash(loaded[name]));
 }}finally{await client?.dispose()}
 const consumers=packagedConsumers();
 const gc=loaded['lab.mjs'];
 const merge=gc.slice(gc.indexOf('const TOUCH_BUTTONS='),gc.indexOf('\nfunction fitCanvas(){'));
 assert(merge.includes('function mergeTouchInput'), 'actual GC consumer extracted');
 const setup=`
 const core=location.pathname.split('/')[3];
 Object.defineProperty(navigator,'maxTouchPoints',{value:5});
 Object.defineProperty(navigator,'getGamepads',{value:()=>[]});
 window.WrcadCloudConfig={storagePrefix:'analog-fixture'};
 window.cloudWrites=[];window.WrcadCloud={controlsChanged:p=>cloudWrites.push(p)};
 window.physical=[0,0,0,0];window.keyboard=new Set();
 const controller={isControlDown:()=>false,isPadButtonDown:()=>false,
  getAxisValue:(index,isX)=>physical[index*2+(isX?0:1)],
  isAxisLeft:i=>physical[i*2]<-.5,isAxisRight:i=>physical[i*2]>.5,
  isAxisUp:i=>physical[i*2+1]<-.5,isAxisDown:i=>physical[i*2+1]>.5};
 window.controllers={getController:()=>controller,poll(){}};
 for(const key of ['getAxisValue','isControlDown','isPadButtonDown','isAxisLeft','isAxisRight','isAxisUp','isAxisDown'])
  controllers[key]=(index,...args)=>index===0?controller[key](...args):0;
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;document.body.append(canvas);
 window.pauseCalls=0;window.nativeCalls=null;window.nativeAxes=null;window.pollNative=()=>{};
 window.app={isShowOverlay:()=>false,isPauseScreen:()=>false,emulator:{started:true,paused:false,canvas,controllers,
  getScreenSize:()=>0,getProps:()=>({}),getDefaultAspectRatio:()=>4/3,updateScreenSize(){},
  getPrefs:()=>({getScreenLayout:()=>0}),getScreenLayout:()=>0,pause(v){pauseCalls++;this.paused=v;return true}}};
 window.WrcadGameCube={menuOpen(){}};window.WrcadPS2={menuOpen(){}};
 const {inputState,inputWriter}=await import('/ps2.mjs');const {BUTTONS,padState}=await import('/gc.mjs');
 window.ps2Native=null;const writePS2=inputWriter((...args)=>{ps2Native=args});
 window.rawPS2=(axes,touchAxes=[0,0,0,0],keys=[])=>{const state=inputState(new Set(keys),{axes,buttons:[]},
  {getAxisValue:(index,isX)=>touchAxes[index*2+(isX?0:1)],isControlDown:()=>false});writePS2(0,state);return ps2Native;};
 ${merge}\n${consumers}
 window.sample=()=>{pollNative();const state=padState(keyboard,{mapping:'standard',axes:[0,0,0,0],buttons:[]});mergeTouchInput(state);
  const ps2=inputState(keyboard,{axes:[0,0,0,0],buttons:[]},controller);writePS2(0,ps2);
  return {axes:[controller.getAxisValue(0,true),controller.getAxisValue(0,false),controller.getAxisValue(1,true),controller.getAxisValue(1,false)],
   ps2,ps2Native,gc:[state.stickX,state.stickY,state.cStickX,state.cStickY],
   digital:[0,1,2,3].map(cid=>controller.isControlDown(cid)),native:nativeCalls,nativeAxes};};
 const script=document.createElement('script');script.src='/controller.js';document.body.append(script);
 `;
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,executablePath:engine===chromium?process.env.CHROME:process.env.WEBRCADE_TEST_WEBKIT_PATH,
   ...(engine===chromium?{args:['--no-sandbox']}:{})});
  try{
   const page=await browser.newPage({hasTouch:true,viewport:{width:430,height:932}}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('http://analog.test/**',route=>{const name=new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill(name in loaded?{contentType:name.endsWith('.css')?'text/css':'application/javascript',body:loaded[name]}:
     {contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/controller.css"><style>body{margin:0}canvas{position:fixed;width:200px;height:150px}</style><script type="module">'+setup+'</script>'});});
   const cdp=engine===chromium?await page.context().newCDPSession(page):null;
   let active=false,last={x:0,y:0};
   const move=async(point,start=false)=>{last=point;if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:start?'touchStart':'touchMove',touchPoints:[{id:1,...point}]});}
    else{if(start){await page.mouse.move(point.x,point.y);await page.mouse.down();}
     // WebKit's desktop mouse protocol truncates CSS coordinates. Use its real
     // captured pointer, then a fractional touch move to test subpixel values.
     await page.locator('.kt-pad').dispatchEvent('pointermove',{clientX:point.x,clientY:point.y,pointerId:1,pointerType:'touch',bubbles:true});}active=true;};
   const release=async()=>{if(!active)return;if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();active=false;};
   const near=(a,b,label,tolerance=.0001)=>assert(Math.abs(a-b)<=tolerance,label+': '+a+' expected '+b);
   const ps2Bytes=axes=>[0,1].flatMap(index=>{const x=axes[index*2],y=axes[index*2+1],extent=Math.max(Math.abs(x),Math.abs(y));
    const magnitude=Math.min(1,Math.hypot(x,y));return [x,y].map(v=>Math.round(128+127*(extent?v*(magnitude/extent):0)));});
   for(const core of ['n64','3ds','psp','psx','ps2','gamecube']){
    await page.goto('http://analog.test/play/app/'+core+'/');await page.locator('.kt-pad').waitFor({state:'visible'});await page.waitForTimeout(220);
    const sticks=page.locator('[data-direction="analog"]');const count=await sticks.count();assert.equal(count,['3ds','psx','ps2','gamecube'].includes(core)?2:1);
    for(let index=0;index<count;index++){
     const rect=await sticks.nth(index).boundingBox(),center={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
     const point=(x,y)=>({x:center.x+rect.width*.34*x,y:center.y+rect.height*.34*y});
     const check=async(x,y,label)=>{
      const actual=await page.evaluate(()=>sample()),expected=[0,0,0,0];expected[index*2]=x;expected[index*2+1]=y;
      const bytes=ps2Bytes(actual.axes);
      expected.forEach((v,i)=>{near(actual.axes[i],v,label+' axis '+i);assert.equal(actual.ps2[i+1],bytes[i],label+' PS2 byte '+i);assert.equal(actual.gc[i],Math.round(128+96*(i%2?-actual.axes[i]:actual.axes[i])),label+' GC byte '+i);});
      assert.deepEqual(actual.ps2Native,[0,...actual.ps2],label+' actual PS2 inputWriter/setInput boundary');
      assert(actual.digital.every(v=>!v),label+' analog remains separate from D-pad');
      if(consumers&&['n64','psx','psp','3ds'].includes(core)){
       const values=core==='n64'?expected.slice(0,2).map(v=>(v*32767)|0):expected;
       values.forEach((v,i)=>near(actual.native[i+2],v,label+' packaged native-call argument '+i,core==='n64'?3:.0001));
       if(actual.nativeAxes){const directional=expected.slice(0,core==='psp'?2:4).flatMap(v=>[Math.round(Math.max(v,0)*32767),Math.round(Math.max(-v,0)*32767)]);directional.forEach((v,i)=>near(actual.nativeAxes[i],v,label+' real simulate_input axis '+i,1));}
      }
      return actual;
     };
     await move(center,true);await check(0,0,core+' center');
     const table=[];
     for(const raw of [0,.1,.25,.5,.75,1]){
      await move(point(raw,0));const value=Math.max(0,(raw-.1)/.9);await check(value,0,core+' travel '+raw);table.push([raw,value]);
     }
     const outputs=[];
     for(const magnitude of [0,.01,.05,.1,.25,.5,.75,1]){
      const raw=magnitude? .1+.9*magnitude:0;await move(point(raw,0));const sample=await check(magnitude,0,core+' output '+magnitude);outputs.push({magnitude,ps2:sample.ps2.slice(1),gc:sample.gc,native:sample.native,nativeAxes:sample.nativeAxes});
      await move(point(-raw,0));await check(-magnitude,0,core+' negative '+magnitude);
      await move(point(0,raw));await check(0,magnitude,core+' Y '+magnitude);
     }
     for(const raw of [.099,.1,.1001,.101,.11,.12]){await move(point(raw,0));await check(Math.max(0,(raw-.1)/.9),0,core+' no center jump '+raw);}
     for(const [x,y]of [[.8,.6],[-.8,-.6],[1.6,1.2],[.9,.15]]){
      const length=Math.hypot(x,y),magnitude=Math.max(0,(Math.min(length,1)-.1)/.9);
      await move(point(x,y));await check(x/length*magnitude,y/length*magnitude,core+' diagonal');
     }
     if(core==='ps2'){
      // Every quadrant, cardinals, exact and shallow diagonals: circular finger
      // travel must continuously reach the independent PS2 axis range.
      for(const degrees of [0,15,30,45,60,75,90,135,180,225,270,315]){
       const angle=degrees*Math.PI/180,dx=Math.cos(angle),dy=Math.sin(angle),extent=Math.max(Math.abs(dx),Math.abs(dy));
       let previous=[128,128];
       for(const magnitude of [0,.001,.01,.05,.1,.25,.5,.75,1]){
        const raw=magnitude ? .1+.9*magnitude : 0;
        await move(point(dx*raw,dy*raw));const sample=await check(dx*magnitude,dy*magnitude,'PS2 '+degrees+'deg '+magnitude);
        const bytes=sample.ps2.slice(1+index*2,3+index*2);
        bytes.forEach((byte,i)=>assert(Math.abs(byte-128)>=Math.abs(previous[i]-128),'PS2 diagonal byte progression'));previous=bytes;
        if(magnitude===1){const expected=[dx/extent,dy/extent].map(v=>Math.round(128+127*v));assert.deepEqual(bytes,expected,'PS2 full-range native diagonal');}
       }
      }
      // Captured drags beyond the circular surface keep the same full range.
      for(const [x,y]of [[2,2],[-2,2],[-2,-2],[2,-2]]){await move(point(x,y));const sample=await check(Math.sign(x)*Math.SQRT1_2,Math.sign(y)*Math.SQRT1_2,'PS2 beyond-radius diagonal');
       assert.deepEqual(sample.ps2.slice(1+index*2,3+index*2),[x,y].map(v=>v>0?255:1),'PS2 saturated native corner');}
     }
     await release();await check(0,0,core+' release');
     await move(point(.55,0),true);await page.evaluate(()=>dispatchEvent(new Event('blur')));await check(0,0,core+' blur');await release();
     await move(point(.55,0),true);await page.evaluate(()=>{app.emulator.paused=true});await page.waitForTimeout(190);await check(0,0,core+' paused');await release();
     await page.evaluate(()=>{app.emulator.paused=false});await page.waitForTimeout(190);await check(0,0,core+' resume no stale axis');
     await move(point(.55,0),true);await page.evaluate(()=>document.querySelector('.kt-tab').click());await check(0,0,core+' drawer');await release();
     // The normal switch and always-button UI share the same effective input gate.
     await page.evaluate(()=>{const toggle=document.querySelector('.kt-gamepad-touch');if(toggle&&!toggle.hidden)toggle.click();else document.querySelector('.kt-toggle').click();});
     await check(0,0,core+' controls off');
     await page.evaluate(()=>{const toggle=document.querySelector('.kt-gamepad-touch');if(toggle&&!toggle.hidden)toggle.click();else document.querySelector('.kt-toggle').click();document.querySelector('.kt-tab').click();});
     await page.waitForTimeout(190);await check(0,0,core+' controls on no stale axis');
     console.log('PASS',engine.name(),core,'stick',index,'travel/output',JSON.stringify(table),'consumer output',JSON.stringify(outputs));
    }
    if(cdp&&count===2){
     const rects=await sticks.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}));
     const touches=rects.map((r,i)=>{const raw=i?(core==='ps2'?-.64:-.55):.325,diagonal=core==='ps2'?Math.SQRT1_2:1;
      return {id:i+1,x:r.x+r.width/2+r.width*.34*raw*diagonal,y:r.y+r.height/2+(core==='ps2'?r.height*.34*raw*diagonal:0)};});
     await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches});
     let both=await page.evaluate(()=>sample());near(both.axes[0],core==='ps2'?.25*Math.SQRT1_2:.25,core+' simultaneous left');near(both.axes[2],core==='ps2'?-.6*Math.SQRT1_2:-.5,core+' simultaneous right');
     if(core==='ps2'){near(both.axes[1],.25*Math.SQRT1_2,'PS2 simultaneous left Y');near(both.axes[3],-.6*Math.SQRT1_2,'PS2 simultaneous right Y');assert.deepEqual(both.ps2Native,[0,0,160,160,52,52]);}
     await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[touches[0]]});
     both=await page.evaluate(()=>sample());near(both.axes[0],0,core+' left independently released');near(both.axes[2],core==='ps2'?-.6*Math.SQRT1_2:-.5,core+' right still held');
     if(core==='ps2')assert.deepEqual(both.ps2Native,[0,0,128,128,52,52],'PS2 diagonal independent release');
     await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
     assert((await page.evaluate(()=>sample())).axes.every(v=>v===0),core+' native touch cancellation releases both');
    }
    const dpad=page.locator('[data-direction="digital"]'),r=await dpad.boundingBox();
    await move({x:r.x+r.width*.84,y:r.y+r.height/2},true);let s=await page.evaluate(()=>sample());assert.equal(s.digital[3],true,core+' D-pad right');assert(s.axes.every(v=>v===0),core+' D-pad never becomes analog');await release();
    await page.evaluate(()=>physical=[-.73,.38,.64,-.27]);s=await page.evaluate(()=>sample());assert.deepEqual(s.axes,[-.73,.38,.64,-.27],core+' untouched physical fractions');
    assert.deepEqual(s.ps2.slice(1),ps2Bytes(s.axes),core+' PS2 calibrated physical bytes');
    if(core==='ps2'){
     // Actual PS2 physical source stays separate from the dedicated touch
     // controller. Full circular diagonals and existing square corners agree.
     for(const [x,y]of [[1,1],[-1,1],[-1,-1],[1,-1]]){
      const corner=[x,y,x,y].map(v=>v>0?255:1),circle=[x,y,x,y].map(v=>v*Math.SQRT1_2);
      for(const axes of [[x,y,x,y],circle]){const result=await page.evaluate(axes=>rawPS2(axes),axes);assert.deepEqual(result,[0,0,...corner],'PS2 physical full corner');}
     }
     const physicalOutputs=[];
     for(const magnitude of [0,.001,.01,.05,.1,.25,.5,.75,1]){
      const axes=[1,1,-1,-1].map(v=>v*Math.SQRT1_2*magnitude),result=await page.evaluate(axes=>rawPS2(axes),axes);
      // Cross-engine hypot can differ by one ulp at an ideal half-byte tie.
      // Compare to the independent requested radial strength within one byte;
      // exact measured-float conversion is checked in each pointer sample.
      result.slice(2).forEach((byte,i)=>near(byte,Math.round(128+127*(i<2?1:-1)*magnitude),'PS2 physical nuanced diagonal',1));
      physicalOutputs.push({magnitude,bytes:result.slice(2)});
     }
     console.log('PS2',engine.name(),'physical diagonal native',JSON.stringify(physicalOutputs));
     const calibrated=await page.evaluate(()=>rawPS2([.5,.5,0,0]));assert.deepEqual(calibrated,[0,0,218,218,128,128],'PS2 partial square diagonal calibration');
     const merged=await page.evaluate(()=>rawPS2([0,.5,.5,0],[.25,0,0,-.25]));assert.deepEqual(merged,[0,0,160,192,192,96],'PS2 calibrate each source before component merge');
     const overridden=await page.evaluate(()=>rawPS2([Math.SQRT1_2,Math.SQRT1_2,0,0],[0,0,0,0],['KeyF','KeyG']));assert.deepEqual(overridden,[0,0,1,255,128,128],'PS2 keyboard overrides calibrated sources');
    }
    await page.evaluate(()=>physical=[0,0,0,0]);assert.equal(await page.evaluate(()=>pauseCalls),0,core+' no extra pause calls');assert.deepEqual(errors,[]);
   }
  }finally{await browser.close()}
 }
 console.log('PASS proportional shared touch, native adapter bytes and optional packaged consumer boundaries (no native VM execution)');
})().catch(error=>{console.error(error);process.exitCode=1});
