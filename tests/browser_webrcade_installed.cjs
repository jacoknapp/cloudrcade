/* Installed viewport regression against the real pinned library/AppScreen.
 * Models WebKit's underreported dynamic height; does not emulate physical iOS.
 * The emulator document is a fixture: no ROMs, cores, keys or player accounts.
 * NODE_PATH=<Playwright> WEBRCADE_TEST_ORIGIN=<TLS origin>
 * WEBRCADE_TEST_WEBKIT_PATH=<optional WebKit executable> node this-file
 * STAGE_VIEWPORT=1 stages current adapters; EXPECT_BROKEN=1 checks old gap.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {chromium, webkit, devices} = require('playwright');
const origin = process.env.WEBRCADE_TEST_ORIGIN || 'https://arcade.example.test';
const port = process.env.WEBRCADE_TEST_PORT || '18477';
const assets = path.join(__dirname, '../deploy/webrcade/touch/assets');
const findBrowse = () => {
  function find(n) { if (!n) return null; if (n.stateNode?.browseScreenRef) return n.stateNode;
    return find(n.child) || find(n.sibling); }
  return find(document.getElementById('root')?._reactRootContainer?._internalRoot.current)?.browseScreenRef.current;
};
(async () => {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({headless:true, ...(engine === chromium ?
      {args:['--no-sandbox','--ignore-certificate-errors',
        '--host-resolver-rules=MAP '+new URL(origin).hostname+':443 127.0.0.1:'+port]} :
      {executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
    try {
      for (const mode of ['browser','standalone','legacy-ios']) {
        const installed = mode !== 'browser';
        const context = await browser.newContext({...devices['iPhone 13'], ignoreHTTPSErrors:true, serviceWorkers:'block'});
        await context.addInitScript(mode => {
          Object.defineProperty(navigator, 'standalone', {configurable:true, value:mode === 'legacy-ios' && window === window.top});
          const nativeMatch = window.matchMedia.bind(window);
          window.matchMedia = query => {
            const result = nativeMatch(query);
            if (mode === 'standalone' && query === '(display-mode: standalone)')
              Object.defineProperty(result, 'matches', {value:true});
            return result;
          };
        }, mode);
        const config = {appName:'Viewport fixture', storagePrefix:'viewport-fixture',
          enabled:false, autoRedirect:false, accessAllowed:false, enable3DS:true,
          feedUrl:origin+'/content/feeds/combined.json'};
        await context.route('**/cloud-saves/config.php', r => r.fulfill({contentType:'application/javascript', body:'window.WrcadCloudConfig='+JSON.stringify(config)+';'}));
        await context.route('**/cloud-saves/api.php?**', r => r.fulfill({json:{csrf:'fixture',config}}));
        await context.route('**/content/feeds/combined.json', r => r.fulfill({json:{title:'Fixture',categories:[{title:'NES',items:[
          {title:'Viewport game',type:'nes',props:{uid:'fixture-viewport',rom:origin+'/fixture.nes'}}]}]}}));
        let romRequests = 0;
        await context.route('**/fixture.nes', r => {romRequests++;return r.abort();});
        const stage = Boolean(process.env.STAGE_VIEWPORT);
        for (const file of ['mobile.css','brand.js','controller.css','viewport.css']) {
          await context.route('**/touch-controls/'+file+'*', async r => {
            let body, response;
            if (stage) body = fs.readFileSync(path.join(assets,file),'utf8');
            else {response = await r.fetch();body = await response.text();}
            // This fixture deliberately separates dvh from the full screen.
            if (installed && file.endsWith('.css')) body = body.replaceAll('100dvh','calc(100vh - 60px)');
            await r.fulfill({...(response ? {response} : {}),contentType:file.endsWith('.css')?'text/css':'application/javascript',body});
          });
        }
        if (stage) await context.route('**/play/', async r => {
          const response = await r.fetch();
          await r.fulfill({response,body:(await response.text()).replace('<head>','<head><link rel="stylesheet" href="/touch-controls/viewport.css">')});
        });
        await context.route('**/play/app/**', async r => {
          if (r.request().resourceType() !== 'document') return r.fallback();
          const response = await r.fetch();
          await r.fulfill({response,contentType:'text/html',body:`<!doctype html><html><head>
            <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
            <link rel="stylesheet" href="/touch-controls/viewport.css">
            <link rel="stylesheet" href="/touch-controls/controller.css">
            <script defer src="/touch-controls/brand.js"></script>
            <style>html,body{margin:0;background:black;height:100%;overflow:hidden}</style></head>
            <body><div id="wrcad-touch"><div class="kt-pad"><div class="kt-center"><button>Bottom target</button></div></div></div>
            <script>window.addEventListener('load',()=>{frameElement.style.display='block';parent.postMessage('appLoaded','*')});</script></body></html>`});
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => {errors.push(e.message);console.log('JS',e.message);});
        await page.goto(origin+'/play/', {waitUntil:'domcontentloaded'});
        await page.waitForFunction('('+findBrowse.toString()+')()?.state.feed');
        const updates = page.locator('.release-screen-dialog');
        await updates.waitFor({state:'visible'});
        await updates.getByRole('button',{name:'OK',exact:true}).click();
        const expectedHeight = h => h - (installed && process.env.EXPECT_BROKEN ? 60 : 0);
        for (const viewport of [{width:393,height:852},{width:852,height:393},{width:320,height:568}]) {
          await page.setViewportSize(viewport);await page.waitForTimeout(100);
          const bounds = await page.locator('.cr-mobile-library').boundingBox();
          assert(Math.abs(bounds.y)<1 && Math.abs(bounds.height-expectedHeight(viewport.height))<1,
            mode+' library fills expected viewport: '+JSON.stringify(bounds));
        }
        await page.setViewportSize({width:393,height:852});
        await page.getByRole('button',{name:'NES',exact:true}).click();
        await page.getByRole('button',{name:'Viewport game',exact:true}).click();
        await page.getByRole('dialog').getByRole('button').filter({hasText:/^\s*PLAY\s*$/}).click();
        await page.locator('#webrcade-app-iframe').waitFor({state:'visible'});
        const frame = await (await page.locator('#webrcade-app-iframe').elementHandle()).contentFrame();
        for (const viewport of [{width:393,height:852},{width:852,height:393},{width:320,height:568}]) {
          await page.setViewportSize(viewport);await page.waitForTimeout(100);
          const bounds = await page.locator('#webrcade-app-iframe').boundingBox();
          assert(Math.abs(bounds.x)<1 && Math.abs(bounds.y)<1 && Math.abs(bounds.width-viewport.width)<1 &&
            Math.abs(bounds.height-expectedHeight(viewport.height))<1,mode+' native frame fills expected viewport: '+JSON.stringify(bounds));
          assert.equal(await frame.evaluate(()=>innerHeight),Math.round(bounds.height));
          const target = await frame.getByRole('button',{name:'Bottom target'}).boundingBox();
          const bottomGap = bounds.height - target.y - target.height;
          assert(bottomGap>=11 && bottomGap<=27,'bottom touch target stays near frame edge: '+JSON.stringify({target,bounds,bottomGap}));
        }
        assert.equal(romRequests,0);
        assert.deepEqual(errors,[]);
        console.log('PASS',engine.name(),mode,'library/native iframe/bottom touch target across portrait, landscape and small phone',
          installed && process.env.EXPECT_BROKEN ? '(reproduced 60px gap)' : '(no reserved bottom strip)');
        await context.close();
      }
    } finally {await browser.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
