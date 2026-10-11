/* Native library PSP default availability regression. No ROMs, accounts or operator saves.
 * NODE_PATH=<Playwright modules> WEBRCADE_TEST_ORIGIN=https://localhost:8443
 * STAGE_PLAYER=<patched bundle> optionally stages the current library patch.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, webkit} = require('playwright');
const origin = process.env.WEBRCADE_TEST_ORIGIN || 'https://localhost:8443';
const feed = {title:'PSP defaults test',categories:[
  {title:'NES',items:[{title:'NES fixture',type:'nes',props:{rom:'/content/fixture.nes'}}]},
  {title:'PSP',items:[{title:'PSP fixture',type:'psp',props:{rom:'/content/fixture.elf'}}]},
]};
async function libraryTypes(page) {
  await page.waitForFunction(() => {
    function find(n) { return !n ? null : n.stateNode?.browseScreenRef ? n.stateNode : find(n.child) || find(n.sibling); }
    const root = document.getElementById('root')?._reactRootContainer?._internalRoot.current;
    const library = find(root);
    return library?.state.feed?.getUniqueCategories?.().some(c=>c.items?.some(i=>i.title==='NES fixture')) &&
      !document.body.innerText.includes('Loading feed...');
  });
  return page.evaluate(() => {
    function find(n) { return !n ? null : n.stateNode?.browseScreenRef ? n.stateNode : find(n.child) || find(n.sibling); }
    return find(document.getElementById('root')._reactRootContainer._internalRoot.current)
      .state.feed.getUniqueCategories().flatMap(c => c.items).map(i => typeof i.type === 'string' ? i.type : i.type?.key);
  });
}
async function settings(page, enable3DS) {
  // Native startup transition and optional release popup finish after feed parsing.
  await page.waitForTimeout(1500);
  const ok = page.getByRole('button',{name:'OK',exact:true});
  if (await ok.count()) await ok.first().click();
  await page.locator('.header-nav-right button').last().click();
  for (let i=0;i<(enable3DS?5:4);i++) await page.locator('button._17LMl').nth(1).click();
  if (enable3DS) await page.getByText('3DS performance readout',{exact:true}).waitFor();
  await page.waitForFunction(()=>{const e=document.querySelector('._1OdS7');return !e || +getComputedStyle(e).opacity>.95;});
}
const hasPSP = types => types.some(type => type === 'psp' || type === 'retro-ppsspp');
(async () => {
  for (const engine of [chromium,webkit]) {
    const browser = await engine.launch({headless:true,
      ...(engine === chromium ? {executablePath:process.env.CHROME,args:['--no-sandbox']} :
        {executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
    try {
      for (const enable3DS of [false,true]) {
       for (const legacyPreference of [null,'0','1']) {
        const context = await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',
          viewport:{width:390,height:844},hasTouch:true});
        await context.addInitScript(value=>{
          if(value!==null)localStorage.setItem('psp_test.psp.enabled.v1',value);
        },legacyPreference);
        const errors=[];
        const page = await context.newPage();
        page.on('pageerror',e=>errors.push(e.stack));
        await page.route('**/cloud-saves/config.php',r=>r.fulfill({contentType:'application/javascript',
          body:'window.WrcadCloudConfig='+JSON.stringify({appName:'PSP Test',storagePrefix:'psp_test',
            enabled:false,autoRedirect:false,enable3DS,feedUrl:'/content/feeds/combined.json'})+';'}));
        await page.route('**/content/feeds/combined.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(feed)}));
        if (process.env.STAGE_PLAYER) await page.route('**/main.7ac86965.chunk.js*',r=>r.fulfill({
          contentType:'application/javascript',body:fs.readFileSync(process.env.STAGE_PLAYER)}));
        await page.goto(origin+'/play/?feed='+encodeURIComponent(origin+'/content/feeds/combined.json'));
        const types=await libraryTypes(page);
        assert(hasPSP(types),'PSP is registered without opt-in, independent of old preference');
        assert(types.includes('nes'),'other consoles remain available');
        await settings(page,enable3DS);
        assert.equal(await page.getByText('Enable PSP (experimental)',{exact:true}).count(),0);
        assert.equal(await page.getByText('3DS performance readout',{exact:true}).count(),enable3DS?1:0);
        assert.equal(await page.getByText('3DS lighting on CPU (slower)',{exact:true}).count(),enable3DS?1:0);
        if(enable3DS){
          const perf=page.getByText('3DS performance readout',{exact:true}).locator('..');
          assert.equal(await perf.locator('input').isChecked(),false);
          await perf.locator('label').click();
          assert.equal(await perf.locator('input').isChecked(),true);
          await perf.locator('label').click();
        }
        await page.reload();
        assert(hasPSP(await libraryTypes(page)),'PSP remains available after reload');
        assert.equal(errors.length,0,errors.join('\n'));
        await context.close();
        console.log('PASS',engine.name(),'PSP available by default, no toggle, legacy preference:',legacyPreference,'3DS enabled:',enable3DS);
       }
      }
    } finally { await browser.close(); }
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
