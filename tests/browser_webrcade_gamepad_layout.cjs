// Real shared overlay and native PS2/GameCube placement contracts, with synthetic
// physical pads. No ROM, GPU, cloud account or saved-game access is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {chromium, webkit, request} = require('playwright');
const {createHash} = require('node:crypto');
const root = path.join(__dirname, '../deploy/webrcade');
(async()=>{
 const paths = {'controller.js':'touch-controls/controller.js','controller.css':'touch-controls/controller.css',
  'viewport.mjs':'experimental/ps2/viewport.mjs','lab.mjs':'experimental/gamecube/lab.mjs'};
 const local = name => name==='viewport.mjs'?path.join(root,'retro-play/app',name):name==='lab.mjs'?path.join(root,'retro-dolphin/app',name):path.join(root,'touch/assets',name);
 const loaded={};
 const origin=process.env.WEBRCADE_TEST_ASSET_ORIGIN;
 const client=origin?await request.newContext({ignoreHTTPSErrors:true}):null;
 try {for(const [name,url] of Object.entries(paths)) {
  if(client){const response=await client.get(new URL(url,origin.replace(/\/?$/,'/')).href);assert(response.ok(),name+' served HTTP '+response.status());loaded[name]=await response.body();}
  else loaded[name]=fs.readFileSync(local(name));
  console.log('ASSET',origin?'served':'source',name,createHash('sha256').update(loaded[name]).digest('hex'));
 }}finally{await client?.dispose()}
 const asset=name=>loaded[name].toString('utf8');
 const gcSource=asset('lab.mjs');
const gcFit = gcSource.slice(gcSource.indexOf('function fitCanvas(){'), gcSource.indexOf('\nwindow.app=', gcSource.indexOf('function fitCanvas(){')));
const cores = ['nes','snes','gb','gbc','gba','n64','nds','3ds','genesis','psx','psp','ps2','gamecube'];
const fixture = `
  const core=location.pathname.split('/')[3], ps2=core==='ps2', gamecube=core==='gamecube';
  // The desktop WebKit port reports zero even with hasTouch. Model a phone's
  // actual contact count for GameCube's existing touch-device geometry gate.
  if(matchMedia('(pointer: coarse)').matches) Object.defineProperty(navigator,'maxTouchPoints',{value:5});
  window.WrcadCloudConfig={storagePrefix:'gamepad-fixture'};
  window.cloudWrites=[]; window.WrcadCloud={controlsChanged:patch=>cloudWrites.push(patch)};
  window.pads=new URL(location.href).searchParams.has('connected')?[{index:0,connected:true,mapping:'standard'}]:[];
  if(new URL(location.href).searchParams.has('unmapped'))window.pads=[{index:0,connected:true,mapping:''}];
  window.padApiUnavailable=false;
  Object.defineProperty(navigator,'getGamepads',{value:()=>{if(padApiUnavailable)throw new Error('Gamepad API unavailable');return window.pads}});
  window.setPads=(indices,event=true)=>{
    const previous=window.pads; window.pads=indices.map(index=>typeof index==='number'?{index,connected:true,mapping:'standard'}:{connected:true,...index});
    if(event) for(const [kind,list,other] of [['gamepaddisconnected',previous,window.pads],['gamepadconnected',window.pads,previous]])
      for(const pad of list) if(!other.some(p=>p.index===pad.index)) {const e=new Event(kind);e.gamepad=pad;dispatchEvent(e);}
  };
  const canvas=document.createElement('canvas');canvas.width=400;canvas.height=480;document.body.append(canvas);
  const safe=document.createElement('div');safe.id='safe-area';document.body.append(safe);
  const session={booted:true};
  ${gcFit}
  const {pictureBounds}=await import('/viewport.mjs');
  const controller={isControlDown:cid=>cid===7,isPadButtonDown:()=>false,getAxisValue:()=>0,
    isAxisLeft:()=>false,isAxisRight:()=>false,isAxisUp:()=>false,isAxisDown:()=>false};
  window.pauseCalls=0;
  const emulator={started:true,paused:false,canvas,view:0,bookMode:false,SS_16_9:2,SS_FILL:3,
    controllers:{getController:()=>controller},getScreenSize:()=>0,getProps:()=>({}),
    getView(){return this.view},getViews:()=>[[0,'Vertical'],[1,'Side by side']],setView(v){this.view=v;this.updateScreenSize()},
    getScreenLayout(){return this.view},getPrefs(){return{getScreenLayout:()=>this.view,setScreenLayout:v=>this.view=v}},
    resetToggleLayout(){},setBookMode(v){this.bookMode=v},updateScreenLayout(){this.updateScreenSize()},
    getDefaultAspectRatio(){return core==='nds' ? (this.view===0?2/3:8/3) : core==='3ds' ? (this.view===0?5/6:3) : core==='gb'||core==='gbc'?10/9:4/3},
    pause(value){pauseCalls++;this.paused=value;return true},
    updateScreenSize(){
      if(gamecube){fitCanvas();return}
      if(ps2){const r=pictureBounds({safe:safe.getBoundingClientRect(),touch:matchMedia('(pointer: coarse)').matches,
        controls:document.getElementById('wrcad-touch')?.classList.contains('kt-enabled')});
        Object.assign(canvas.style,{position:'fixed',width:r.width+'px',height:r.height+'px',left:r.left+'px',top:r.top+'px',transform:'none'});return}
      const ratio=this.getDefaultAspectRatio(),width=Math.min(innerWidth*.96,innerHeight*.96*ratio);
      canvas.style.width=width+'px';canvas.style.height=width/ratio+'px';
    }};
  window.app={emulator,isShowOverlay:()=>false,isPauseScreen:()=>false};
  window.WrcadGameCube={menuOpen(){}};window.WrcadPS2={menuOpen(){}};
  emulator.updateScreenSize();addEventListener('resize',()=>emulator.updateScreenSize());
  const script=document.createElement('script');script.src='/controller.js';document.body.append(script);
`;
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,executablePath:engine===chromium?process.env.CHROME:process.env.WEBRCADE_TEST_WEBKIT_PATH,
    ...(engine===chromium?{args:['--no-sandbox']}:{})});
  try{
   const context=await browser.newContext({hasTouch:true,viewport:{width:390,height:844}});
   const serve=route=>{
    const url=new URL(route.request().url()),file=url.pathname.split('/').pop();
    if(url.pathname==='/host/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0"><iframe style="width:100vw;height:calc(100vh + 60px);border:0" src="/play/app/'+url.searchParams.get('core')+'/?connected"></iframe></body>'});
    if(file==='viewport.mjs')return route.fulfill({contentType:'application/javascript',body:asset('viewport.mjs')});
    if(file==='controller.js'||file==='controller.css')return route.fulfill({contentType:file.endsWith('.css')?'text/css':'application/javascript',body:asset(file)});
    return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/controller.css"><style>
      body{margin:0}canvas{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%)}
      #safe-area{position:fixed;inset:20px 0;visibility:hidden}
      .kt-ds-origin,.kt-3ds-origin{top:20px;bottom:20px}
      </style></head><body><script type="module">${fixture}</script></body></html>`});
   };
   await context.route('http://gamepad.test/**',serve);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const centered=async(label)=>{
    await page.waitForFunction(()=>document.querySelector('.kt-pad')?.hidden && !document.querySelector('#wrcad-touch').hidden);
    const picture=await page.locator('canvas').boundingBox(),v=page.viewportSize();
    assert(Math.abs(picture.x+picture.width/2-v.width/2)<.6&&Math.abs(picture.y+picture.height/2-v.height/2)<.6,label+' picture centered '+JSON.stringify(picture));
    assert(await page.locator('.kt-tab').isVisible(),label+' drawer remains accessible');
    assert.equal(await page.evaluate(()=>pauseCalls),0,label+' presentation does not pause');
   };
   for(const core of cores){
    // An unknown device retains the normal touch preference and manual button.
    // Both choices persist across reload without changing the gamepad override.
    await page.goto('http://gamepad.test/play/app/'+core+'/?unmapped');
    await page.locator('.kt-pad').waitFor({state:'visible'});
    assert.equal(await page.locator('.kt-toggle').textContent(),'Touch controls: On',core+' unknown mapping cannot auto-hide touch');
    // Mixed devices, polling without events, then the event-only API fallback.
    await page.evaluate(()=>setPads([{index:0,mapping:''},1]));await centered(core+' supported plus unknown pad');
    await page.evaluate(()=>setPads([{index:0,mapping:''}],false));await page.locator('.kt-pad').waitFor({state:'visible'});
    await page.evaluate(()=>setPads([]));
    await page.evaluate(()=>{padApiUnavailable=true;setPads([{index:2,mapping:''}])});
    await page.waitForTimeout(180);assert(await page.locator('.kt-pad').isVisible(),core+' unknown hotplug fallback retains touch');
    await page.evaluate(()=>setPads([{index:2,mapping:''},3]));await centered(core+' supported hotplug fallback');
    await page.evaluate(()=>setPads([{index:2,mapping:''}]));await page.locator('.kt-pad').waitFor({state:'visible'});
    await page.evaluate(()=>{padApiUnavailable=false;setPads([{index:0,mapping:''}])});
    assert.deepEqual(await page.evaluate(()=>cloudWrites),[],core+' capability detection does not save preferences');
    await page.locator('.kt-pad').waitFor({state:'visible'});await page.locator('.kt-tab').tap();
    assert.equal(await page.locator('.kt-toggle,.kt-gamepad-touch').count(),1,'one touch controls button in the drawer');
    const controls=page.getByRole('button',{name:'Touch controls: On',exact:true});
    assert.equal(await controls.getAttribute('aria-pressed'),'true');
    assert.equal(await controls.getAttribute('role'),null,'native button semantics replace the old switch');
    const overrideBefore=await page.evaluate(()=>localStorage.getItem('gamepad-fixture.touch.gamepad-touch.v1'));
    await controls.tap();
    assert.equal(await page.getByRole('button',{name:'Touch controls: Off',exact:true}).getAttribute('aria-pressed'),'false');
    assert.deepEqual(await page.evaluate(()=>cloudWrites),[{enabled:false}],'normal Off uses existing cloud preference');
    await page.locator('.kt-close').tap();assert.equal(await page.locator('.kt-pad').isVisible(),false);
    assert(await page.locator('.kt-tab').isVisible(),'tab remains available with normal controls off');
    await page.reload();await page.locator('.kt-tab').waitFor({state:'visible'});await page.locator('.kt-tab').tap();
    await page.getByRole('button',{name:'Touch controls: Off',exact:true}).tap();
    assert.deepEqual(await page.evaluate(()=>cloudWrites),[{enabled:true}],'normal On uses existing cloud preference');
    assert.equal(await page.evaluate(()=>localStorage.getItem('gamepad-fixture.touch.gamepad-touch.v1')),overrideBefore,'normal choice leaves connected-pad override untouched');
    await page.locator('.kt-close').tap();await page.locator('.kt-pad').waitFor({state:'visible'});
    await page.reload();await page.locator('.kt-pad').waitFor({state:'visible'});await page.locator('.kt-tab').tap();
    assert.equal(await page.getByRole('button',{name:'Touch controls: On',exact:true}).getAttribute('aria-pressed'),'true','normal On persists across reload');
    await page.locator('.kt-close').tap();
    await page.goto('http://gamepad.test/play/app/'+core+'/?connected');
    await centered(core+' already connected');
    assert.equal(await page.locator('.kt-gamepad-touch').getAttribute('aria-pressed'),'false');
    for(const viewport of [{width:844,height:390},{width:320,height:568},{width:390,height:844}]){
     await page.setViewportSize(viewport);await page.waitForTimeout(180);await centered(core+' rotation');
    }
    await page.locator('.kt-tab').tap();
    assert.equal(await page.locator('.kt-toggle,.kt-gamepad-touch').count(),1,'same single controls button while connected');
    assert(await page.locator('.kt-toggle').isVisible(),'touch controls button remains available with a gamepad');
    await page.getByRole('button',{name:'Touch controls: Off',exact:true}).tap();
    await page.locator('.kt-close').tap();await page.locator('.kt-pad').waitFor({state:'visible'});
    const normal=await page.locator('canvas').boundingBox();
    const customLayout={[core+':portrait']:{'button-4':[.7,.52],dock:[0,.25]}};
    await page.evaluate(layout=>{const key='gamepad-fixture.touch.layouts.v1';localStorage.setItem(key,JSON.stringify(layout));dispatchEvent(new StorageEvent('storage',{key}));},customLayout);
    const customButton=await page.locator('.kt-actions [data-cid="4"]').boundingBox();
    if(['gb','gbc','psx','psp','nds','3ds','ps2','gamecube'].includes(core))
      assert(normal.y+normal.height/2<420,core+' normal mobile position restored');
    assert.equal(await page.evaluate(()=>localStorage.getItem('gamepad-fixture.touch.enabled.v1')),'true','no-pad preference untouched');
    await page.reload();await page.locator('.kt-pad').waitFor({state:'visible'});
    const restored=await page.locator('canvas').boundingBox();assert(Math.abs(restored.y-normal.y)<.6,core+' override survives reload');
    await page.locator('.kt-tab').tap();await page.getByRole('button',{name:'Touch controls: On',exact:true}).tap();await page.locator('.kt-close').tap();await centered(core+' off button');
    await page.evaluate(()=>setPads([0,1]));await page.evaluate(()=>setPads([1]));await centered(core+' one pad remains');
    await page.evaluate(()=>setPads([]));await page.locator('.kt-pad').waitFor({state:'visible'});
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('gamepad-fixture.touch.layouts.v1'))),customLayout,'custom layouts are never rewritten');
    const restoredButton=await page.locator('.kt-actions [data-cid="4"]').boundingBox();
    assert(Math.abs(restoredButton.x-customButton.x)<.6&&Math.abs(restoredButton.y-customButton.y)<.6,core+' saved custom button/dock layout restored');
    const disconnected=await page.locator('canvas').boundingBox();assert(Math.abs(disconnected.y-normal.y)<.6,core+' disconnect restores mobile geometry');
    assert.equal(await page.evaluate(()=>app.emulator.controllers.getController(0).isControlDown(7)),true,'original physical input retained');
    // Hold an actual pointer through hotplug; its button and capture must release.
    const button=await page.locator('.kt-actions [data-cid="4"]').boundingBox();
    await page.mouse.move(button.x+button.width/2,button.y+button.height/2);await page.mouse.down();
    await page.waitForFunction(()=>app.emulator.controllers.getController(0).isControlDown(4));
    await page.evaluate(()=>{window.heldPointer=null;document.addEventListener('gotpointercapture',e=>heldPointer=e.pointerId,{once:true});});
    await page.mouse.move(button.x+button.width/2+1,button.y+button.height/2);
    await page.evaluate(()=>setPads([0]));await centered(core+' hotplug while held');
    assert.equal(await page.evaluate(()=>app.emulator.controllers.getController(0).isControlDown(4)),false,'hotplug releases held touch input');
    assert.equal(await page.locator('.kt-held').count(),0,'hotplug clears visual highlights');
    assert.equal(await page.evaluate(()=>heldPointer!==null&&document.querySelector('.kt-pad').hasPointerCapture(heldPointer)),false,'hotplug releases pointer capture');
    await page.mouse.up();
    // Poll fallback detects controller changes without DOM hotplug events.
    await page.evaluate(()=>setPads([],false));await page.locator('.kt-pad').waitFor({state:'visible'});
    await page.evaluate(()=>setPads([0],false));await centered(core+' polling fallback');
    assert.deepEqual(await page.evaluate(()=>cloudWrites),[],'automatic presentation/override never changes cloud settings');
    console.log('PASS',engine.name(),core,'normal-button/off/on/cloud/persistence + mapping/fallback/connect/rotate/override/reload/multiple/disconnect/held-input/poll');
   }
   // Connected On temporarily overrides a normal Controls-off preference.
   // Last disconnect must release a held touch even though gamepadMode stays off.
   await page.evaluate(()=>{localStorage.setItem('gamepad-fixture.touch.enabled.v1','false');localStorage.setItem('gamepad-fixture.touch.gamepad-touch.v1','true')});
   await page.goto('http://gamepad.test/play/app/gb/?connected');await page.locator('.kt-pad').waitFor({state:'visible'});
   const held=await page.locator('.kt-actions [data-cid="4"]').boundingBox();
   await page.mouse.move(held.x+held.width/2,held.y+held.height/2);await page.mouse.down();
   await page.waitForFunction(()=>app.emulator.controllers.getController(0).isControlDown(4));
   await page.evaluate(()=>setPads([]));await page.waitForFunction(()=>document.querySelector('.kt-pad').hidden);
   assert.equal(await page.locator('.kt-held').count(),0,'effective-only disconnect releases held controls');
   await page.evaluate(()=>setPads([0]));await page.locator('.kt-pad').waitFor({state:'visible'});
   assert.equal(await page.evaluate(()=>app.emulator.controllers.getController(0).isControlDown(4)),false,'reconnect never revives stale held touch');
   await page.mouse.up();await page.evaluate(()=>setPads([]));
   assert.equal(await page.evaluate(()=>localStorage.getItem('gamepad-fixture.touch.enabled.v1')),'false');
   // A new connection during a layout edit applies after Cancel without stealing
   // the draft, changing the picture or introducing another pause/resume cycle.
   await page.evaluate(()=>{localStorage.removeItem('gamepad-fixture.touch.enabled.v1');localStorage.removeItem('gamepad-fixture.touch.gamepad-touch.v1')});
   for(const core of ['gb','ps2','gamecube']){
    await page.goto('http://gamepad.test/play/app/'+core+'/');await page.locator('.kt-pad').waitFor({state:'visible'});
    await page.locator('.kt-tab').tap();await page.locator('.kt-edit').tap();
    const before=await page.locator('canvas').boundingBox();
    await page.evaluate(()=>setPads([0]));await page.waitForTimeout(200);
    assert(await page.locator('.kt-editor').isVisible(),'hotplug retains layout editor');
    assert.deepEqual(await page.locator('canvas').boundingBox(),before,core+' edit freezes placement during hotplug');
    assert.equal(await page.locator('#wrcad-touch.kt-enabled').count(),1,'edit freezes effective controls preference');
    await page.locator('.kt-cancel').tap();
    await page.waitForFunction(()=>document.querySelector('.kt-pad').hidden);
    const after=await page.locator('canvas').boundingBox();assert(Math.abs(after.y+after.height/2-422)<.6,core+' applies deferred centered mode');
    assert.equal(await page.evaluate(()=>pauseCalls),2,'only editor pause/resume occurs');
   }
   // Clicking the displayed state while ending an edit honors that target,
   // even when deferred hotplug changes which preference owns the button.
   for(const core of ['gb','ps2','gamecube']){
    await page.evaluate(()=>{localStorage.setItem('gamepad-fixture.touch.enabled.v1','true');localStorage.removeItem('gamepad-fixture.touch.gamepad-touch.v1')});
    await page.goto('http://gamepad.test/play/app/'+core+'/');await page.locator('.kt-pad').waitFor({state:'visible'});
    await page.locator('.kt-tab').tap();await page.locator('.kt-edit').tap();
    await page.evaluate(()=>setPads([0]));
    assert.equal(await page.locator('.kt-toggle').getAttribute('aria-pressed'),'true','edit still displays the original On state');
    await page.locator('.kt-toggle').evaluate(button=>button.click());
    assert.equal(await page.locator('.kt-toggle').getAttribute('aria-pressed'),'false','deferred connect click reaches requested Off');
    assert.equal(await page.locator('.kt-editor').isVisible(),false,'button cancels edit transaction');
    assert.equal(await page.evaluate(()=>localStorage.getItem('gamepad-fixture.touch.enabled.v1')),'true','connected click preserves normal preference');
    // Turn connected controls back on, then disconnect while editing. Off must
    // apply to the normal preference after the deferred disconnect is reconciled.
    await page.locator('.kt-toggle').evaluate(button=>button.click());await page.locator('.kt-pad').waitFor({state:'visible'});
    await page.locator('.kt-tab').tap();await page.locator('.kt-edit').tap();await page.evaluate(()=>setPads([]));
    assert.equal(await page.locator('.kt-toggle').getAttribute('aria-pressed'),'true');
    await page.locator('.kt-toggle').evaluate(button=>button.click());
    assert.equal(await page.locator('.kt-toggle').getAttribute('aria-pressed'),'false','deferred disconnect click reaches requested Off');
    assert.equal(await page.evaluate(()=>localStorage.getItem('gamepad-fixture.touch.enabled.v1')),'false');
    assert.equal(await page.locator('.kt-editor').isVisible(),false);
   }
   await page.evaluate(()=>localStorage.setItem('gamepad-fixture.touch.gamepad-touch.v1','false'));
   // DS/3DS also center nonvertical/book/landscape views within an ancestor
   // that exposes only part of an oversized native iframe.
   for(const core of ['nds','3ds']){
    await page.goto('http://gamepad.test/host/?core='+core);
    const game=await (await page.locator('iframe').elementHandle()).contentFrame();
    await game.waitForFunction(()=>window.app?.emulator.started&&document.querySelector('.kt-pad')?.hidden);
    for(const viewport of [{width:390,height:844},{width:844,height:390}]){
     await page.setViewportSize(viewport);await page.waitForTimeout(180);
     for(const view of core==='nds'?[0,2]:[0,1]){
      await game.evaluate(view=>app.emulator.setView(view),view);
      const r=await game.locator('canvas').boundingBox();
      assert(Math.abs(r.x+r.width/2-viewport.width/2)<.6&&Math.abs(r.y+r.height/2-(20+viewport.height)/2)<.6,
        core+' view '+view+' centers in visible ancestor safe-area intersection');
     }
     if(core==='nds'){
      await game.evaluate(()=>{app.emulator.bookMode=true;app.emulator.updateScreenSize()});
      const r=await game.locator('canvas').boundingBox();assert(Math.abs(r.y+r.height/2-(20+viewport.height)/2)<.6,'DS book mode keeps native transform centered');
      await game.evaluate(()=>{app.emulator.bookMode=false;app.emulator.updateScreenSize()});
     }
     assert.deepEqual(await game.evaluate(()=>[app.emulator.canvas.width,app.emulator.canvas.height]),[400,480],'native drawing buffers untouched');
    }
   }
   const desktop=await browser.newPage({hasTouch:false,viewport:{width:1280,height:720}});await desktop.route('http://gamepad.test/**',serve);await desktop.goto('http://gamepad.test/play/app/gb/?connected');
   await desktop.waitForTimeout(250);assert.equal(await desktop.locator('#wrcad-touch').count(),0,'desktop is untouched');await desktop.close();
   assert.deepEqual(errors,[],'no page errors');await context.close();
  }finally{await browser.close()}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
