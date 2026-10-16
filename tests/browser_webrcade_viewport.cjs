// Shared phone viewport regression: oversized lvh and changing browser chrome.
// Uses the real adapters and native-style game iframe; no ROMs or accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {chromium, webkit} = require('playwright');
const asset = name => fs.readFileSync(path.join(__dirname, '../deploy/webrcade/touch/assets', name), 'utf8');
const cores = ['nes','snes','gb','gbc','gba','n64','nds','3ds','genesis','psx','psp'];
const css = name => asset(name).replaceAll('100lvh', 'calc(100vh + 60px)')
  .replace(/env\(safe-area-inset-top(?:, 0px)?\)/g, '0px')
  .replace(/env\(safe-area-inset-bottom(?:, 0px)?\)/g, '34px');
const fixture = `
  const handheld = ['gb','gbc'].includes(location.pathname.split('/')[3]);
  const dimensions = handheld ? [160,144] : location.pathname.includes('/psx/') ? [320,240] : [480,272], ratio = dimensions[0]/dimensions[1];
  const canvas = document.createElement('canvas'); [canvas.width,canvas.height]=dimensions;
  document.body.append(canvas);
  const controller={isControlDown:function(cid,analogToDigital=true){return analogToDigital && ['isAxisUp','isAxisDown','isAxisLeft','isAxisRight'][cid] ? this[['isAxisUp','isAxisDown','isAxisLeft','isAxisRight'][cid]](0) : false},isPadButtonDown:()=>false,getAxisValue:()=>0,
    isAxisLeft:()=>false,isAxisRight:()=>false,isAxisUp:()=>false,isAxisDown:()=>false};
  window.app={isShowOverlay:()=>false,isPauseScreen:()=>false,emulator:{canvas,started:true,paused:false,analogMode:false,
    SS_16_9:2,SS_FILL:3,getScreenSize:()=>0,getDefaultAspectRatio:()=>ratio,getProps:()=>({}),
    getScreenLayout:()=>0,getPrefs:()=>({getScreenLayout:()=>0}),
    controllers:{getController:()=>controller},updateScreenSize(){
      canvas.style.width=Math.min(innerWidth*.96,innerHeight*.96*ratio)+'px';
      canvas.style.height=parseFloat(canvas.style.width)/ratio+'px';
    },pause(value){this.paused=value;return true}}};
  const fixtureApp=app;
  fixtureApp.emulator.updateScreenSize(); addEventListener('resize',()=>fixtureApp.emulator.updateScreenSize());
  if(location.pathname.includes('/psx/')) {
    // Pinned native audio-screen markup/styles; the adapter must relocate this
    // visual hint without replacing the real core's audio activation handler.
    const audio=document.createElement('div');audio.className='_1EdfC';
    audio.innerHTML='<div class="_2fzXq"><div class="_3kAeI"><button class="_3_mWk"><span class="_1s7E8">Tap Screen to Unmute</span></button></div></div>';
    document.body.append(audio);
    const loading=document.createElement('div');loading.id='fixture-loading';
    loading.innerHTML='<div class="_3o3pD">Loading...</div><div class="_1sp2T">37%</div>';
    document.body.append(loading);
    window.fixtureApp=fixtureApp;window.app=null;
  }
`;
(async () => {
  for (const engine of [chromium,webkit]) {
    const browser=await engine.launch({headless:true,...(engine===chromium ?
      {executablePath:process.env.CHROME,args:['--no-sandbox']} : {executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
    try {
      const context=await browser.newContext({hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',viewport:{width:390,height:784}});
      await context.addInitScript(() => {
        Object.defineProperty(navigator,'standalone',{get:()=>window===window.top && window.fixtureInstalled!==false});
        if(window===window.top) {
          Object.defineProperty(screen,'width',{get:()=>innerWidth});
          Object.defineProperty(screen,'height',{get:()=>innerHeight+(window.opaqueInset||0)});
          const visual=new EventTarget();
          Object.defineProperties(visual,{
            width:{get:()=>innerWidth},height:{get:()=>innerHeight-(window.chromeInset||0)},
            offsetLeft:{get:()=>window.chromeLeft||0},offsetTop:{get:()=>window.chromeTop||0},
            scale:{get:()=>window.viewportScale||1}});
          Object.defineProperty(window,'visualViewport',{value:visual});
        }
      });
      await context.route('http://viewport.test/**', route => {
        const url=new URL(route.request().url()), file=url.pathname.split('/').pop();
        if(file.endsWith('.js')||file.endsWith('.css')) return route.fulfill({contentType:
          file.endsWith('.css')?'text/css':'application/javascript',body:file.endsWith('.css')?css(file):asset(file)});
        const game=url.pathname.startsWith('/play/app/');
        return route.fulfill({contentType:'text/html',body:`<!doctype html><html ${game?'':'data-cr-mobile'}><head>
          <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
          <link rel="stylesheet" href="/viewport.css"><link rel="stylesheet" href="/${game?'controller':'mobile'}.css">
          <style>html,body{margin:0;background:black;overflow:hidden}
            canvas{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}
            ._1EdfC{position:absolute;display:flex;z-index:49;inset:0;align-items:center;pointer-events:none}
            ._2fzXq{height:100vh;width:100vw;position:relative;overflow:hidden}
            ._3o3pD,._1sp2T{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}
            ._3o3pD{font-size:2.5rem;z-index:5}._1sp2T{font-size:10rem}
            ._3kAeI{padding:1rem}._3_mWk{margin:0;padding:.6rem 1rem;display:flex;align-items:center;font-size:1.8rem;line-height:2rem;white-space:nowrap}

            #webrcade-app{position:fixed;inset:0}#webrcade-app-iframe{width:100%;height:100%;border:0}
          </style><script defer src="/brand.js"></script></head><body>${game?
          '<script>'+fixture+'</script><script defer src="/controller.js"></script>':
          '<div class="cr-mobile-library"></div><div id="webrcade-app"><iframe id="webrcade-app-iframe"></iframe></div>'}</body></html>`});
      });
      const page=await context.newPage(), errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto('http://viewport.test/host/');
      const checkFrame=async (width,height,left=0,top=0) => {
        const frame=await page.locator('iframe').boundingBox();
        assert(Math.abs(frame.width-width)<.5 && Math.abs(frame.height-height)<.5,
          'native game frame matches visible phone, not oversized lvh: '+JSON.stringify({frame,width,height}));
        assert(Math.abs(frame.x-left)<.5 && Math.abs(frame.y-top)<.5,'frame follows visual viewport offsets');
        const library=await page.locator('.cr-mobile-library').boundingBox();
        assert(Math.abs(library.height-height)<.5,'library uses same visible height');
      };
      await checkFrame(390,784); // Old installed lvh behavior is 844px: reproduced failure.
      for(const core of cores) {
        await page.locator('iframe').evaluate((element,core)=>element.src='/play/app/'+core+'/',core);
        const game=await (await page.locator('iframe').elementHandle()).contentFrame();
        await game.waitForURL('http://viewport.test/play/app/'+core+'/');
        if(core==='psx') {
          for(const viewport of [{width:390,height:784},{width:844,height:390},{width:320,height:568}]) {
            await page.setViewportSize(viewport);await page.waitForTimeout(180);
            const readyCanvasStyle=await game.locator('canvas').getAttribute('style');
            for(const phase of ['no-app','no-emulator','unstarted']) {
              await game.evaluate(phase=>{
                window.app=phase==='no-app'?null:phase==='no-emulator'?{emulator:null}:fixtureApp;
                fixtureApp.emulator.started=false;
                document.querySelector('._3o3pD').textContent=phase==='unstarted'?'Starting...':'Loading...';
              },phase);
              await page.waitForTimeout(180);
              const safe=await game.locator('.kt-psx-origin').boundingBox(),center=viewport.width<viewport.height?safe.y+safe.height/2:viewport.height/2;
              for(const selector of ['._3o3pD','._1sp2T']) {
                const r=await game.locator(selector).boundingBox();
                assert(Math.abs(r.x+r.width/2-viewport.width/2)<.5 && Math.abs(r.y+r.height/2-center)<.5,'PSX '+phase+' loading/progress center in default game area through rotation');
              }
              assert.equal(await game.locator('.kt-pad').isVisible(),false,'PSX loading hides touch controls');
              assert.equal(await game.locator('canvas').getAttribute('style'),readyCanvasStyle,'PSX loading never rewrites unstarted canvas style');
            }
          }
          await game.evaluate(()=>{window.app=fixtureApp;fixtureApp.emulator.started=true;fixtureApp.emulator.updateScreenSize();});
        }
        await game.locator('.kt-pad').waitFor({state:'visible'});
        for(const viewport of [{width:390,height:784},{width:844,height:390},{width:320,height:568}]) {
          await page.setViewportSize(viewport);
          for(const inset of [0,50,0]) {
            await page.evaluate(inset=>{window.chromeInset=inset;visualViewport.dispatchEvent(new Event('resize'));},inset);
            await page.waitForTimeout(180);
            const height=viewport.height-inset;
            await checkFrame(viewport.width,height);
            assert.equal(await game.evaluate(()=>innerHeight),height,core+' native viewport is visible height');
            const controls=await game.locator('.kt-pad button:visible,.kt-stick:visible').evaluateAll(els=>
              els.map(el=>({id:el.dataset.layoutId,...el.getBoundingClientRect().toJSON()})));
            for(const r of controls) assert(r.x>=7.5 && r.y>=7.5 && r.right<=viewport.width-7.5 && r.bottom<=height-7.5,
              core+' '+viewport.width+'x'+height+' visible control '+JSON.stringify(r));
            for(const id of ['button-13','menu',...(['n64','genesis'].includes(core)?[]:['button-12'])])
              assert(controls.some(r=>r.id===id),core+' '+id+' available');
            const picture=await game.locator('canvas').boundingBox();
            assert(picture.x>=-.5 && picture.y>=-.5 && picture.x+picture.width<=viewport.width+.5 && picture.y+picture.height<=height+.5,
              core+' picture fits visible phone');
            if(['gb','gbc'].includes(core) && viewport.width<height) {
              const safe=await game.locator('.kt-gb-origin').boundingBox();
              const center=Math.max(picture.height/2,Math.min(height-picture.height/2,safe.y+safe.height/2));
              assert(Math.abs(picture.y+picture.height/2-center)<.5,core+' picture centers above raised default controls');
              assert.equal(await game.locator('#wrcad-touch.kt-gameboy').count(),1);
            }
            if(core==='psx' && viewport.width<height) {
              const safe=await game.locator('.kt-psx-origin').boundingBox();
              assert(Math.abs(picture.y+picture.height/2-(safe.y+safe.height/2))<.5,'PSX approved default picture position remains independent of DualShock controls');
              assert(Math.abs(picture.x+picture.width/2-viewport.width/2)<.5,'PSX horizontal center preserved');
            }
            if(core==='psx') {
              assert.equal(await game.locator('.kt-analog-left:visible,.kt-analog-right:visible').count(),2,'PSX shows both sticks before analog-mode activation');
              for(const selector of ['._3o3pD','._1sp2T']) {
                const loading=await game.locator(selector).boundingBox();
                assert(Math.abs(loading.x+loading.width/2-picture.x-picture.width/2)<.5 && Math.abs(loading.y+loading.height/2-picture.y-picture.height/2)<.5,'PSX active Starting/progress follows actual picture');
              }
              const prompt=await game.locator('._3kAeI').boundingBox();
              assert(Math.abs(prompt.x+prompt.width/2-picture.x-picture.width/2)<.5 && Math.abs(prompt.y+prompt.height/2-picture.y-picture.height/2)<.5,'PSX native unmute prompt centers over the picture');
              const label=await game.locator('._3_mWk').boundingBox();
              assert(label.x>=-.5 && label.y>=-.5 && label.x+label.width<=viewport.width+.5 && label.y+label.height<=height+.5,'PSX audio prompt fits phone');
            }
            if(core==='psp' && viewport.width<height) {
              const pad=await game.locator('.kt-pad').boundingBox();
              assert(picture.y+picture.height<=pad.y-19.5,'PSP game clears default portrait controls');
              assert(Math.abs(picture.y+picture.height/2-(pad.y-20)/2)<.5,'PSP centered above controls');
            }
            assert.deepEqual(await game.locator('canvas').evaluate(el=>[el.width,el.height]),['gb','gbc'].includes(core)?[160,144]:core==='psx'?[320,240]:[480,272],'native drawing buffer preserved');
          }
        }
        if(core==='psx') {
          await page.setViewportSize({width:390,height:784});await page.waitForTimeout(180);
          const initial=await game.locator('canvas').boundingBox();
          const controllerLayout=await game.locator('.kt-pad').evaluate(el=>el.getBoundingClientRect().toJSON());
          const left=await game.locator('.kt-analog-left').boundingBox();
          await page.mouse.move(left.x+left.width*.85,left.y+left.height/2);await page.mouse.down();
          assert(await game.evaluate(()=>app.emulator.controllers.getController(0).isControlDown(3,true)),'PSX left stick supplies digital-mode D-pad input');
          assert.equal(await game.evaluate(()=>app.emulator.controllers.getController(0).isControlDown(3,false)),false,'analog-mode polling keeps D-pad separate from stick');
          for(const mode of [true,false]) {
            await game.evaluate(mode=>app.emulator.analogMode=mode,mode);await page.waitForTimeout(180);
            assert.equal(await game.locator('.kt-analog-left:visible,.kt-analog-right:visible').count(),2,'core mode changes never pop sticks in or out');
            assert.deepEqual(await game.locator('.kt-pad').evaluate(el=>el.getBoundingClientRect().toJSON()),controllerLayout,'DualShock block stays stable across core mode changes');
            assert.deepEqual(await game.locator('canvas').boundingBox(),initial,'PSX mode changes leave approved picture placement unchanged');
            assert(await game.evaluate(()=>app.emulator.controllers.getController(0).getAxisValue(0,true))>.5,'mode changes do not drop held stick input');
          }
          await page.mouse.up();
          const right=await game.locator('.kt-analog-right').boundingBox();
          await page.mouse.move(right.x+right.width*.85,right.y+right.height/2);await page.mouse.down();
          assert(await game.evaluate(()=>app.emulator.controllers.getController(0).getAxisValue(1,true))>.5,'right stick supplies its own axes');
          assert.equal(await game.evaluate(()=>app.emulator.controllers.getController(0).getAxisValue(0,true)),0,'right stick leaves left axes released');
          await page.mouse.up();

          await game.locator('.kt-pad').evaluate(el=>el.style.height='120px');
          await game.locator('.kt-shoulders').evaluate(el=>el.style.transform='translateY(-50px)');
          await page.waitForTimeout(180);
          assert.deepEqual(await game.locator('canvas').boundingBox(),initial,'PSX default picture placement is independent of controller block sizing and positions');
          await game.locator('.kt-pad').evaluate(el=>el.style.removeProperty('height'));
          await game.locator('.kt-shoulders').evaluate(el=>el.style.removeProperty('transform'));
          await game.locator('canvas').evaluate(el=>{el.style.width='390px';el.style.height='784px';});
          await page.waitForTimeout(180);
          const fill=await game.locator('canvas').boundingBox();
          assert.equal(fill.width,390,'PSX native Fill width is not constrained to the default portrait area');
          assert.equal(fill.height,784,'PSX native Fill height is not constrained to the default portrait area');
          assert(Math.abs(fill.y+fill.height/2-392)<.5,'PSX native Fill can use the whole screen');
          await game.evaluate(()=>app.emulator.updateScreenSize());
          await page.waitForTimeout(180);
          assert.deepEqual(await game.locator('canvas').boundingBox(),initial,'PSX native resize restores the default position');
          await page.evaluate(()=>window.opaqueInset=60);
          await game.locator('.kt-tab').click();await game.locator('.kt-toggle').click();
          await page.waitForTimeout(180);const off=await game.locator('canvas').boundingBox();
          assert.deepEqual(off,initial,'PSX centering above standard controls and native size remain with controls off/drawer open');
          await game.locator('.kt-toggle').click();await game.locator('.kt-tab').click();
          await page.evaluate(()=>window.opaqueInset=0);
        } else if(['gb','gbc'].includes(core)) {
          await page.setViewportSize({width:390,height:784});await page.waitForTimeout(300);
          const original=await game.locator('canvas').boundingBox();
          await game.locator('.kt-tab').click();await game.locator('.kt-toggle').click();await page.waitForTimeout(300);
          assert.deepEqual(await game.locator('canvas').boundingBox(),original,core+' hiding controls keeps upper picture placement');
          await game.locator('.kt-toggle').click();await game.locator('.kt-tab').click();
        } else if(!['nds','3ds','psp'].includes(core)) {
          await page.setViewportSize({width:390,height:784});
          const expectedCenter=async (center) => {
            await page.waitForTimeout(180);
            const r=await game.locator('canvas').boundingBox();
            assert(Math.abs(r.x+r.width/2-195)<.5 && Math.abs(r.y+r.height/2-center)<.5,
              core+' whole-phone centering: '+JSON.stringify({r,center}));
            return r;
          };
          const original=await expectedCenter(392);
          await page.evaluate(()=>window.opaqueInset=60);
          const adjusted=await expectedCenter(362);
          assert.equal(adjusted.width,original.width,'native width unchanged by status compensation');
          assert.equal(adjusted.height,original.height,'native height unchanged by status compensation');
          // Disabling touch controls does not move a whole-screen-centered game.
          await game.locator('.kt-tab').click();await game.locator('.kt-toggle').click();
          await expectedCenter(362);
          await game.locator('.kt-toggle').click();
          await expectedCenter(362);
          await game.locator('.kt-tab').click();
          // Browser chrome and keyboard/split-window gaps are not status strips.
          await page.evaluate(()=>window.fixtureInstalled=false);await expectedCenter(392);
          await page.evaluate(()=>{window.fixtureInstalled=true;window.opaqueInset=200});await expectedCenter(392);
          await page.evaluate(()=>window.opaqueInset=0);
        }
      }
      // Pinch zoom must not feed a zoomed visual size back into layout sizing.
      await page.evaluate(()=>{window.viewportScale=2;window.chromeInset=50;visualViewport.dispatchEvent(new Event('resize'));});
      await page.waitForTimeout(180); await checkFrame(320,568);
      // Visible bounds can move without a window resize or animation frame.
      await page.evaluate(()=>{
        window.requestAnimationFrame=()=>0;
        window.viewportScale=1;window.chromeInset=20;window.chromeLeft=10;window.chromeTop=20;
        visualViewport.dispatchEvent(new Event('scroll'));
      });
      await page.waitForTimeout(180);await checkFrame(310,548,10,20);
      const stable=await page.evaluate(()=>new Promise(resolve=>{
        let changes=0;const observer=new MutationObserver(records=>changes+=records.length);
        observer.observe(document.documentElement,{attributes:true,attributeFilter:['style']});
        setTimeout(()=>{observer.disconnect();resolve(changes)},300);
      }));
      assert.equal(stable,0,'no repeated viewport writes while dimensions are stable');
      assert.deepEqual(errors,[]);
      console.log('PASS',engine.name(),'all 11 cores/library/native frames fit actual visible phone through rotation/browser chrome; whole-phone single-screen centering, GB/GBC and PSX portrait above default controls and PSP above controls; native buffers intact');
      await context.close();
      const desktop=await browser.newPage({viewport:{width:1440,height:900}});
      await desktop.goto('data:text/html,<html><head></head><body></body></html>');
      await desktop.addScriptTag({content:asset('brand.js')});
      assert.equal(await desktop.evaluate(()=>document.documentElement.style.getPropertyValue('--cr-viewport-height')),'','desktop keeps native sizing');
      await desktop.route('http://viewport.test/play/app/psx/',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body style="margin:0"><style>canvas{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}</style><script>${fixture}</script></body></html>`}));
      await desktop.goto('http://viewport.test/play/app/psx/');
      await desktop.evaluate(()=>{app=fixtureApp;app.emulator.started=true;});
      const nativeStyle=await desktop.locator('canvas').getAttribute('style');
      await desktop.addScriptTag({content:asset('controller.js')});
      assert.equal(await desktop.locator('canvas').getAttribute('style'),nativeStyle,'desktop PSX retains native canvas styling');
      assert.equal(await desktop.locator('#wrcad-touch').count(),0,'desktop PSX has no touch controller');
      for(const viewport of [{width:1440,height:900},{width:900,height:1440}]) {
        await desktop.setViewportSize(viewport);await desktop.waitForTimeout(100);
        const picture=await desktop.locator('canvas').boundingBox();
        assert(Math.abs(picture.x+picture.width/2-viewport.width/2)<.5 && Math.abs(picture.y+picture.height/2-viewport.height/2)<.5,'desktop PSX stays centered in either orientation');
      }
      console.log('PASS',engine.name(),'desktop PSX native centering and no touch overlay in both orientations');
      await desktop.close();
    } finally {await browser.close();}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
