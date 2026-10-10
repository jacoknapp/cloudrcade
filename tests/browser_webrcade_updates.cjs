/* Native update dialog regression; no ROM launch or real cloud account writes.
 * NODE_PATH=<Playwright modules> WEBRCADE_TEST_ORIGIN=https://arcade.example.test
 * STAGE_PLAYER=<patched bundle> stages local menu CSS and release notes.
 * WEBRCADE_TEST_BROWSER=webkit WEBRCADE_TEST_WEBKIT_PATH=<pw_run.sh> uses WebKit.
 * WEBRCADE_TEST_OUTPUT=<directory> captures portrait/landscape/desktop previews.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {chromium, webkit} = require('playwright');
const origin = process.env.WEBRCADE_TEST_ORIGIN || 'https://127.0.0.1:18477';
const safari = process.env.WEBRCADE_TEST_BROWSER === 'webkit';
const engine = safari ? 'webkit' : 'chromium';
const output = process.env.WEBRCADE_TEST_OUTPUT;
const staged = process.env.STAGE_PLAYER;
const latest = require('../src/react/screens/releasenotes/notes.json')[0];
function findLibrary() {
  function find(node) {
    if (!node) return null;
    if (node.stateNode?.browseScreenRef) return node.stateNode;
    return find(node.child) || find(node.sibling);
  }
  return find(document.getElementById('root')?._reactRootContainer?._internalRoot?.current);
}
(async () => {
  const browser = await (safari ? webkit : chromium).launch(safari && process.env.WEBRCADE_TEST_WEBKIT_PATH ? {executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH} : {});
  try {
    for (const mobile of [true, false]) {
      const context = await browser.newContext({ignoreHTTPSErrors:true, isMobile:mobile, hasTouch:mobile,
        viewport: mobile ? {width:390,height:844} : {width:1440,height:900}, serviceWorkers:'block'});
      let releaseFeed;
      const feedGate = new Promise(resolve => {releaseFeed = resolve;});
      await context.route('**/cloud-saves/config.php*', async route => {
        const response = await route.fetch();
        const config = JSON.parse((await response.text()).match(/WrcadCloudConfig\s*=\s*({.*?});/s)[1]);
        Object.assign(config, {enabled:false, autoRedirect:false, appName:'Configured Arcade', feedUrl:origin+'/content/feeds/combined.json'});
        await route.fulfill({response, body:'window.WrcadCloudConfig='+JSON.stringify(config)+';'});
      });
      await context.route('**/cloud-saves/api.php*', route => route.fulfill({json:{linked:false}}));
      await context.route('**/content/feeds/combined.json', async route => {await feedGate; await route.continue();});
      if (staged) {
        await context.route('**/play/static/js/main.*.chunk.js*', route => route.fulfill({contentType:'application/javascript', body:fs.readFileSync(staged)}));
        await context.route('**/touch-controls/menus.css*', route => route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(__dirname,'../deploy/webrcade/touch/assets/menus.css'))}));
      }
      // Record each actual paint: catch an initial old-content or stacked-dialog flash.
      await context.addInitScript(() => {
        window.updatePaints = [];
        function sample() {
          const visible = [...document.querySelectorAll('.release-screen-dialog,._QxYEW,._3SNG1')].filter(el => {
            const css = getComputedStyle(el), rect = el.getBoundingClientRect();
            return css.display !== 'none' && css.visibility !== 'hidden' && +css.opacity > .01 && rect.width && rect.height;
          });
          if (visible.length && window.updatePaints.length < 1500) window.updatePaints.push({count:visible.length, heading:document.querySelector('.release-screen-heading')?.textContent,
            title:document.querySelector('.release-title')?.textContent});
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      const page = await context.newPage(), errors = [], cores = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => {if (/\.wasm(?:\?|$)/.test(r.url())) cores.push(r.url());});
      await page.goto(origin+'/play/', {waitUntil:'domcontentloaded'});
      await page.locator('#loadingScreen').waitFor();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.release-screen-dialog,._QxYEW,._3SNG1').count(), 0, 'no startup dialogs while the library loads');
      releaseFeed();
      const popup = page.getByRole('dialog', {name:'Configured Arcade updates'});
      await popup.waitFor();
      assert.equal(await popup.locator('.release-screen-heading').textContent(), 'Configured Arcade updated', 'heading respects configured branding');
      assert.equal(await popup.locator('.release-title').innerText(), latest.title);
      assert.equal(await popup.locator('.release-item').count(), 1, 'only current fork notes, not the upstream archive');
      assert.match(await popup.innerText(), /PlayStation discs and larger 3DS ROMs stream during play/);
      assert.match(await popup.innerText(), /3DS shaders cache as they are created/);
      const sizes = mobile ? [[390,844,'phone'],[320,568,'small-phone'],[844,390,'landscape'],[768,1024,'tablet']] : [[1440,900,'desktop']];
      for (const [width,height,name] of sizes) {
        await page.setViewportSize({width,height});
        await page.waitForTimeout(150);
        const geometry = await popup.evaluate(el => {
          const box = node => node.getBoundingClientRect().toJSON();
          const toggle = el.querySelector('label'), ok = el.querySelector('.release-buttons-centered button');
          const hit = node => {const rect=node.getBoundingClientRect(); return node.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));};
          return {panel:box(el), footer:box(el.querySelector('.release-screen-buttons')), toggle:box(toggle), ok:box(ok), hitToggle:hit(toggle), hitOK:hit(ok),
            textSize:parseFloat(getComputedStyle(el.querySelector('.change-item')).fontSize)};
        });
        for (const rect of [geometry.panel, geometry.toggle, geometry.ok]) assert(rect.x>=0 && rect.y>=0 && rect.right<=width && rect.bottom<=height, name+' controls fit the viewport');
        assert(geometry.toggle.right<=geometry.ok.x, name+' footer controls never overlap');
        assert(geometry.hitToggle && geometry.hitOK, name+' footer controls are unobstructed touch targets');
        if (mobile) {
          assert(geometry.toggle.width>=44 && geometry.toggle.height>=44 && geometry.ok.width>=44 && geometry.ok.height>=44, name+' targets at least 44px');
          assert(geometry.textSize>=13 && geometry.textSize<=16, name+' readable compact note text');
        }
        const content = popup.locator('.release-screen-content');
        await content.evaluate(el => {el.scrollTop=el.scrollHeight;});
        assert.deepEqual(await popup.locator('.release-screen-buttons').evaluate(el=>el.getBoundingClientRect().toJSON()),geometry.footer, name+' footer stays fixed while notes scroll');
        if (output) await page.screenshot({path:path.join(output,engine+'-'+name+'-'+(staged?'staged':'live')+'.png')});
        await content.evaluate(el => {el.scrollTop=0;});
      }
      const paints = await page.evaluate(() => window.updatePaints);
      assert(paints.length && paints.every(p => p.count===1 && p.heading==='Configured Arcade updated' && p.title===latest.title), 'first paint has only one current update dialog');
      const checkbox = popup.locator('input[type=checkbox]');
      await popup.locator('label').click();
      assert(await checkbox.isChecked(), 'do not show checkbox can be tapped');
      await popup.getByRole('button',{name:'OK',exact:true}).click();
      await popup.waitFor({state:'detached'});
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(`(${findLibrary})()?.state?.feed?.getCategories()?.length > 0`);
      await page.waitForTimeout(700);
      assert.equal(await page.locator('.release-screen-dialog').count(),0,'do not show preference survives reload');
      assert.deepEqual(await page.evaluate(()=>window.updatePaints),[],'hidden update does not flash on reload');
      assert.deepEqual(errors, []);
      assert.deepEqual(cores, [], 'notes do not load game cores');
      console.log('PASS '+engine+' '+(mobile?'phone/small phone/landscape/tablet':'desktop')+': current configured notes on first paint, no stacked popup flash, fixed usable footer, tap/close/hide preference persists, no core loads or JavaScript errors');
      await context.close();
    }
    // Reproduce the startup race: an alert already owns the screen as the feed completes.
    const blocked = await browser.newContext({ignoreHTTPSErrors:true,isMobile:true,hasTouch:true,viewport:{width:390,height:844},serviceWorkers:'block'});
    let finishFeed;
    const gate = new Promise(resolve => {finishFeed=resolve;});
    await blocked.route('**/cloud-saves/config.php*',async route => {
      const response=await route.fetch();
      const config=JSON.parse((await response.text()).match(/WrcadCloudConfig\s*=\s*({.*?});/s)[1]);
      Object.assign(config,{enabled:false,autoRedirect:false,feedUrl:origin+'/content/feeds/combined.json'});
      await route.fulfill({response,body:'window.WrcadCloudConfig='+JSON.stringify(config)+';'});
    });
    await blocked.route('**/cloud-saves/api.php*',route=>route.fulfill({json:{linked:false}}));
    await blocked.route('**/content/feeds/combined.json',async route=>{await gate;await route.continue();});
    if(staged) {
      await blocked.route('**/play/static/js/main.*.chunk.js*',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(staged)}));
      await blocked.route('**/touch-controls/menus.css*',route=>route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(__dirname,'../deploy/webrcade/touch/assets/menus.css'))}));
    }
    const startup=await blocked.newPage();
    await startup.goto(origin+'/play/',{waitUntil:'domcontentloaded'});
    await startup.waitForFunction(`(${findLibrary})()?.ctx`);
    await startup.evaluate(`(${findLibrary})().ctx.showAlertScreen(true,'Startup notice')`);
    finishFeed();
    await startup.waitForFunction(`(${findLibrary})()?.state?.mode === 'browse' && !(${findLibrary})()?.state?.initial`);
    await startup.waitForTimeout(500);
    assert.equal(await startup.locator('.release-screen-dialog').count(),0,'startup notes do not stack over an existing alert');
    assert(await startup.evaluate(`(${findLibrary})().ctx.isAlertScreenOpen()`),'the existing alert stays open');
    await startup.evaluate(`(${findLibrary})().ctx.showAlertScreen(false)`);
    await startup.waitForTimeout(300);
    assert.equal(await startup.locator('.release-screen-dialog').count(),0,'closing an alert does not trigger a delayed update popup');
    assert(await startup.locator('.cr-mobile-card').first().isVisible(),'library remains usable after startup alert');
    await blocked.close();
    console.log('PASS '+engine+': an active startup alert suppresses optional notes instead of stacking dialogs');
  } finally {await browser.close();}
})().catch(e => {console.error(e);process.exitCode=1;});
