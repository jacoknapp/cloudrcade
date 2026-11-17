// Real WebGL presentation, native view methods and actual browser touch events.
// Synthetic screen patterns only; no ROMs, BIOS, accounts or preview flags.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'../deploy/webrcade');
const asset=name=>fs.readFileSync(path.join(process.env.WEBRCADE_TOUCH_ASSETS_ROOT||path.join(root,'touch/assets'),name),'utf8');
const source=fs.readFileSync(path.join(root,'retro-azahar/app/src/emulator/index.js'),'utf8');
const views=source.slice(source.indexOf('const VIEWS ='),source.indexOf('const FRAME_MS'));
const methods=['useView','getView','getViews','setView','getDefaultAspectRatio'].map(name=>source.match(new RegExp('\\n  '+name+'\\([^]*?\\n  }'))[0]).join('\n');
const fixture=`
const system=location.pathname.includes('azahar')?'3ds':'nds';
const VIEW_KEY='wrcad.touch.3ds-view.v1';${views}
class ThreeDS {${methods}}
let savedDS=4;const saved3DS='touch';
localStorage.setItem(VIEW_KEY,saved3DS);localStorage.setItem('webrcade.touch.3ds-view.v1',saved3DS);
const oldLayout={'button-8':[.5,.7],'button-10':[.5,.7],stick:[.5,.7],dpad:[.5,.7],'button-4':[.5,.7]};
localStorage.setItem('webrcade.touch.layouts.v1',JSON.stringify({[system+':portrait']:oldLayout,[system+':portrait:sections']:oldLayout,[system+':landscape']:oldLayout}));
window.pads=[];Object.defineProperty(navigator,'getGamepads',{value:()=>pads});
window.Module={cwrap(){return()=>{}}};
const canvas=document.createElement('canvas');document.body.append(canvas);
const gl=canvas.getContext(system==='3ds'?'webgl2':'webgl',{preserveDrawingBuffer:true,antialias:false});
if(!gl)throw Error('WebGL unavailable');window.gl=gl;
const shader=(kind,text)=>{const s=gl.createShader(kind);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s};
const v2=system==='3ds',header=v2?'#version 300 es\\n':'';
const vertex=header+(v2?'in':'attribute')+' vec2 p;'+(v2?'out':'varying')+' vec2 uv;void main(){uv=(p+1.)*.5;gl_Position=vec4(p,0,1);}';
const fragment=header+'precision mediump float;'+(v2?'in':'varying')+' vec2 uv;uniform vec4 topRect;uniform vec4 bottomRect;'+(v2?'out vec4 color;':'')+'bool inside(vec2 q,vec4 r){return all(greaterThanEqual(q,r.xy))&&all(lessThanEqual(q,r.xy+r.zw));}void main(){vec2 q=vec2(uv.x,1.-uv.y);'+(v2?'color':'gl_FragColor')+'=inside(q,topRect)?vec4(30./255.,100./255.,220./255.,1):inside(q,bottomRect)?vec4(220./255.,70./255.,110./255.,1):vec4(0,0,0,1);}';
const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
const controller={isControlDown:()=>false,isPadButtonDown:()=>false,getAxisValue:()=>0,isAxisLeft:()=>false,isAxisRight:()=>false,isAxisUp:()=>false,isAxisDown:()=>false};
const emulator=system==='3ds'?new ThreeDS():{};
Object.assign(emulator,{canvas,started:true,paused:false,bookMode:true,gap:32,microphone:false,
 controllers:{getController:()=>controller},pause(v){this.paused=v;return true},
 getPrefs(){return{getScreenLayout:()=>savedDS,setScreenLayout:v=>savedDS=v,isMicrophoneSupported:()=>system==='nds'}},
 setMicrophoneOn(v){this.microphone=v},setBookMode(v){this.bookMode=v},resetToggleLayout(){},updateScreenLayout(){this.updateScreenSize()},
 updateScreenSize(){const l=system==='3ds'?this.getView():this.getScreenLayout();const d=system==='3ds'?[this.VIDEO_WIDTH,this.VIDEO_HEIGHT]:[0,1].includes(l)?[256,416]:[2,3].includes(l)?[544,192]:[256,192];
  canvas.width=system==='3ds'?innerWidth:d[0];canvas.height=system==='3ds'?innerHeight:d[1];this.aspectRatio=d[0]/d[1];const width=Math.min(innerWidth*.96,innerHeight*.96*this.aspectRatio);Object.assign(canvas.style,{width:width+'px',height:width/this.aspectRatio+'px',left:'50%',top:'50%'});}});
if(system==='3ds')emulator.useView(saved3DS);else{emulator.getScreenLayout=()=>savedDS;emulator.getDefaultAspectRatio=()=>emulator.aspectRatio;}
window.app={emulator,isShowOverlay:()=>false,isPauseScreen:()=>false};
window.savedLayout=()=>savedDS;emulator.updateScreenSize();addEventListener('resize',()=>emulator.updateScreenSize());
window.nativeTouch=[];window.nativeMouse=[];
canvas.addEventListener('mousemove',e=>nativeMouse.push([e.clientX,e.clientY]));
canvas.addEventListener('touchstart',e=>nativeTouch.push([e.changedTouches[0].clientX,e.changedTouches[0].clientY]));
if(system==='nds')for(const type of ['touchstart','touchmove','touchend'])addEventListener(type,e=>{if(e.target===canvas)canvas.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:e.changedTouches[0].clientX,clientY:e.changedTouches[0].clientY}))});
const testTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,testTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,8,8,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);const testFbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,testFbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,testTexture,0);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
window.renderErrors=[];window.badRestore=0;window.badOffscreen=0;
function draw(){
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);let w=canvas.width,h=canvas.height;if(system==='3ds'){w=Math.min(w,h*emulator.aspectRatio);h=w/emulator.aspectRatio;}window.fixtureVP=[Math.floor((canvas.width-w)/2),Math.floor((canvas.height-h)*(canvas.width<canvas.height?1:.5)),Math.floor(w),Math.floor(h)];gl.viewport(...fixtureVP);gl.scissor(1,2,canvas.width-2,canvas.height-3);gl.enable(gl.SCISSOR_TEST);gl.clearColor(.2,.3,.4,1);gl.clear(gl.COLOR_BUFFER_BIT);
 gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);const index=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,2,gl.FLOAT,false,0,0);
 const l=system==='3ds'?emulator.getView():emulator.getScreenLayout(),side=l==='side'||l===2;
 let a,b;if(system==='3ds'){a=side?[0,0,400/720,1]:[0,0,1,.5];b=side?[400/720,0,320/720,1]:[.1,.5,.8,.5];}
 else{a=side?[0,0,256/544,1]:[0,0,1,192/416];b=side?[288/544,0,256/544,1]:[0,224/416,1,192/416];}
 gl.uniform4fv(gl.getUniformLocation(program,'topRect'),a);gl.uniform4fv(gl.getUniformLocation(program,'bottomRect'),b);
 gl.bindFramebuffer(gl.FRAMEBUFFER,testFbo);gl.viewport(0,0,8,8);gl.disable(gl.SCISSOR_TEST);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);const off=new Uint8Array(4);gl.readPixels(1,7,1,1,gl.RGBA,gl.UNSIGNED_BYTE,off);if(off[2]<200||off[0]>50)badOffscreen++;
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(...fixtureVP);gl.scissor(1,2,canvas.width-2,canvas.height-3);gl.enable(gl.SCISSOR_TEST);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
 const vp=Array.from(gl.getParameter(gl.VIEWPORT)),sc=Array.from(gl.getParameter(gl.SCISSOR_BOX)),color=Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE));
 if(JSON.stringify(vp)!==JSON.stringify(fixtureVP)||JSON.stringify(sc)!==JSON.stringify([1,2,canvas.width-2,canvas.height-3])||!gl.isEnabled(gl.SCISSOR_TEST)||Math.abs(color[0]-.2)>.001)badRestore++;
 const error=gl.getError();if(error)renderErrors.push(error);requestAnimationFrame(draw);
}requestAnimationFrame(draw);
window.sample=(x,y)=>{const r=canvas.getBoundingClientRect(),p=new Uint8Array(4);gl.readPixels(Math.floor((x-r.x)*canvas.width/r.width),Math.floor((r.bottom-y)*canvas.height/r.height),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return Array.from(p)};
`;
const html=()=>`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:black}canvas{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%)}</style><style>${asset('controller.css')}</style></head><body><script>${fixture}</script><script>${asset('controller.js')}</script></body></html>`;
const near=(a,b,message)=>assert(Math.abs(a-b)<1.2,message+': '+a+' != '+b);
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,...(engine===chromium?{executablePath:process.env.CHROME,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
  try{for(const system of ['nds','3ds']){
   const page=await browser.newPage({hasTouch:true,viewport:{width:382,height:580}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('http://sections.test/**',r=>r.fulfill({contentType:'text/html',body:html()}));
   await page.goto('http://sections.test/play/app/retro-'+(system==='3ds'?'azahar':'melonds')+'/');await page.locator('.kt-pad').waitFor({state:'visible'});
   const saved=await page.evaluate(()=>[savedLayout(),localStorage.getItem('wrcad.touch.3ds-view.v1'),localStorage.getItem('webrcade.touch.layouts.v1')]);
   for(const size of [{width:669,height:867},{width:951,height:585},{width:669,height:902},{width:951,height:620},{width:382,height:580},{width:385,height:571},{width:669,height:867}]){
    await page.setViewportSize(size);await page.waitForTimeout(400);
    const expanded=size.width>=600;assert.equal(await page.locator('.kt-sections').count(),+expanded);
    if(expanded){
     const side=size.width>size.height,rects=await page.locator('#wrcad-touch').evaluate(el=>JSON.parse(el.dataset.screenRects));
     const fold=await page.locator('#wrcad-touch').evaluate(el=>JSON.parse(el.dataset.foldBounds));
     if(!side){assert.equal(fold.basis,'duo-viewport');near(fold.center,size.height-951/2,'default Duo physical midpoint without installed flags');}
     assert(Math.abs(rects[0].width/rects[0].height-(system==='3ds'?5/3:4/3))<.005,'upper native aspect ratio');assert(Math.abs(rects[1].width/rects[1].height-4/3)<.005,'lower native aspect ratio');
     assert(side?rects[0].right<=fold.start+.1&&rects[1].left>=fold.end-.1:rects[0].bottom<=fold.start+.1&&rects[1].top>=fold.end-.1,'both pictures avoid entire fold band');
     const colors=await page.evaluate(rects=>rects.map(r=>sample((r.left+r.right)/2,(r.top+r.bottom)/2)),rects);
     assert(colors[0][2]>200&&colors[0][0]<50,'top screen pixels painted in primary pane '+JSON.stringify(colors));assert(colors[1][0]>200&&colors[1][2]<140,'touchscreen pixels painted separately '+JSON.stringify(colors));
     const blank=await page.evaluate(({fold,side})=>sample(side?fold.center:innerWidth/2,side?innerHeight/2:fold.center),{fold,side});assert(blank[0]<3&&blank[1]<3&&blank[2]<3,'fold pixels remain black');
     const controls=await page.locator('.kt-pad button:visible,.kt-stick:visible,.kt-tab:visible').evaluateAll(els=>els.map(el=>({...el.getBoundingClientRect().toJSON(),id:el.dataset.layoutId||'tab'})));
     assert.equal(controls.length,system==='3ds'?15:12,'every control visible');near(controls.find(r=>r.id==='tab').right,size.width,'closed settings tab is flush with outer edge');
     for(const r of controls){assert(side?r.x>=fold.end-.1:r.y>=fold.end-.1,'all controls stay in touchscreen pane '+r.id);assert(r.x>=-.1&&r.right<=size.width+.1&&r.bottom<=size.height+.1,'control visible '+r.id);assert(r.right<=rects[1].left+1||r.x>=rects[1].right-1||r.bottom<=rects[1].top+1||r.y>=rects[1].bottom-1,'control outside lower picture '+r.id);}
     if(!side){near(rects[0].width,Math.min(size.width-24,(fold.start-12)*(system==='3ds'?5/3:4/3)),'upper display still fits its full pane');assert(rects[1].width>=360&&rects[1].height>=270,'portrait touchscreen uses available lower space');}
     const r=rects[1];await page.touchscreen.tap((r.left+r.right)/2,(r.top+r.bottom)/2);await page.waitForTimeout(30);
     const point=await page.evaluate(()=>system==='3ds'?nativeTouch.at(-1):nativeMouse.at(-1));const canvas=await page.locator('canvas').boundingBox();
     const nx=system==='3ds'?(side?(400+160)/720:.5):(side?.75:.5);const ny=side?.5:system==='3ds'?.75:(224+96)/416;
     const nativeWidth=system==='3ds'?(side?720:400):(side?544:256),nativeHeight=side?(system==='3ds'?240:192):(system==='3ds'?480:416);
     const vp=system==='3ds'?await page.evaluate(()=>fixtureVP):[0,0,nativeWidth,nativeHeight];const bw=system==='3ds'?size.width:nativeWidth,bh=system==='3ds'?size.height:nativeHeight;near(((point[0]-canvas.x)/canvas.width*bw-vp[0])/vp[2]*nativeWidth,nx*nativeWidth,'native stylus horizontal mapping');near(((point[1]-canvas.y)/canvas.height*bh-(bh-vp[1]-vp[3]))/vp[3]*nativeHeight,ny*nativeHeight,'native stylus vertical mapping');
     const before=await page.evaluate(()=>[nativeTouch.length,nativeMouse.length]);await page.touchscreen.tap((rects[0].left+rects[0].right)/2,(rects[0].top+rects[0].bottom)/2);assert.deepEqual(await page.evaluate(()=>[nativeTouch.length,nativeMouse.length]),before,'upper display does not activate stylus');
     assert.equal(await page.locator('canvas').count(),1,'one native canvas/context');
     if(process.env.WEBRCADE_TEST_OUTPUT)await page.screenshot({path:path.join(process.env.WEBRCADE_TEST_OUTPUT,engine.name()+'-'+system+'-'+size.width+'x'+size.height+'.png')});
    }else{assert.equal(await page.evaluate(()=>app.emulator.getView?.()??savedLayout()),system==='3ds'?'touch':4,'manual view restored');if(system==='nds')assert.equal(await page.evaluate(()=>app.emulator.bookMode),true);}
    assert.deepEqual(await page.evaluate(()=>[savedLayout(),localStorage.getItem('wrcad.touch.3ds-view.v1'),localStorage.getItem('webrcade.touch.layouts.v1')]),saved,'preferences unchanged');
   }
   if(system==='nds'){const mic=await page.locator('.kt-ds-mic').boundingBox();await page.mouse.move(mic.x+mic.width/2,mic.y+mic.height/2);await page.mouse.down();await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>app.emulator.microphone),true,'native microphone held');await page.mouse.up();assert.equal(await page.evaluate(()=>app.emulator.microphone),false,'native microphone released');}
   await page.locator('.kt-tab').click();await page.locator('#kt-fold-gap').evaluate(el=>{el.value='80';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(250);
   assert.equal(await page.locator('#wrcad-touch').evaluate(el=>JSON.parse(el.dataset.foldBounds).gap),80,'gap adjustment reserves full band');
   for(const [selector,value] of [['#kt-fold-gap','160'],['#kt-fold-alignment','15']])await page.locator(selector).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))},value);
   await page.waitForTimeout(250);const extreme=await page.locator('#wrcad-touch').evaluate(el=>JSON.parse(el.dataset.foldBounds));for(const c of await page.locator('.kt-pad button:visible,.kt-stick:visible,.kt-tab:visible').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON())))assert(c.top>=extreme.end-.1,'maximum clearance/offset keeps controls below fold');
   for(const [selector,value] of [['#kt-fold-gap','80'],['#kt-fold-alignment','0']])await page.locator(selector).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))},value);
   await page.waitForTimeout(250);
   await page.locator('.kt-sections-toggle').click();assert.equal(await page.locator('.kt-sections').count(),0);await page.locator('.kt-sections-toggle').click();await page.locator('.kt-close').click();
   await page.evaluate(()=>{pads=[{index:0,connected:true}];const e=new Event('gamepadconnected');e.gamepad=pads[0];dispatchEvent(e)});await page.waitForTimeout(250);assert.equal(await page.locator('.kt-sections').count(),0,'gamepad restores native full-area mode');
   // Installed fullscreen can retain an opaque OS status strip. Use the
   // physical display midpoint independently of the adapter's reported fold.
   const safeInset=await page.addStyleTag({content:'.kt-ds-origin,.kt-3ds-origin{bottom:34px}'});
   await page.locator('#kt-fold-gap').evaluate(el=>{el.value='40';el.dispatchEvent(new Event('input',{bubbles:true}))});
   await page.evaluate(()=>{document.documentElement.setAttribute('data-cr-status-top','');document.documentElement.setAttribute('data-cr-installed','');Object.defineProperty(navigator,'standalone',{value:true,configurable:true});Object.defineProperty(screen,'width',{get:()=>669,configurable:true});Object.defineProperty(screen,'height',{get:()=>951,configurable:true});Object.defineProperty(document,'fullscreenElement',{get:()=>window.fixtureFullscreen?document.body:null,configurable:true});const e=new Event('gamepaddisconnected');e.gamepad=pads[0]||{index:0,connected:false};pads=[];dispatchEvent(e)});
   for(const [height,fullscreen,palette=true] of [[867,true],[839,true],[839,false],[951,true],[867,true,false]]){
    await page.evaluate(({fullscreen,palette})=>{window.fixtureFullscreen=fullscreen;document.documentElement.toggleAttribute('data-cr-status-top',palette)},{fullscreen,palette});await page.setViewportSize({width:669,height});await page.waitForTimeout(350);
    const r=await page.locator('#wrcad-touch').evaluate(el=>({rects:JSON.parse(el.dataset.screenRects),fold:JSON.parse(el.dataset.foldBounds),layout:el.dataset.sectionControls})),excluded=951-height;
    near(r.fold.center+excluded,951/2,'fullscreen/status strip keeps fold on physical midpoint');
    assert(r.rects[0].bottom+excluded<=951/2-19.9,'upper picture stays above physical hinge clearance');assert(r.rects[1].top+excluded>=951/2+19.9,'touchscreen stays below physical hinge clearance');
    assert.equal(r.layout,'rails','bottom safe area retains controller side rails');assert(r.rects[1].width>=360&&r.rects[1].height>=270,'larger touchscreen fits beside full-size controls and above footer');
    const tab=await page.locator('.kt-tab').boundingBox();near(tab.x+tab.width,669,'fullscreen settings tab touches outer edge');assert(tab.y>=r.fold.end,'tab remains below fold');
    for(const c of await page.locator('.kt-pad button:visible,.kt-stick:visible').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()))){assert(c.top>=r.fold.end-.1,'all fullscreen controls below physical fold');assert(c.right<=r.rects[1].left+1||c.left>=r.rects[1].right-1||c.bottom<=r.rects[1].top+1||c.top>=r.rects[1].bottom-1,'fullscreen control outside useful touchscreen');assert(c.right<=tab.x-9.9||c.left>=tab.x+tab.width+9.9||c.bottom<=tab.y-9.9||c.top>=tab.y+tab.height+9.9,'edge tab clear of controls')}
    if(process.env.WEBRCADE_TEST_OUTPUT)await page.screenshot({path:path.join(process.env.WEBRCADE_TEST_OUTPUT,engine.name()+'-'+system+'-installed-'+height+'-'+fullscreen+'.png')});
   }
   // The default must work with missing mode hints and stale cover/work-area
   // Screen values; those values must never replace the known Duo projection.
   await page.setViewportSize({width:669,height:867});
   for(const [width,height] of [[382,844],[669,867],[0,0]]){
    await page.evaluate(({width,height})=>{fixtureFullscreen=false;document.documentElement.removeAttribute('data-cr-installed');document.documentElement.removeAttribute('data-cr-status-top');Object.defineProperty(navigator,'standalone',{value:false,configurable:true});Object.defineProperty(screen,'width',{value:width,configurable:true});Object.defineProperty(screen,'height',{value:height,configurable:true})},{width,height});await page.waitForTimeout(250);
    const v=await page.locator('#wrcad-touch').evaluate(el=>({fold:JSON.parse(el.dataset.foldBounds),rects:JSON.parse(el.dataset.screenRects),controls:el.dataset.sectionControls}));
    assert.equal(v.fold.basis,'duo-viewport');near(v.fold.center,391.5,'stale/missing Screen API does not move physical hinge');assert.equal(v.controls,'rails');assert(v.rects[1].width>=300&&v.rects[1].height>=225);assert.deepEqual(await page.evaluate(()=>sample(669/2,391.5)).then(p=>p.slice(0,3)),[0,0,0],'physical hinge pixels clear without display hints');
   }
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copiedLayout=text},configurable:true}));await page.locator('.kt-tab').click();await page.locator('.kt-layout-info').click();
   const report=JSON.parse(await page.evaluate(()=>copiedLayout));assert.equal(report.fold.basis,'duo-viewport');assert.equal(report.display.width,0);assert.equal(report.display.standalone,false);assert.equal(report.alignment,0);assert(!JSON.stringify(report).includes('sections.test'),'local layout report contains no page URL');await page.locator('.kt-close').click();
   await page.setViewportSize({width:667,height:864});await page.waitForTimeout(250);near(await page.locator('#wrcad-touch').evaluate(el=>JSON.parse(el.dataset.foldBounds).center),864-667*951/669/2,'small CSS rounding follows Duo display ratio');
   await safeInset.evaluate(el=>el.remove());await page.evaluate(()=>{fixtureFullscreen=false;document.documentElement.removeAttribute('data-cr-installed')});
   // Natural screen orientation can remain wide in a portrait Home Screen app.
   await page.evaluate(()=>{document.documentElement.setAttribute('data-cr-status-top','');Object.defineProperty(navigator,'standalone',{value:true,configurable:true});Object.defineProperty(screen,'width',{get:()=>951,configurable:true});Object.defineProperty(screen,'height',{get:()=>669,configurable:true});const e=new Event('gamepaddisconnected');e.gamepad=pads[0]||{index:0,connected:false};pads=[];dispatchEvent(e)});
   await page.setViewportSize({width:669,height:867});await page.waitForTimeout(350);
   near(await page.locator('#wrcad-touch').evaluate(el=>JSON.parse(el.dataset.foldBounds).center),391.5,'natural orientation and opaque status area locate physical hinge');
   await page.evaluate(()=>{window.viewport={segments:[{left:0,right:669,top:0,bottom:300},{left:0,right:669,top:380,bottom:867}]}});await page.waitForTimeout(300);
   const detected=await page.locator('#wrcad-touch').evaluate(el=>JSON.parse(el.dataset.foldBounds));assert.equal(detected.start,300);assert.equal(detected.end,380);assert.equal(detected.reportedGap,80,'reported gap width used completely');
   const detectedRects=await page.locator('#wrcad-touch').evaluate(el=>JSON.parse(el.dataset.screenRects));assert(detectedRects[0].bottom<=300.1&&detectedRects[1].top>=379.9,'pictures avoid reported folding region');
   assert.equal(await page.evaluate(()=>badOffscreen),0,'core offscreen draws bypass composition');assert.equal(await page.evaluate(()=>badRestore),0,'native GL viewport/scissor/color state restored');assert.deepEqual(await page.evaluate(()=>renderErrors),[]);assert.deepEqual(errors,[]);
   // Explicit device defaults provide a single recovery action at other zoom
   // widths and reset only this device's calibration/current console layout.
   await page.setViewportSize({width:700,height:900});await page.waitForTimeout(250);await page.locator('.kt-tab').click();
   for(const [selector,value] of [['#kt-fold-gap','120'],['#kt-fold-alignment','10']])await page.locator(selector).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))},value);
   await page.locator('.kt-duo-defaults').click();await page.waitForTimeout(200);
   const reset=await page.locator('#wrcad-touch').evaluate(el=>({fold:JSON.parse(el.dataset.foldBounds),rects:JSON.parse(el.dataset.screenRects)}));assert.equal(reset.fold.basis,'duo-preset');near(reset.fold.center,900-700*951/669/2,'explicit Duo preset ignores conflicting segments center');assert.equal(reset.fold.gap,80,'explicit preset retains reported gap clearance');assert(reset.rects[1].width>=300);
   const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('webrcade.touch.layouts.v1')));for(const [key,value] of Object.entries(JSON.parse(saved[2])))assert.deepEqual(stored[key],value,'Duo default reset preserves phone and earlier layouts');assert.deepEqual(stored[system+':portrait:sections-console'],{});
   await page.locator('.kt-close').click();await page.reload();await page.waitForTimeout(400);assert.equal(await page.locator('#wrcad-touch').evaluate(el=>JSON.parse(el.dataset.foldBounds).basis),'duo-preset','explicit device choice persists');
   await page.close();console.log('PASS',engine.name(),system,'real WebGL independent scaling/aspects, lower controls, blank fold, native input remapping, state restoration, compact/manual/gamepad/preferences');
  }}finally{await browser.close()}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
