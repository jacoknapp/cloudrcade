// Actual generated memory and compiled-block chain contracts in both engines; no ROM or cloud writes.
// Run on a freshly loaded core. SYSTEM=gamecube|wii selects the packaged build.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright');
const system = process.env.SYSTEM || 'gamecube';
const origin = system === 'wii'
  ? process.env.WEBRCADE_WII_ORIGIN || process.env.WEBRCADE_GAMECUBE_ORIGIN
  : process.env.WEBRCADE_GAMECUBE_ORIGIN || process.env.WEBRCADE_WII_ORIGIN;
assert(['gamecube', 'wii'].includes(system));
assert(origin, 'Supply the isolated GameCube or Wii origin');

(async () => {
  const results = [];
  for (const engine of [chromium, webkit]) for (const profile of (system === 'gamecube' ? ['standard', 'desktop'] : ['wii'])) {
    const browser = await engine.launch(engine === webkit
      ? { executablePath: process.env.WEBRCADE_TEST_WEBKIT_PATH }
      : { args: ['--no-sandbox'] });
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('crash', () => errors.push('Page crashed'));
      await context.route('**/cloud-saves/config.php*', route => route.fulfill({
        contentType: 'text/javascript',
        body: 'window.WrcadCloudConfig={enabled:false,storagePrefix:"memory-groups-isolated"};'
      }));
      await page.route('**/vendor/src/upstream-discio-worker.js', async route => {
        const response = await route.fetch(), source = await response.text();
        const anchor = '    case "nativeTiming": {';
        assert.equal(source.split(anchor).length, 2);
        const hook = `    case "memoryGroupSmoke": {
          const names=['_RunPpcWasmMultipleWordMemorySmoke',
            '_RunPpcWasmSinglePrecisionArithmeticSmoke','_RunPpcWasmDoublePrecisionArithmeticSmoke',
            '_RunPpcWasmPairedQuantizedMemorySmoke','_RunPpcWasmFloatCompareSmoke'];
          if (typeof moduleInstance._RunPpcWasmMem2Smoke === 'function')
            names.push('_RunPpcWasmMem2Smoke');
          const results=names.map(name=>({name,result:moduleInstance[name]()}));
          return {capacity:moduleInstance._DolphinWeb_GetWasmCacheCapacity(),results,
            dynamicLinkHits:moduleInstance._GetWasmDynamicLinkHits?.()>>>0};
        }\n`;
        await route.fulfill({ response, body: source.replace(anchor, hook + anchor) });
      });
      await page.goto(origin + '/experimental/' + system + '/');
      const result = await page.evaluate(async ({ system, profile }) => {
        const { UpstreamWorkerAdapter } = await import('./vendor/src/upstream-worker-adapter.js');
        const adapter = new UpstreamWorkerAdapter({ videoBackend: 'Null', ppcWasmJit: false, noJitCache: true });
        try {
          await adapter.load();
          if (system === 'gamecube') await adapter.request('jitCacheProfile', { profile });
          return await adapter.request('memoryGroupSmoke');
        } finally {
          adapter.rejectAll('Owned generated-memory smoke finished');
          adapter.worker?.terminate();
        }
      }, { system, profile });
      assert.equal(result.capacity, profile === 'standard' ? 16384 : 32768);
      assert.equal(result.results.length, system === 'wii' ? 6 : 5);
      for (const item of result.results) assert.equal(item.result, 1, item.name);
      if (system === 'wii') assert(result.dynamicLinkHits >= 3,
        'Wii exercises valid dynamic links and rejects poisoned PC/features/epoch targets');
      assert.deepEqual(errors, []);
      results.push({ system, profile, engine: engine.name(), ...result });
      console.log('PASS', system, profile, engine.name(), 'compiled-block chain budget/stop/epoch/helper contracts and generated RAM/FP differentials');
    } finally {
      await browser.close();
    }
  }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
