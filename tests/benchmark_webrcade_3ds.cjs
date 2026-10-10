// Isolated benchmark of the actual 3DS frontend loop, synchronous ROM reads and optional CPU profile.
// Requires Playwright and a combined feed at WEBRCADE_TEST_ORIGIN; uses no personal profiles/saves.
const { chromium, webkit, devices } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const origin = process.env.WEBRCADE_TEST_ORIGIN || 'http://localhost:18082';
const output = process.env.WEBRCADE_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'webrcade-3ds-benchmark-'));
fs.mkdirSync(output, { recursive: true });

(async () => {
  const engine = process.argv[2] || 'chromium';
  const tag = (process.argv[3] || 'benchmark').replace(/[^a-zA-Z0-9_-]/g, '_');
  const seconds = +(process.argv[4] || 30);
  if (!['webkit', 'chromium'].includes(engine) || !(seconds >= 1 && seconds <= 300)) {
    throw Error('Usage: node benchmark_webrcade_3ds.cjs [webkit|chromium] [label] [seconds:1..300]');
  }
  const browser = await (engine === 'webkit' ? webkit : chromium).launch({
    headless: true,
    ...(engine === 'chromium' ? {
      ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    } : {}),
  });
  try {
    const context = await browser.newContext({
      ...devices['iPhone 13'], viewport: { width: 402, height: 874 }, serviceWorkers: 'block',
    });
    await context.addInitScript(() => {
      window.perfRanges = { count: 0, ms: 0 };
      const send = XMLHttpRequest.prototype.send, open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (...args) {
        this.perfSync = args[2] === false;
        return open.apply(this, args);
      };
      XMLHttpRequest.prototype.send = function (...args) {
        const start = performance.now();
        try { return send.apply(this, args); }
        finally {
          if (this.perfSync) {
            perfRanges.count++;
            perfRanges.ms += performance.now() - start;
          }
        }
      };
    });
    const page = await context.newPage(), logs = [], errors = [];
    page.on('console', message => logs.push(message.text()));
    page.on('pageerror', error => errors.push(error.stack));
    const response = await context.request.get(origin + '/content/feeds/combined.json');
    if (!response.ok()) throw Error('Unable to read feed: ' + response.status());
    const feed = await response.json();
    const item = feed.categories.flatMap(category => category.items)
      .find(game => game.title.includes(process.env.WEBRCADE_TEST_TITLE || 'Ultra Moon'));
    if (!item) throw Error('Game absent from feed');
    const props = { type: '3ds', title: item.title, ...item.props };
    const encoded = Buffer.from(encodeURIComponent(JSON.stringify(props))).toString('base64');
    await page.goto(origin + '/play/app/retro-azahar/?ctx=standalone&props=' + encodeURIComponent(encoded));
    await page.waitForFunction(() => window.Module?._get_current_frame_count() > 150, null, { timeout: 120000 });
    await page.locator('.kt-actions button').filter({ hasText: /^A$/ }).tap();
    await page.waitForTimeout(3000);
    if (process.env.WEBRCADE_NO_VSYNC === '1') await page.evaluate(() => Module._set_vsync(0));
    let session;
    if (engine === 'chromium' && process.env.WEBRCADE_CPU_PROFILE === '1') {
      session = await context.newCDPSession(page);
      await session.send('Profiler.enable');
      await session.send('Profiler.setSamplingInterval', { interval: 1000 });
      await session.send('Profiler.start');
    }
    const snapshot = () => ({
      time: performance.now(), frame: Module._get_current_frame_count(), range: { ...perfRanges },
      heap: Module.HEAPU8.byteLength, audio: Module.RWA.context.state, pacing: emulator.frameTiming,
    });
    const before = await page.evaluate(snapshot);
    await page.waitForTimeout(seconds * 1000);
    const after = await page.evaluate(snapshot);
    if (session) {
      const { profile } = await session.send('Profiler.stop');
      fs.writeFileSync(path.join(output, tag + '.cpuprofile'), JSON.stringify(profile));
      const hits = new Map();
      for (const node of profile.nodes) if (node.hitCount) {
        const name = node.callFrame.functionName;
        hits.set(name, (hits.get(name) || 0) + node.hitCount);
      }
      console.log('top', JSON.stringify([...hits].sort((a, b) => b[1] - a[1]).slice(0, 20)));
    }
    // Frontend iterations are distinct from a game's own render FPS. Compare the same scene,
    // engine, hardware and audio state. Headless software GL does not predict phone performance.
    const result = {
      tag, engine, before, after,
      frontendFps: (after.frame - before.frame) * 1000 / (after.time - before.time),
      rangeMs: after.range.ms - before.range.ms, rangeCount: after.range.count - before.range.count,
      errors,
    };
    console.log(JSON.stringify(result));
    fs.writeFileSync(path.join(output, tag + '.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(output, tag + '.log'), logs.join('\n'));
    await page.screenshot({ path: path.join(output, tag + '.png') });
    if (errors.length) throw Error(errors.join('\n'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
