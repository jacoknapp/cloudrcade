// Real PSX library launch, bounded reads and native memory-card round trip.
// NODE_PATH=<Playwright node_modules> WEBRCADE_TEST_ORIGIN=<same-origin proxy>
// CHROME=<Chromium path> node tests/browser_webrcade_psx_stream.cjs chromium [title]
// Engine may be webkit. Profiles are disposable; no personal/cloud account used.
// PSX_SKIP_SAVE_RELOAD=1 runs only streaming/exit checks: the pinned unmodified
// PSX SDK has a separate composite-Blob IndexedDB failure in Linux WebKit.
const { chromium, webkit, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const origin = process.env.WEBRCADE_TEST_ORIGIN || 'http://localhost:18096';
const output = process.env.WEBRCADE_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'psx-stream-browser-'));
fs.mkdirSync(output, { recursive: true });
(async () => {
  const name = process.argv[2] || 'chromium', title = process.argv[3] || 'Crash Bandicoot - Warped';
  const browser = await (name === 'webkit' ? webkit : chromium).launch({ headless: true,
    ...(name === 'chromium' ? { ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] } : {}) });
  const logs = [], errors = [], discs = [];
  try {
    const context = await browser.newContext({ ...devices['iPhone 13'],
      serviceWorkers: process.env.PSX_SERVICE_WORKER === '1' ? 'allow' : 'block' });
    context.on('request', request => {
      if (/\.(?:chd|pbp)(?:\?|$)/i.test(new URL(request.url()).pathname)) {
        discs.push({ method: request.method(), range: request.headers().range });
      }
    });
    context.on('page', page => {
      page.on('pageerror', error => errors.push(error.stack));
      page.on('console', message => logs.push(message.text()));
    });
    const page = await context.newPage();
    await page.goto(origin + '/play/?feed=' + encodeURIComponent(origin + '/content/feeds/combined.json'));
    await page.waitForFunction(() => !!window.WrcadRecent?.getHistory || document.body.innerText.includes('PlayStation'));
    const ok = page.getByRole('button', { name: 'OK', exact: true });
    if (await ok.count()) await ok.first().click();
    const uid = await page.evaluate(title => {
      function find(node) {
        if (!node) return null;
        if (node.stateNode?.browseScreenRef) return node.stateNode;
        return find(node.child) || find(node.sibling);
      }
      const library = find(document.getElementById('root')._reactRootContainer._internalRoot.current);
      const item = library.state.feed.getUniqueCategories().flatMap(c => c.items)
        .find(i => i.type === 'psx' && i.title.includes(title));
      if (!item) throw new Error('Game missing: ' + title);
      library.browseScreenRef.current.props.onAppSelected(item);
      return item.props.uid;
    }, title);
    const frame = await (await page.waitForSelector('#webrcade-app-iframe')).contentFrame();
    await frame.waitForFunction(() => !!window.emulator?.mainStarted, null, { timeout: 120000 });
    const release = frame.locator('.release-screen-content');
    if (await release.isVisible()) await release.tap();
    await frame.waitForTimeout(15000);
    await frame.press('body', 'Enter');
    await frame.waitForTimeout(2000);
    await frame.press('body', 'x');
    await frame.waitForTimeout(10000);
    const state = await frame.evaluate(() => ({
      uid: emulator.uid, size: emulator.wrcadLazyDisc.size,
      requests: emulator.wrcadLazyDisc.requests, bytes: emulator.wrcadLazyDisc.bytesFetched,
      chunks: emulator.wrcadLazyDisc.chunks.size, heap: Module.HEAPU8.length,
      fsSize: FS.stat(emulator.game).size, resident: FS.lookupPath(emulator.game).node.contents,
      canvas: [emulator.canvas.width, emulator.canvas.height],
    }));
    assert.equal(state.uid, uid);
    assert.equal(state.fsSize, state.size);
    assert.equal(state.resident, null);
    assert(state.chunks <= 8);
    assert(state.bytes < state.size / 2, JSON.stringify(state));
    assert(state.heap < 256 * 1024 * 1024, JSON.stringify(state));
    assert(discs.some(r => r.method === 'HEAD'));
    assert(discs.some(r => r.method === 'GET' && r.range));
    assert(!discs.some(r => r.method === 'GET' && !r.range), 'must never request the full disc');
    console.log('PASS', name, title, 'native library Play and chunked disc', JSON.stringify(state));
    await page.screenshot({ path: path.join(output, name + '-running.png') });
    if (process.env.PSX_SKIP_SAVE_RELOAD === '1') {
      await frame.evaluate(() => { emulator.pause(true); emulator.wrcadLazyDisc.chunks.clear(); });
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log('SKIP native save/reload: pinned SDK composite-Blob IndexedDB limitation in Linux WebKit');
      return;
    }
    // Deliberately alter a byte in this fresh profile's unused memory card,
    // then verify native save/ZIP/load handling with the unchanged feed UID.
    const marker = await frame.evaluate(() => {
      emulator.pause(true);
      Module._cmd_savefiles();
      const file = '/home/web_user/retroarch/userdata/saves/game.srm';
      const bytes = FS.readFile(file);
      bytes[bytes.length - 1] = 23;
      FS.writeFile(file, bytes);
      // Seed a known marker after the core's flush so the native save method
      // persists it. This is test data in an unused disposable card only.
      const flush = Module._cmd_savefiles;
      Module._cmd_savefiles = function (...args) {
        const result = flush.apply(this, args);
        const card = FS.readFile(file);
        card[card.length - 1] = 23;
        FS.writeFile(file, card);
        return result;
      };
      return { file, length: bytes.length };
    });
    await frame.evaluate(() => app.onPreExit());
    assert.equal(await frame.evaluate(() => emulator.wrcadLazyDisc.chunks.size), 0);
    const frameUrl = frame.url();
    await frame.goto(frameUrl);
    await frame.waitForFunction(() => !!window.emulator?.mainStarted, null, { timeout: 120000 });
    assert.equal(await frame.evaluate(marker => {
      const bytes = FS.readFile(marker.file);
      if (bytes.length !== marker.length) throw new Error('Memory-card length changed');
      return bytes[bytes.length - 1];
    }, marker), 23);
    assert.equal(await frame.evaluate(() => emulator.uid), uid);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS unchanged UID, native local memory-card save/reload, cache cleared on exit');
  } finally {
    fs.writeFileSync(path.join(output, name + '.log'), logs.join('\n') + '\n' + errors.join('\n'));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
