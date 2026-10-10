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
  const browser = await (engine === 'webkit' ? webkit : chromium).launch({
    headless: true,
    ...(engine === 'chromium' ? {
      ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    } : {}),
  });
  let progress;
  try {
    const context = await browser.newContext({ ...devices['iPhone 14 Pro'], serviceWorkers: 'block' });
    if (process.env.WEBRCADE_TEST_CORE_DIR) {
      await context.route('**/js/iphone-*/azahar_libretro.*', (route) => route.fulfill({
        path: path.join(process.env.WEBRCADE_TEST_CORE_DIR,
          new URL(route.request().url()).pathname.split('/').pop()),
        headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
      }));
    }
    await context.addInitScript(({ fail, synchronous }) => {
      const probe = window.shaderFailureProbe = { rejected: 0, invalidUses: 0, links: 0, gameLinks: 0 };
      const statuses = new WeakMap();
      const sources = new WeakMap();
      const proto = WebGL2RenderingContext.prototype;
      const { shaderSource, getProgramParameter, useProgram, linkProgram, getExtension } = proto;
      proto.shaderSource = function (shader, source) {
        sources.set(shader, source);
        // PICA-generated GPU vertex programs; the trivial CPU vertex shader is valid.
        if (fail && source.includes('void EmitVtx()') && source.includes('bool sub_')) {
          probe.rejected++;
          source += '\nwrc_force_vertex_compile_failure;\n';
        }
        return shaderSource.call(this, shader, source);
      };
      proto.getProgramParameter = function (program, name) {
        const result = getProgramParameter.call(this, program, name);
        if (name === this.LINK_STATUS) statuses.set(program, result);
        return result;
      };
      proto.useProgram = function (program) {
        if (program && statuses.get(program) === false) probe.invalidUses++;
        return useProgram.call(this, program);
      };
      proto.linkProgram = function (program) {
        probe.links++;
        if ((this.getAttachedShaders(program) || []).some((shader) =>
          sources.get(shader)?.includes('uniform fs_data'))) probe.gameLinks++;
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
    }));

    await frame.waitForFunction(() => window.Module?._get_current_frame_count?.() > 100,
      null, { timeout: 300000 });
    const yes = frame.getByText('Yes', { exact: true });
    if (await yes.count()) await yes.first().tap();
    const release = frame.locator('.release-screen-content');
    if (await release.isVisible()) await release.tap();
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
    if (fail) {
      assert(settled.rejected > 0, 'fault injection reached real PICA vertex shaders');
      assert(settled.native.failed > 0, 'failed GPU draws reached CPU fallback');
      assert(settled.failures.length > 0, 'core captured driver link/compile failures');
      assert(settled.failures.some((failure) => failure.shaders.some((shader) => !shader.compiled)),
        'failure telemetry includes failed shader compilation');
    } else {
      assert.equal(settled.failures.length, 0, 'normal shaders link successfully');
      assert(settled.native.gpu > 0, 'normal draws retain GPU vertex processing');
    }

    await frame.waitForFunction((count) => Module._get_current_frame_count() > count + 60,
      settled.frames, { timeout: 300000 });
    const continued = await snapshot();
    if (process.env.WEBRCADE_TEST_STATE) {
      assert.equal(continued.gameLinks, settled.gameLinks, 'failed pairs are not relinked every frame');
      await loadScene();
      const reloaded = await snapshot();
      await frame.waitForFunction((count) => Module._get_current_frame_count() > count + 60,
        reloaded.frames, { timeout: 300000 });
      const afterReload = await snapshot();
      assert.equal(afterReload.gameLinks, continued.gameLinks, 'state load preserves accepted and rejected pairs');
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
