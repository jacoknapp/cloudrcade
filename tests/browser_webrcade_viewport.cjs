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
  const controller={isControlDown:()=>false,isPadButtonDown:()=>false,getAxisValue:()=>0,
    isAxisLeft:()=>false,isAxisRight:()=>false,isAxisUp:()=>false,isAxisDown:()=>false};
  window.app={isShowOverlay:()=>false,isPauseScreen:()=>false,emulator:{canvas,started:true,paused:false,
    SS_16_9:2,SS_FILL:3,getScreenSize:()=>0,getDefaultAspectRatio:()=>ratio,getProps:()=>({}),
    getScreenLayout:()=>0,getPrefs:()=>({getScreenLayout:()=>0}),
    controllers:{getController:()=>controller},updateScreenSize(){
      canvas.style.width=Math.min(innerWidth*.96,innerHeight*.96*ratio)+'px';
      canvas.style.height=parseFloat(canvas.style.width)/ratio+'px';
    },pause(value){this.paused=value;return true}}};
  app.emulator.updateScreenSize(); addEventListener('resize',()=>app.emulator.updateScreenSize());
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
            if(core==='psx' && viewport.width<height) {
              assert(Math.abs(picture.y-16)<.5,'PSX portrait aligns near safe top');
              assert(Math.abs(picture.x+picture.width/2-viewport.width/2)<.5,'PSX horizontal center preserved');
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
          await page.evaluate(()=>window.opaqueInset=60);
          await game.locator('.kt-tab').click();await game.locator('.kt-toggle').click();
          await page.waitForTimeout(180);const off=await game.locator('canvas').boundingBox();
          assert.deepEqual(off,initial,'PSX top placement and native size remain with controls off/drawer open');
          await game.locator('.kt-toggle').click();await game.locator('.kt-tab').click();
          await page.evaluate(()=>window.opaqueInset=0);
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
      console.log('PASS',engine.name(),'all 11 cores/library/native frames fit actual visible phone through rotation/browser chrome; whole-phone single-screen centering, PSX safe-top portrait and PSP above controls; native buffers intact');
      await context.close();
      const desktop=await browser.newPage({viewport:{width:1440,height:900}});
      await desktop.goto('data:text/html,<html><head></head><body></body></html>');
      await desktop.addScriptTag({content:asset('brand.js')});
      assert.equal(await desktop.evaluate(()=>document.documentElement.style.getPropertyValue('--cr-viewport-height')),'','desktop keeps native sizing');
      await desktop.close();
    } finally {await browser.close();}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
