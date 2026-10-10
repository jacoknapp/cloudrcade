/* Cold-start history restoration in the real pinned library. No ROMs or accounts.
 * Requires Playwright and WEBRCADE_TEST_ORIGIN/PORT for a TLS test server.
 * STAGE_RECENT=1 serves the current adapter; EXPECT_BROKEN=1 reproduces the old bug.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {chromium, webkit, devices} = require('playwright');
const origin = process.env.WEBRCADE_TEST_ORIGIN || 'https://arcade.example.test';
const port = process.env.WEBRCADE_TEST_PORT || '18477';
const prefix = 'history-fixture';
const config = {appName:'History fixture', storagePrefix:prefix, saveFolder:'Fixture',
  feedUrl:origin+'/content/feeds/combined.json', server:'https://cloud.example.test',
  enabled:true, autoRedirect:false, accessAllowed:true, enable3DS:true};
const game = {title:'Recent game', type:'nes', props:{uid:'fixture-recent', rom:origin+'/fixture.nes'}};
const other = {title:'Other game', type:'snes', props:{uid:'fixture-other', rom:origin+'/fixture.sfc'}};
const feed = {title:'History fixture', categories:[{title:'NES', items:[game]}, {title:'SNES', items:[other]}]};
const entry = {key:JSON.stringify(['nes','uid',game.props.uid]), playedAt:100};
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
      for (const mobile of [true, false]) for (const source of ['remote', 'account-cache', 'account-switch']) {
        const context = await browser.newContext({ignoreHTTPSErrors:true, serviceWorkers:'block',
          ...(mobile ? {...devices['iPhone 13']} : {viewport:{width:1440,height:900}})});
        await context.route('**/cloud-saves/config.php', r => r.fulfill({contentType:'application/javascript', body:'window.WrcadCloudConfig='+JSON.stringify(config)+';'}));
        await context.route('**/content/feeds/combined.json', r => r.fulfill({json:feed}));
        let historyGets = 0, historyWrites = 0;
        await context.route('**/cloud-saves/api.php?**', async r => {
          const url = new URL(r.request().url());
          if (url.searchParams.get('action') === 'status') return r.fulfill({json:{csrf:'fixture',config}});
          if (url.searchParams.get('action') === 'file' && url.searchParams.get('path') === '/settings/recently-played.v1.json') {
            if (r.request().method() !== 'GET') {historyWrites++;return r.fulfill({status:200,headers:{ETag:'"fixture"'},body:''});}
            historyGets++;
            if (source !== 'remote') return r.fulfill({status:503,json:{error:'Offline fixture'}});
            await new Promise(resolve => setTimeout(resolve, 800));
            return r.fulfill({json:{version:1,entries:[entry]},headers:{ETag:'"fixture"'}});
          }
          return r.fulfill({status:404,json:{error:'Missing fixture'}});
        });
        await context.addInitScript(({prefix, source, config, entry, other}) => {
          const connection = prefix+'.nextcloud.connection.v1', sync = prefix+'.recently-played.sync.v1.';
          localStorage.setItem(connection, JSON.stringify({server:config.server,uid:'alice',login:'fixture',password:'synthetic-fixture',name:'Fixture'}));
          if (source !== 'remote') {
            localStorage.setItem(sync+'owner', JSON.stringify(source === 'account-switch' ? 'bob' : 'alice'));
            localStorage.setItem(sync+JSON.stringify('alice'), JSON.stringify([entry]));
            if (source === 'account-switch') localStorage.setItem(prefix+'.recently-played.v1', JSON.stringify([JSON.stringify(['snes','uid',other.props.uid])]));
          }
        }, {prefix, source, config, entry, other});
        if (process.env.STAGE_RECENT) await context.route('**/touch-controls/recently-played.js*', r => r.fulfill({contentType:'application/javascript', body:fs.readFileSync(path.join(__dirname,'../deploy/webrcade/touch/assets/recently-played.js'))}));
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin+'/play/', {waitUntil:'domcontentloaded'});
        await page.waitForFunction('('+findBrowse.toString()+')()?.state.feed');
        // Wait for native startup before dismissing its optional update popup.
        // Hiding it before startup finishes races the native show timer.
        const updates = page.locator('.release-screen-dialog');
        await updates.waitFor({state:'visible'});
        await updates.getByRole('button',{name:'OK',exact:true}).click();
        if (process.env.EXPECT_BROKEN) {
          await page.waitForTimeout(1500);
          assert.equal(historyGets, 0, 'old adapter never requests cloud history on initial load');
          if (source !== 'account-switch') assert.equal(await page.evaluate('('+findBrowse.toString()+')().state.feed.getCategories().some(c=>c.wrcadRecent)'), false);
          await page.evaluate(() => WrcadRecent.sync());
        }
        await page.waitForFunction('('+findBrowse.toString()+')().state.feed.getCategories().some(c=>c.wrcadRecent)', null, {timeout:8000});
        await page.waitForFunction('('+findBrowse.toString()+')().state.feed.getCategories().find(c=>c.wrcadRecent).items[0].props.uid === "fixture-recent"');
        if (mobile) {
          await page.getByRole('button',{name:'Recently Played',exact:true}).click();
          await page.getByRole('button',{name:'Recent game',exact:true}).waitFor();
          await page.getByRole('button',{name:'Recent game',exact:true}).click();
          await page.getByRole('dialog',{name:'Recent game',exact:true}).waitFor();
        } else {
          await page.evaluate('('+findBrowse.toString()+')().button1Ref.current.props.onClick()');
          await page.waitForFunction('('+findBrowse.toString()+')().state.currentItem?.props?.uid === "fixture-recent"');
        }
        assert.equal(historyWrites, 0, 'startup must not overwrite existing or unavailable remote history');
        assert.deepEqual(errors, []);
        console.log('PASS', engine.name(), mobile ? 'mobile' : 'desktop', source, process.env.EXPECT_BROKEN ? 'reproduced missing startup sync; manual sync restores folder' : 'cold-start folder restoration and selection without focus/click-to-sync');
        await context.close();
      }
    } finally {await browser.close();}
  }
})().catch(error => {console.error(error);process.exitCode = 1;});
