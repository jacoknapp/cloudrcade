// Native screen composition in expanded touch windows: no ROMs/accounts/flags.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {chromium, webkit} = require('playwright');
const root = path.join(__dirname, '../deploy/webrcade');
const asset = name => fs.readFileSync(path.join(process.env.WEBRCADE_TOUCH_ASSETS_ROOT || path.join(root, 'touch/assets'), name), 'utf8');
// Exercise the shipped 3DS view methods, including their real persistence and
// core-option behavior, rather than a second implementation of those methods.
const source = fs.readFileSync(path.join(root, 'retro-azahar/app/src/emulator/index.js'), 'utf8');
const views = source.slice(source.indexOf('const VIEWS ='), source.indexOf('const FRAME_MS'));
const methods = ['useView','getView','getViews','setView','getDefaultAspectRatio'].map(name =>
  source.match(new RegExp('\\n  '+name+'\\([^]*?\\n  }'))[0]).join('\n');
const fixture = `
 const system=location.pathname.includes('azahar')?'3ds':'nds';
 const VIEW_KEY='wrcad.touch.3ds-view.v1';
 ${views}
 class ThreeDS {${methods}}
 const canvas=document.createElement('canvas');document.body.append(canvas);
 const oldLayout={'button-8':[.5,.75],'button-10':[.5,.75],stick:[.5,.75],dpad:[.5,.75],
  'stick-right':[.5,.75],'button-4':[.5,.75],dock:[1,.18]};
 localStorage.setItem('webrcade.touch.layouts.v1',JSON.stringify({[system+':portrait']:oldLayout,[system+':landscape']:oldLayout}));
 let savedDS=4;const saved3DS='touch';
 localStorage.setItem('wrcad.touch.3ds-view.v1',saved3DS);
 localStorage.setItem('webrcade.touch.3ds-view.v1',saved3DS);
 window.pads=[];Object.defineProperty(navigator,'getGamepads',{value:()=>pads});
 window.coreOptions={}; window.coreCalls=[];
 window.Module={cwrap(){return (key,value)=>{coreCalls.push([key,value]);coreOptions[key]=value}}};
 const controller={isControlDown:()=>false,isPadButtonDown:()=>false,getAxisValue:()=>0,
  isAxisLeft:()=>false,isAxisRight:()=>false,isAxisUp:()=>false,isAxisDown:()=>false};
 const emulator=system==='3ds'?new ThreeDS():{};
 Object.assign(emulator,{canvas,started:true,paused:false,bookMode:true,
  controllers:{getController:()=>controller},pause(v){this.paused=v;return true},
  getPrefs(){return {getScreenLayout:()=>savedDS,setScreenLayout:v=>savedDS=v}},
  setBookMode(v){this.bookMode=v},resetToggleLayout(){},
  updateScreenLayout(){this.updateScreenSize()},
  updateScreenSize(){
   const layout=system==='3ds'?this.getView():this.getScreenLayout();
   const size=system==='3ds'?[this.VIDEO_WIDTH,this.VIDEO_HEIGHT]:
    [0,1].includes(layout)?[256,384]:[2,3].includes(layout)?[512,192]:[256,192];
   [canvas.width,canvas.height]=size;
   const ratio=size[0]/size[1],width=Math.min(innerWidth*.96,innerHeight*.96*ratio);
   Object.assign(canvas.style,{width:width+'px',height:width/ratio+'px',left:'50%',top:'50%'});
   const ctx=canvas.getContext('2d');ctx.fillStyle='#141c2b';ctx.fillRect(0,0,...size);
   ctx.fillStyle='#225eae';
   if(layout==='side'||layout===2)ctx.fillRect(0,0,system==='3ds'?400:256,size[1]);
   else ctx.fillRect(0,0,size[0],size[1]/2);
   ctx.fillStyle='#97416b';
   if(layout==='side'||layout===2)ctx.fillRect(system==='3ds'?400:256,0,system==='3ds'?320:256,size[1]);
   else ctx.fillRect(system==='3ds'?40:0,size[1]/2,system==='3ds'?320:256,size[1]/2);
  }});
 if(system==='3ds')emulator.useView(saved3DS);
 else {emulator.getScreenLayout=()=>savedDS;emulator.getDefaultAspectRatio=()=>
  [0,1].includes(emulator.getScreenLayout())?2/3:[2,3].includes(emulator.getScreenLayout())?8/3:4/3;}
 window.app={emulator,isShowOverlay:()=>false,isPauseScreen:()=>false};
 window.savedLayout=()=>savedDS;
 emulator.updateScreenSize();addEventListener('resize',()=>emulator.updateScreenSize());
`;
(async()=>{
 for(const engine of [chromium,webkit]) {
  const browser=await engine.launch({headless:true,...(engine===chromium?
   {executablePath:process.env.CHROME,args:['--no-sandbox']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
  try {for(const system of ['nds','3ds']) {
   const page=await browser.newPage({hasTouch:true,viewport:{width:382,height:580}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('http://sections.test/**',route=>route.fulfill({contentType:'text/html',body:`
    <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{margin:0;background:black}canvas{position:fixed;transform:translate(-50%,-50%)}</style>
    <style>${asset('controller.css')}</style></head><body><script>${fixture}</script>
    <script>${asset('controller.js')}</script></body></html>`}));
   await page.goto('http://sections.test/play/app/retro-'+(system==='3ds'?'azahar':'melonds')+'/');
   await page.locator('.kt-pad').waitFor({state:'visible'});
   const saved=await page.evaluate(()=>[savedLayout(),localStorage.getItem('wrcad.touch.3ds-view.v1'),localStorage.getItem('webrcade.touch.layouts.v1')]);
   for(const size of [{width:669,height:867},{width:951,height:585},{width:669,height:902},
    {width:951,height:620},{width:382,height:580},{width:385,height:571},{width:669,height:867}]) {
    await page.setViewportSize(size);await page.waitForTimeout(250);
    const expanded=size.width>=600;
    assert.equal(await page.locator('.kt-sections').count(),+expanded,system+' expanded layout gate');
    if(expanded) {
     const side=size.width>size.height,canvas=await page.locator('canvas').boundingBox();
     assert.equal(await page.evaluate(()=>app.emulator.getView?.()??app.emulator.getScreenLayout()),
      system==='3ds'?(side?'side':'stacked'):(side?2:0),'native arrangement follows rotation');
     assert(canvas.x>=181.5&&canvas.x+canvas.width<=size.width-181.5,'native screens leave left/right button space');
     const fraction=system==='3ds'?400/720:.5;
     assert(Math.abs(side?canvas.x+canvas.width*fraction-size.width/2:
      canvas.y+canvas.height/2-size.height/2)<.5,'native screen boundary matches window sections');
     const controls=await page.locator('.kt-pad button:visible,.kt-stick:visible,.kt-tab:visible').evaluateAll(els=>els.map(el=>{
      const r=el.getBoundingClientRect(),css=getComputedStyle(el).borderTopLeftRadius;
      return {...r.toJSON(),id:el.dataset.layoutId||'tab',circle:Math.abs(r.width-r.height)<1&&parseFloat(css)*(css.endsWith('%')?r.width/100:1)>=r.width/2};
     }));
     assert.equal(controls.length,system==='3ds'?15:11,'all controls remain visible');
     for(const control of controls) {
      const margin=control.id==='tab'?0:7.5;
      assert(control.x>=margin&&control.y>=margin&&control.right<=size.width-margin&&control.bottom<=size.height-margin,'control fits '+system+' '+JSON.stringify({size,control}));
      assert(control.right<=canvas.x||control.x>=canvas.x+canvas.width,'control stays outside both screens');
      if(!side&&control.id!=='tab')assert(control.bottom<=size.height/2-12||control.y>=size.height/2+12,'control stays clear of horizontal fold');
     }
     for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++) {
      const a=controls[i],b=controls[j];
      if(a.circle&&b.circle)assert(Math.hypot(a.x+a.width/2-b.x-b.width/2,a.y+a.height/2-b.y-b.height/2)>=a.width/2+b.width/2+5,'round controls do not overlap');
      else assert(a.right<=b.x-5||a.x>=b.right+5||a.bottom<=b.y-5||a.y>=b.bottom+5,'controls do not overlap '+a.id+'/'+b.id);
     }
     if(process.env.WEBRCADE_TEST_OUTPUT)await page.screenshot({path:path.join(process.env.WEBRCADE_TEST_OUTPUT,engine.name()+'-'+system+'-'+size.width+'x'+size.height+'.png')});
    } else {
     assert.equal(await page.evaluate(()=>app.emulator.getView?.()??savedLayout()),system==='3ds'?'touch':4,'fold/Split View restores manual choice');
     if(system==='nds')assert.equal(await page.evaluate(()=>app.emulator.bookMode),true,'book mode restored');
    }
    assert.deepEqual(await page.evaluate(()=>[savedLayout(),localStorage.getItem('wrcad.touch.3ds-view.v1'),localStorage.getItem('webrcade.touch.layouts.v1')]),saved,'automatic layout never saves manual preferences');
   }
   const edited=await page.evaluate(()=>{
    const values=JSON.parse(localStorage.getItem('webrcade.touch.layouts.v1'));
    values[system+':portrait:sections']={'button-8':[.12,.72],'button-12':[.12,.72]};
    const json=JSON.stringify(values);localStorage.setItem('webrcade.touch.layouts.v1',json);
    dispatchEvent(new Event('wrcad:controls-loaded'));return json;
   });
   await page.waitForTimeout(300);
   const l=await page.locator('[data-cid="8"]').boundingBox(),select=await page.locator('[data-cid="12"]').boundingBox();
   assert(l.x+l.width<=select.x-5||select.x+select.width<=l.x-5||l.y+l.height<=select.y-5||select.y+select.height<=l.y-5,'edited section controls resolve collisions');
   assert.equal(await page.evaluate(()=>localStorage.getItem('webrcade.touch.layouts.v1')),edited,'collision fitting does not rewrite saved coordinates');
   await page.locator('.kt-tab').click();await page.locator('.kt-sections-toggle').click();
   assert.equal(await page.locator('.kt-sections').count(),0,'manual opt-out restores normal view');
   await page.locator('.kt-sections-toggle').click();
   assert.equal(await page.locator('.kt-sections').count(),1,'automatic sections re-enable');
   await page.locator('.kt-close').click();
   if(system==='3ds') {
    await page.evaluate(()=>app.emulator.setView('stacked'));
    assert.equal(await page.evaluate(()=>localStorage.getItem('wrcad.touch.3ds-view.v1')),'stacked',
     'explicit choice matching automatic view still persists');
   }
   await page.evaluate(()=>{pads=[{index:0,connected:true}];const e=new Event('gamepadconnected');e.gamepad=pads[0];dispatchEvent(e)});
   await page.waitForTimeout(200);
   assert.equal(await page.locator('.kt-sections').count(),0,'physical controller restores native full-area view');
   assert.deepEqual(errors,[]);
   await page.close();console.log('PASS',engine.name(),system,'native rotation/section boundaries, side controls, saved view/book/layout restoration, opt-out and gamepad');
   // The installed host can exclude a status strip and offset the game frame.
   // Segment positions are in host coordinates; game placement is in frame coordinates.
   const installed=await browser.newPage({hasTouch:true,viewport:{width:669,height:867}});
   const gameURL='http://sections.test/play/app/retro-'+(system==='3ds'?'azahar':'melonds')+'/';
   await installed.route('http://sections.test/**',route=>route.fulfill({contentType:'text/html',body:`
    <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{margin:0;background:black}canvas{position:fixed;transform:translate(-50%,-50%)}</style>
    <style>${asset('controller.css')}</style></head><body><script>${fixture}</script><script>${asset('controller.js')}</script></body></html>`}));
   await installed.route('http://sections.test/host',route=>route.fulfill({contentType:'text/html',body:`
    <!doctype html><html data-cr-status-top><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;background:black"><script>
    Object.defineProperty(navigator,'standalone',{value:true});
    Object.defineProperty(screen,'height',{get:()=>innerHeight+64});Object.defineProperty(screen,'width',{get:()=>innerWidth});
    </script><iframe id="game" src="${gameURL}" style="position:fixed;left:0;top:40px;width:100%;height:calc(100% - 40px);border:0"></iframe></body></html>`}));
   await installed.goto('http://sections.test/host');
   const frame=await(await installed.locator('#game').elementHandle()).contentFrame();
   await frame.locator('.kt-pad').waitFor({state:'visible'});await installed.waitForTimeout(300);
   const boundary=async()=>{const r=await frame.locator('canvas').boundingBox();return r.y+r.height/2};
   assert(Math.abs(await boundary()-(867-64)/2)<.6,'installed physical fold excludes status area and accounts for frame offset');
   if(process.env.WEBRCADE_TEST_OUTPUT)await installed.screenshot({path:path.join(process.env.WEBRCADE_TEST_OUTPUT,engine.name()+'-'+system+'-installed.png')});
   await installed.evaluate(()=>{window.viewport={segments:[{left:0,top:0,right:669,bottom:300},{left:0,top:300,right:669,bottom:867}]}});
   await installed.waitForTimeout(300);
   assert(Math.abs(await boundary()-300)<.6,'reported segments override inferred display center');
   await frame.locator('.kt-tab').click();
   await frame.locator('#kt-fold-alignment').evaluate(el=>{el.value='3';el.dispatchEvent(new Event('input',{bubbles:true}))});
   await installed.waitForTimeout(200);
   assert(Math.abs(await boundary()-(300+827*.03))<.6,'device-local fold adjustment translates native screen boundary');
   assert.equal(await frame.locator('.kt-fold-guide').isVisible(),true,'alignment has visible guide');
   assert.equal(await frame.evaluate(()=>JSON.parse(localStorage.getItem('webrcade.touch.fold-alignment.v1')).stacked),3,'fold offset persists independently');
   await frame.locator('.kt-fold-reset').click();await installed.waitForTimeout(200);
   assert(Math.abs(await boundary()-300)<.6,'reset returns to reported fold');
   await installed.close();console.log('PASS',engine.name(),system,'legacy overlap isolation, installed/nested physical fold, reported segments and alignment guide/reset');
  }} finally {await browser.close()}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
