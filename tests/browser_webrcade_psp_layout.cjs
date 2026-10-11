// Real shared PSP controller defaults, rotation, input and saved layouts.
// Requires Playwright Chromium/WebKit; no ROMs, accounts or operator preferences.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const asset = name => fs.readFileSync(path.join(__dirname,
  '../deploy/webrcade/touch/assets', name), 'utf8');

(async () => {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({headless: true,
      ...(engine === chromium ? {executablePath: process.env.CHROME,
        args: ['--no-sandbox']} : {executablePath: process.env.WEBRCADE_TEST_WEBKIT_PATH})});
    try {
      const page = await browser.newPage({hasTouch: true, viewport: {width: 390, height: 844}});
      await page.route('http://controller.test/**', route => route.fulfill({
        contentType: 'text/html', body: '<html><head></head><body></body></html>'}));
      await page.goto('http://controller.test/play/app/retro-ppsspp/');
      const install = async (target = page) => {
        await target.addStyleTag({content: asset('controller.css')
          .replace(/env\(safe-area-inset-bottom(?:, 0px)?\)/g, '34px')
          .replace(/env\(safe-area-inset-top(?:, 0px)?\)/g, '59px')});
        await target.addStyleTag({content: 'html,body {margin:0;background:black}'});
        await target.evaluate(() => {
          const canvas = document.createElement('canvas');
          canvas.width = 480; canvas.height = 272;
          canvas.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)';
          // A positioned app container must not add its offset to viewport
          // coordinates (as the previous absolute canvas placement did).
          const container = document.createElement('div');
          container.style.cssText = 'position:absolute;left:17px;top:30px;width:100%;height:100%';
          container.append(canvas); document.body.append(container);
          const controller = {isControlDown: () => false, isPadButtonDown: () => false,
            getAxisValue: () => 0, isAxisLeft: () => false, isAxisRight: () => false,
            isAxisUp: () => false, isAxisDown: () => false};
          window.app = {isShowOverlay: () => false, isPauseScreen: () => false,
            emulator: {canvas, started: true, paused: false, screenSize: 0,
              SS_16_9: 2, SS_FILL: 3, getScreenSize() {return this.screenSize;},
              getDefaultAspectRatio: () => 480 / 272, getProps: () => ({}),
              getScreenLayout: () => 2,
              controllers: {getController: () => controller},
              getPrefs() {return {getScreenLayout: () => 0};},
              updateScreenSize() {
                for (const [name, value] of Object.entries({width:'96vw',height:'96vh',
                  'max-width':`calc(96vh * ${480 / 272})`,'max-height':`calc(96vw * ${272 / 480})`}))
                  canvas.style.setProperty(name, value, 'important');
              }, pause(value) {this.paused = value; return true;}}};
          app.emulator.updateScreenSize();
        });
        await target.addScriptTag({content: asset('controller.js')});
        await target.locator('.kt-pad').waitFor({state: 'visible'});
        await page.waitForTimeout(200);
      };
      await install();
      for (const installed of [false, true]) {
        await page.evaluate(value => document.documentElement.toggleAttribute('data-cr-installed', value), installed);
        for (const viewport of [{width:320,height:568}, {width:390,height:844},
          {width:430,height:932}, {width:480,height:800}, {width:599,height:900},
          {width:568,height:320}, {width:480,height:320}, {width:844,height:390},
          {width:768,height:1024}]) {
          await page.setViewportSize(viewport);
          await page.waitForTimeout(200);
          const controls = await page.locator('.kt-pad button:visible, .kt-stick:visible').evaluateAll(elements =>
            elements.map(element => ({id: element.dataset.layoutId,
              ...Object.fromEntries(['x','y','width','height'].map(key => [key, element.getBoundingClientRect()[key]]))})));
          const label = `${engine.name()} ${installed ? 'installed' : 'browser'} ${viewport.width}x${viewport.height}`;
          for (const r of controls) assert(r.x >= 8 && r.y >= 8 &&
            r.x + r.width <= viewport.width - 8 && r.y + r.height <= viewport.height - 8,
            `${label}: ${r.id} stays inside the viewport: ${JSON.stringify(r)}`);
          const byId = Object.fromEntries(controls.map(r => [r.id, r]));
          const separated = (a, b, gap = 0) => a.x + a.width + gap <= b.x + .5 ||
            b.x + b.width + gap <= a.x + .5 || a.y + a.height + gap <= b.y + .5 ||
            b.y + b.height + gap <= a.y + .5;
          const gap = viewport.width < 600 && viewport.width < viewport.height ? 20 : 0;
          assert(separated(byId['button-8'], byId.dpad, gap), `${label}: L and D-pad have separate touch targets`);
          assert(separated(byId.stick, byId.dpad, gap), `${label}: analog stick and D-pad have separate touch targets`);
          assert(separated(byId.dpad, byId['button-6']), `${label}: D-pad does not cover face buttons`);
        }
      }
      await page.setViewportSize({width:390,height:844});
      await page.waitForTimeout(200);
      assert.deepEqual(await page.locator('.kt-actions button').allTextContents(), ['△','□','○','✕']);
      assert.equal(await page.locator('.kt-shoulders button:visible').count(), 2);
      const controllerState = () => page.evaluate(() => {
        const c = app.emulator.controllers.getController(0);
        return {L: c.isControlDown(8), up: c.isControlDown(0), x: c.getAxisValue(0, true)};
      });
      for (const [id, expected] of [['button-8', {L:true,up:false,x:0}],
        ['dpad', {L:false,up:true,x:0}], ['stick', {L:false,up:false,x:.7}]]) {
        const r = await page.locator(`[data-layout-id="${id}"]`).boundingBox();
        const x = id === 'stick' ? r.x + r.width * .85 : r.x + r.width / 2;
        const y = id === 'dpad' ? r.y + 8 : r.y + r.height / 2;
        await page.mouse.move(x, y); await page.mouse.down();
        const state = await controllerState();
        assert.equal(state.L, expected.L, `${id}: L is independent`);
        assert.equal(state.up, expected.up, `${id}: D-pad is independent`);
        assert(id === 'stick' ? state.x > .5 : state.x === 0, `${id}: analog is independent`);
        await page.mouse.up();
        assert.deepEqual(await controllerState(), {L:false,up:false,x:0}, 'release clears input');
      }
      if (process.env.PSP_LAYOUT_SCREENSHOT_DIR) await page.screenshot({path:
        path.join(process.env.PSP_LAYOUT_SCREENSHOT_DIR, `psp-layout-${engine.name()}.png`)});
      // A CSS default fix must not override a user's deliberately saved layout.
      const saved = {'button-8':[.25,.25], dpad:[.3,.5], stick:[.3,.75]};
      await page.evaluate(saved => localStorage.setItem('webrcade.touch.layouts.v1',
        JSON.stringify({'psp:portrait':saved})), saved);
      await page.reload(); await install();
      for (const [id, [x,y]] of Object.entries(saved)) {
        const r = await page.locator(`[data-layout-id="${id}"]`).boundingBox();
        assert(Math.abs(r.x+r.width/2-x*390)<.5 && Math.abs(r.y+r.height/2-y*844)<.5,
          `${id}: saved position survives the new defaults`);
      }
      // Reproduce a game frame extending 60px below its installed-app host.
      // Child visualViewport alone reports the frame's larger layout bounds.
      await page.goto('http://controller.test/host/');
      await page.evaluate(() => {
        localStorage.clear(); document.body.style.margin = '0';
        const frame = document.createElement('iframe');
        frame.src = '/play/app/retro-ppsspp/';
        frame.style.cssText = `position:fixed;top:0;left:0;width:100%;height:${innerHeight+60}px;border:0`;
        document.body.append(frame);
      });
      const game = await (await page.locator('iframe').elementHandle()).contentFrame();
      await game.waitForURL('http://controller.test/play/app/retro-ppsspp/');
      await game.waitForLoadState(); await install(game);
      const checkPicture = async (width, height, left = 0, top = 0) => {
        const picture = await game.evaluate(() => {
          const canvas = app.emulator.canvas, r = canvas.getBoundingClientRect();
          return {x:r.x,y:r.y,width:r.width,height:r.height,buffer:[canvas.width,canvas.height]};
        });
        const installed = await game.evaluate(() => document.documentElement.hasAttribute('data-cr-installed'));
        const portrait = width < height;
        const pictureTop = portrait ? Math.max(top,59) : top;
        const pictureBottom = top + height - (portrait ? (installed ? 22 : 34) + 370 + 20 : 0);
        assert(Math.abs(picture.x + picture.width / 2 - left - width / 2)<.5 &&
          Math.abs(picture.y + picture.height / 2 - (pictureTop + pictureBottom)/2)<.5,
          'PSP picture centered above default portrait controls: '+JSON.stringify(picture));
        if(portrait) assert(picture.y >= pictureTop-.5 && picture.y+picture.height <= pictureBottom+.5,
          'portrait picture clears status area and default controls');
        assert(Math.abs(picture.width / picture.height - 480 / 272)<.005, 'PSP aspect ratio retained');
        assert(picture.width<=width && picture.height<=height, 'PSP picture fits the visible host');
        assert.deepEqual(picture.buffer,[480,272], 'placement leaves drawing buffer to the core');
      };
      await checkPicture(390,844);
      for (const installed of [false, true]) {
        await game.evaluate(value => document.documentElement.toggleAttribute('data-cr-installed', value), installed);
        for (const viewport of [{width:390,height:844}, {width:390,height:744}]) {
          await page.setViewportSize(viewport); await page.waitForTimeout(250);
          await checkPicture(viewport.width,viewport.height);
          for (const button of ['button-12','button-13','menu']) {
            const r = await game.locator(`[data-layout-id="${button}"]`).boundingBox();
            const bottomGap = viewport.height-r.y-r.height;
            assert.equal(r.height, 44, `${button}: full-size tap target`);
            assert(Math.abs(bottomGap-(installed ? 22 : 34))<.5,
              `${button}: visible above host bottom, including safe inset: ${JSON.stringify({r,bottomGap})}`);
          }
        }
      }
      // Model browser chrome hiding an additional part of the layout viewport.
      await page.evaluate(() => {
        const visual = new EventTarget();
        Object.assign(visual, {offsetLeft:0,offsetTop:0,width:innerWidth,height:innerHeight-50});
        Object.defineProperty(window, 'visualViewport', {configurable:true,value:visual});
        dispatchEvent(new Event('resize'));
      });
      await page.waitForTimeout(250);
      const start = await game.locator('[data-cid="13"]').boundingBox();
      assert(Math.abs(744-50-start.y-start.height-22)<.5, 'Start stays above visual viewport bottom');
      await checkPicture(390,694);
      // Visual viewport offsets may change without a child window resize.
      await page.evaluate(() => Object.assign(visualViewport,{offsetLeft:10,offsetTop:20,width:370,height:650}));
      await page.waitForTimeout(250); await checkPicture(370,650,10,20);
      const stable = await game.evaluate(() => new Promise(resolve => {
        let changes=0;
        const observer=new MutationObserver(records=>changes+=records.length);
        observer.observe(app.emulator.canvas,{attributes:true,attributeFilter:['style','width','height']});
        setTimeout(()=>{observer.disconnect();resolve(changes);},500);
      }));
      assert.equal(stable,0,'steady placement does not repeatedly resize or rewrite the canvas');
      // A native resize/settings update must not put the picture back in the
      // oversized iframe, even while the controller is hidden by a pause menu.
      await game.evaluate(() => {app.emulator.paused=true; app.emulator.updateScreenSize();});
      await page.waitForTimeout(250); await checkPicture(370,650,10,20);
      await game.evaluate(() => {app.emulator.paused=false;});
      await page.evaluate(() => Object.assign(visualViewport,{offsetLeft:0,offsetTop:0,width:390,height:744}));
      await game.evaluate(() => {app.emulator.screenSize=app.emulator.SS_FILL; app.emulator.updateScreenSize();});
      const fill = await game.locator('canvas').boundingBox();
      assert(Math.abs(fill.width-390*.96)<.5 && Math.abs(fill.height-(744-59-22-370-20)*.96)<.5, 'Fill setting fits the portrait play area');
      await game.evaluate(() => {app.emulator.screenSize=app.emulator.SS_16_9; app.emulator.updateScreenSize();});
      const wide = await game.locator('canvas').boundingBox();
      assert(Math.abs(wide.width/wide.height-16/9)<.005, '16:9 setting retained');
      // Disabling touch controls restores the whole visible viewport; re-enable
      // them without changing saved button positions or the drawing buffer.
      await game.locator('.kt-tab').click(); await game.locator('.kt-toggle').click();
      await game.locator('.kt-close').click();
      const noControls = await game.locator('canvas').boundingBox();
      assert(Math.abs(noControls.y+noControls.height/2-744/2)<.5,'controls off restores full viewport');
      await game.locator('.kt-tab').click(); await game.locator('.kt-toggle').click();
      await game.locator('.kt-close').click();
      await game.evaluate(() => {app.emulator.screenSize=0; app.emulator.updateScreenSize();});
      await checkPicture(390,744);
      // Shared visible bounds also keep other platforms' controls on screen;
      // their platform-specific spacing and input remain independent of PSP.
      await page.setViewportSize({width:390,height:844});
      for (const core of ['nes','snes','gb','gbc','gba','n64','nds','3ds','genesis','psx']) {
        await game.goto(`http://controller.test/play/app/${core}/`);
        await game.evaluate(() => document.documentElement.setAttribute('data-cr-installed', ''));
        await install(game);
        const host = await game.locator('#wrcad-touch').evaluate(element => ({
          overrides: ['left','top','width','height','right','bottom'].map(key => element.style[key]),
          height: element.getBoundingClientRect().height, psp: element.classList.contains('kt-psp')}));
        assert.deepEqual(host.overrides, ['0px','0px','390px','744px','auto','auto'], `${core}: shared visible viewport`);
        assert.equal(host.height, 744, `${core}: controls fit the parent visual viewport`);
        assert.equal(host.psp, false, `${core}: PSP spacing is not applied`);
      }
      console.log('PASS', engine.name(), 'PSP defaults, rotation, independent input, saved layout and fully visible Start/Select in oversized frames/browser chrome');
      console.log('PASS', engine.name(), 'all 10 other consoles fit the visible viewport without PSP-specific spacing');
    } finally {await browser.close();}
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
