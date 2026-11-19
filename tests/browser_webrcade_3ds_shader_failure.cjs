// Real compiled core: reject programmable vertex shaders and verify CPU fallback.
// Requires Playwright and a staged 3DS app/feed. Optional WEBRCADE_TEST_STATE is
// a read-only scene state; saves/cloud uploads stay in a disposable profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium, webkit, devices } = require('playwright');

const origin = process.env.WEBRCADE_TEST_ORIGIN || 'http://localhost:18084';
const output = process.env.WEBRCADE_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), '3ds-shader-failure-'));
fs.mkdirSync(output, { recursive: true });

(async () => {
  const engine = process.argv[2] || 'webkit';
  const fail = process.env.WEBRCADE_TEST_REJECT_SHADERS !== '0';
  const synchronous = process.env.WEBRCADE_TEST_SYNC_SHADERS === '1';
  const hardware = process.env.WEBRCADE_TEST_HARDWARE_GPU === '1';
  const browser = await (engine === 'webkit' ? webkit : chromium).launch({
    headless: true,
    ...(engine === 'chromium' ? {
      ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
      args: ['--no-sandbox', ...(hardware ?
        ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--disable-vulkan-surface'] :
        ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])],
    } : { executablePath: process.env.WEBRCADE_TEST_WEBKIT_PATH }),
  });
  let progress;
  try {
    const context = await browser.newContext({
      ...devices['iPhone 14 Pro'], serviceWorkers: 'block', permissions: ['screen-wake-lock'],
    });
    if (process.env.WEBRCADE_TEST_CORE_DIR) {
      await context.route('**/js/*/azahar_libretro.{js,wasm}', (route) => route.fulfill({
        path: path.join(process.env.WEBRCADE_TEST_CORE_DIR,
          new URL(route.request().url()).pathname.split('/').pop()),
        headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
      }));
    }
    await context.addInitScript(({ fail, synchronous }) => {
      const probe = window.shaderFailureProbe = {
        sharedStages: 0, specializedStages: 0, rejected: 0, invalidUses: 0, links: 0, gameLinks: 0, rejectedRelinks: 0, liveRelinks: 0,
      };
      const statuses = new WeakMap();
      const sources = new WeakMap();
      const contexts = new WeakMap();
      const programs = new WeakMap();
      const proto = WebGL2RenderingContext.prototype;
      const { createShader, shaderSource, getProgramParameter, useProgram, linkProgram, deleteProgram,
        getExtension } = proto;
      proto.createShader = function (type) {
        const shader = createShader.call(this, type);
        if (shader) sources.set(shader, { type });
        return shader;
      };
      proto.shaderSource = function (shader, source) {
        const stage = sources.get(shader);
        if (stage) stage.source = source;
        if (stage?.type === this.FRAGMENT_SHADER && source.includes('uniform fs_data')) {
          if (source.includes('uniform highp ivec4 tev_control[')) probe.sharedStages++;
          else probe.specializedStages++;
        }
        // PICA-generated GPU vertex programs; the trivial CPU vertex shader is valid.
        if (fail && source.includes('void EmitVtx()') && source.includes('bool sub_')) {
          probe.rejected++;
          source += '\nwrc_force_vertex_compile_failure;\n';
        }
        return shaderSource.call(this, shader, source);
      };
      proto.getProgramParameter = function (program, name) {
        const result = getProgramParameter.call(this, program, name);
        if (name === this.LINK_STATUS) {
          statuses.set(program, result);
          const observed = programs.get(program);
          if (observed) {
            const { state, key } = observed;
            if (result) {
              if (!state.accepted.has(key)) state.accepted.set(key, new Set());
              state.accepted.get(key).add(program);
            } else {
              state.rejected.add(key);
            }
          }
        }
        return result;
      };
      proto.useProgram = function (program) {
        const observed = programs.get(program);
        if (statuses.get(program) === false || observed?.state.rejected.has(observed.key))
          probe.invalidUses++;
        return useProgram.call(this, program);
      };
      function forgetProgram(program) {
        const observed = programs.get(program);
        if (!observed) return;
        const { state, key } = observed;
        const active = state.accepted.get(key);
        if (active?.delete(program) && active.size === 0) state.accepted.delete(key);
        programs.delete(program);
      }
      proto.deleteProgram = function (program) {
        forgetProgram(program);
        return deleteProgram.call(this, program);
      };
      proto.linkProgram = function (program) {
        probe.links++;
        const stages = (this.getAttachedShaders(program) || []).map((shader) => sources.get(shader));
        if (stages.some((stage) => stage?.source?.includes('uniform fs_data'))) {
          probe.gameLinks++;
          if (stages.every((stage) => stage?.source !== undefined)) {
            // Match complete original stage text and type across shader object recreation.
            const key = JSON.stringify(stages.sort((a, b) => a.type - b.type)
              .map(({ type, source }) => [type, source]));
            if (!contexts.has(this)) contexts.set(this, { accepted: new Map(), rejected: new Set() });
            const state = contexts.get(this);
            if (state.rejected.has(key)) probe.rejectedRelinks++;
            if (state.accepted.has(key)) probe.liveRelinks++;
            forgetProgram(program);
            programs.set(program, { state, key });
          }
        }
        statuses.delete(program);
        return linkProgram.call(this, program);
      };
      proto.getExtension = function (name) {
        if (synchronous && name === 'KHR_parallel_shader_compile') return null;
        return getExtension.call(this, name);
      };
      // Prevent any personal cloud interaction in the test profile.
      const timer = setInterval(() => {
        if (!window.emulator) return;
        const manager = emulator.getSaveManager();
        if (!manager) return;
        manager.isCloudEnabled = async () => false;
        clearInterval(timer);
      }, 10);
    }, { fail, synchronous });

    const feed = await (await context.request.get(origin + '/content/feeds/combined.json')).json();
    const item = feed.categories.find((category) => category.title === 'Nintendo 3DS').items
      .find((game) => game.title.includes(process.env.WEBRCADE_TEST_TITLE || 'Ultra Moon'));
    assert(item, 'test game is in staged feed');
    const props = Buffer.from(encodeURIComponent(JSON.stringify({
      type: '3ds', title: item.title, rom: item.props.rom,
    }))).toString('base64');
    const appURL = origin + '/play/app/retro-azahar/?ctx=standalone&props=' + encodeURIComponent(props);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => { errors.push(error.message); console.log('PAGEERROR', error.message); });
    await page.goto(appURL);
    const frame = page;
    progress = setInterval(() => {
      frame.evaluate(() => ({
        text: document.body.innerText.slice(0, 160),
        frames: window.Module?._get_current_frame_count?.(),
        started: window.emulator?.mainStarted,
      })).then((state) => console.log('PROGRESS', JSON.stringify(state))).catch(() => {});
    }, 15000);
    const snapshot = () => frame.evaluate(() => ({
      ...shaderFailureProbe,
      frames: Module._get_current_frame_count(),
      native: Module.nativeVertexStats,
      failures: (Module.wrcShaderFailures || []).map((failure) => ({
        log: failure.log, shaders: failure.shaders.map(({ type, compiled, log, source }) =>
          ({ type, compiled, log, sourceLength: source.length })),
      })),
      shaders: Module.wrcShaders,
      hybrid: Module.wrcHybrid,
      sharedEnabled: Module.wrcSharedCombiner,
    }));

    await frame.waitForFunction(() => window.Module?._get_current_frame_count?.() > 100,
      null, { timeout: 300000 });
    if (process.env.WEBRCADE_TEST_SHADER_CACHE) {
      const cache = fs.readFileSync(process.env.WEBRCADE_TEST_SHADER_CACHE).toString('base64');
      await frame.evaluate(async (data) => {
        const bytes = Uint8Array.from(atob(data), (byte) => byte.charCodeAt(0));
        await emulator.getStorage().put(emulator.shaderCacheKey(), bytes);
      }, cache);
      await page.reload();
      await frame.waitForFunction(() => window.Module?._get_current_frame_count?.() > 100,
        null, { timeout: 300000 });
    }
    const yes = frame.getByText('Yes', { exact: true });
    if (await yes.count()) await yes.first().tap();
    const release = frame.locator('.release-screen-content');
    if (await release.isVisible()) await release.tap();
    if (process.env.WEBRCADE_TEST_SHADER_CACHE) {
      await frame.waitForFunction(() => Module.wrcShaders?.prewarmScanned, null, { timeout: 60000 });
      assert((await snapshot()).shaders.rebuilt > 0, 'restored shader pairs were submitted');
    }
    console.log('BOOT', JSON.stringify(await snapshot()));
    await frame.waitForTimeout(1000);
    const loadScene = async () => {
      await frame.evaluate((base64) => {
        const bytes = Uint8Array.from(atob(base64), (byte) => byte.charCodeAt(0));
        FS.writeFile('/home/web_user/retroarch/userdata/states/game.state', bytes);
        Module.wrcStateResult = null;
        Module._cmd_load_state();
      }, fs.readFileSync(process.env.WEBRCADE_TEST_STATE).toString('base64'));
      await frame.waitForFunction(() => Module.wrcStateResult === 1 || Module.wrcStateResult === 0,
        null, { timeout: 60000 });
      assert.equal(await frame.evaluate(() => Module.wrcStateResult), 1, 'scene state loaded');
    };
    if (process.env.WEBRCADE_TEST_STATE) await loadScene();
    const start = await snapshot();
    await frame.waitForFunction((count) => Module._get_current_frame_count() > count + 120,
      start.frames, { timeout: 300000 });
    const settled = await snapshot();
    console.log('SETTLED', JSON.stringify(settled));
    assert.equal(settled.invalidUses, 0, 'no failed program is ever bound');
    assert.equal(settled.rejectedRelinks, 0, 'no rejected shader pair is submitted again');
    if (fail) {
      assert(settled.rejected > 0, 'fault injection reached real PICA vertex shaders');
      assert(settled.native.failed > 0, 'failed GPU draws reached CPU fallback');
      assert(settled.failures.length > 0, 'core captured driver link/compile failures');
      assert(settled.failures.some((failure) => failure.shaders.some((shader) => !shader.compiled)),
        'failure telemetry includes failed shader compilation');
    } else {
      assert.equal(settled.failures.length, 0, 'normal shaders link successfully');
      assert(settled.native.gpu > 0, 'normal draws retain GPU vertex processing');
      if (process.env.WEBRCADE_TEST_COLD_COMBINERS === '1') {
        assert.equal(settled.sharedEnabled, true);
        assert(settled.sharedStages > 0, 'driver received shared GLSL');
        assert(settled.hybrid?.families > 0, 'real draws compiled shared fragment shaders');
        assert(settled.hybrid.materials > settled.hybrid.families, 'distinct materials share a fragment shader');
      } else if (process.env.WEBRCADE_TEST_COLD_COMBINERS === '0') {
        assert.equal(settled.sharedEnabled, false);
        assert.equal(settled.sharedStages, 0, 'driver never receives a shared fragment shader');
        assert(settled.specializedStages > 0, 'driver received specialized material shaders');
      }
    }

    await frame.waitForFunction((count) => Module._get_current_frame_count() > count + 60,
      settled.frames, { timeout: 300000 });
    const continued = await snapshot();
    if (process.env.WEBRCADE_TEST_STATE) {
      function checkReuse(before, after) {
        assert.equal(after.rejectedRelinks, 0, 'rejected shader pairs stay rejected across restore');
        assert.equal(after.liveRelinks, before.liveRelinks, 'repeated draws reuse live linked programs');
        // The CPU fallback also promotes materials. Restore can discard one pending
        // promotion and retry that pair, so compare live and rejected pairs directly.
        if (!fail) {
          const promoted = (after.hybrid?.promotions || 0) - (before.hybrid?.promotions || 0);
          const pending = after.hybrid ? 1 : 0;
          assert(after.gameLinks - before.gameLinks <= promoted + pending,
            'repeated draws only submit new promotions');
        }
      }
      checkReuse(settled, continued);
      await loadScene();
      const reloaded = await snapshot();
      await frame.waitForFunction((count) => Module._get_current_frame_count() > count + 60,
        reloaded.frames, { timeout: 300000 });
      const afterReload = await snapshot();
      checkReuse(continued, afterReload);
      assert.equal(afterReload.invalidUses, 0);
    }
    await frame.evaluate(() => emulator.pause(true));
    const paused = await snapshot();
    await frame.waitForTimeout(250);
    assert.equal((await snapshot()).frames, paused.frames, 'pause still stops emulation');
    if (!process.env.WEBRCADE_TEST_CORE_DIR) {
      let length = 0;
      for (let attempt = 0; attempt < 5 && !length; attempt++) {
        const result = await frame.evaluate(() => {
          try { return { length: emulator.takeState(Module).length }; }
          catch (error) { return { busy: Module.wrcStateResult === 2, error: error.message }; }
        });
        if (result.length) { length = result.length; break; }
        assert(result.busy, result.error);
        // The game can have outstanding HLE work; only its explicit busy
        // response is retriable. Let real emulated frames reach a safe point.
        const count = (await snapshot()).frames;
        await frame.evaluate(() => emulator.pause(false));
        await frame.waitForFunction((count) => Module._get_current_frame_count() > count + 30,
          count, { timeout: 60000 });
        await frame.evaluate(() => emulator.pause(true));
      }
      assert(length > 1000000, 'real core returns an owned compressed snapshot');
      if (process.env.WEBRCADE_TEST_THUMBNAIL === '1') {
        const thumbnail = await frame.evaluate(async () => {
          const manager = emulator.getSaveManager();
          const original = manager.saveState;
          let captured = null;
          manager.saveState = async (prefix, slot, state, canvas, callback, shot, imageProps) => {
            // Persist through the real browser storage, without touching an account.
            captured = { shot, imageProps, stateBytes: state.length, slot };
            await emulator.getStorage().put('/test/3ds-thumbnail', captured);
          };
          try { await emulator.saveStateForSlot(9); }
          finally { manager.saveState = original; }
          const saved = await emulator.getStorage().get('/test/3ds-thumbnail');
          if (!saved?.shot) return { saved: false };
          const img = new Image();
          img.src = saved.shot;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
          const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
          const colors = new Set();
          for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
          return { saved: true, width: img.width, height: img.height, colors: colors.size,
            stateBytes: saved.stateBytes, paused: emulator.paused, shot: saved.shot };
        });
        assert(thumbnail.saved, 'save state metadata includes a persisted thumbnail');
        assert(thumbnail.width > 0 && thumbnail.height > 0 && Math.max(thumbnail.width, thumbnail.height) <= 320);
        assert(thumbnail.colors > 10, 'thumbnail contains the rendered game rather than an empty frame');
        assert(thumbnail.stateBytes > 1000000 && thumbnail.paused);
        fs.writeFileSync(path.join(output, 'save-thumbnail.png'), Buffer.from(thumbnail.shot.split(',')[1], 'base64'));
        console.log('PASS saved-state thumbnail', JSON.stringify({ ...thumbnail, shot: undefined }));
      }
    }
    if (fail && !process.env.WEBRCADE_TEST_CORE_DIR) {
      const reports = await frame.evaluate(async () => {
        await emulator.shaderFailures.flush();
        const bytes = await emulator.getStorage().get(`/wrc/3ds-shader-failures/${emulator.uid}`);
        const document = JSON.parse(new TextDecoder().decode(bytes));
        return document.reports.map((report) => ({
          core: report.core, title: report.title, device: report.device,
          sources: report.shaders.map((shader) => shader.source.length),
        }));
      });
      assert(reports.length > 0, 'compiler reports persist in local storage');
      assert(reports.every((report) => report.title && report.device.renderer &&
        report.sources.every((length) => length > 0)), 'stored reports include device and shader source');
    }
    const resumeCount = (await snapshot()).frames;
    await frame.evaluate(() => emulator.pause(false));
    await frame.waitForFunction((count) => Module._get_current_frame_count() > count + 5,
      resumeCount, { timeout: 60000 });
    await page.screenshot({ path: path.join(output, `${engine}-${synchronous ? 'sync' : 'background'}-${fail ? 'rejected' : 'normal'}.png`) });
    assert.deepEqual(errors, [], 'no page errors');
    console.log('PASS', engine, synchronous ? 'sync' : 'background', fail ? 'CPU fallback' : 'GPU path',
      JSON.stringify(await snapshot()));
  } finally {
    clearInterval(progress);
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
