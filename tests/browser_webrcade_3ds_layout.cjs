// Exercise the real shared controller in 3DS and DS pages across rotation/views.
// Requires Playwright. No accounts, ROMs, or saves.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
(async () => {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({ headless: true,
      ...(engine === chromium ? { executablePath: process.env.CHROME,
        args: ['--no-sandbox'] } : {executablePath: process.env.WEBRCADE_TEST_WEBKIT_PATH}),
    });
    try {
      for (const system of ['3ds', 'nds']) {
        const page = await browser.newPage({ viewport: { width: 402, height: 874 }, hasTouch: true });
        await page.route('http://controller.test/**', (route) => route.fulfill({
          contentType: 'text/html', body: '<html><head></head><body></body></html>',
        }));
        await page.goto('http://controller.test/play/app/retro-' + (system === '3ds' ? 'azahar' : 'melonds') + '/');
        await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname,
          '../deploy/webrcade/touch/assets/controller.css'), 'utf8') });
        // Desktop engines do not expose an iPhone's notch/home-indicator insets.
        // Supply those bounds in this fixture, leaving the real layout code intact.
        await page.addStyleTag({content: `
          html, body { margin: 0; background: black; }
          canvas { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); }
          .kt-ds-origin, .kt-3ds-origin { top: var(--test-top, 59px); bottom: 34px; }
          #wrcad-touch .kt-pad { bottom: 34px; }
        `});
        await page.evaluate((system) => {
          const canvas = document.createElement('canvas');
          canvas.width = 1200; canvas.height = 1440;
          canvas.style.position = 'fixed'; document.body.appendChild(canvas);
          localStorage.setItem('webrcade.touch.layouts.v1', JSON.stringify({
            [`${system}:portrait`]: {'button-8': [.3, .12]},
          }));
          const controller = { isControlDown: () => false, isPadButtonDown: () => false,
            getAxisValue: () => 0, isAxisLeft: () => false, isAxisRight: () => false,
            isAxisUp: () => false, isAxisDown: () => false };
          const emulator = {
            started: true, paused: false, canvas, view: 0, bookMode: false,
            controllers: { getController: () => controller },
            getViews: () => [[0, 'Vertical'], [1, 'Side by side'], [2, 'Top screen']],
            getView() { return this.view; }, setView(value) { this.view = value; this.updateScreenSize(); },
            getScreenLayout() { return this.view; },
            getPrefs() { return { getScreenLayout: () => this.view, setScreenLayout: (v) => this.view = v }; },
            resetToggleLayout() {}, setBookMode(v) { this.bookMode = v; },
            updateScreenLayout() { this.updateScreenSize(); },
            getDefaultAspectRatio() {
              if (system === 'nds') return [0, 1].includes(this.view) ? 256 / 384 : 512 / 192;
              return [400 / 480, 720 / 240, 400 / 240][this.view];
            },
            updateScreenSize() {
              const ratio = this.getDefaultAspectRatio();
              const width = Math.min(innerWidth * .96, innerHeight * .96 * ratio);
              canvas.style.width = `${width}px`; canvas.style.height = `${width / ratio}px`;
              canvas.style.maxWidth = '96vw'; canvas.style.maxHeight = '96vh';
            },
            pause(value) { this.paused = value; return true; },
          };
          window.app = { isShowOverlay: () => false, isPauseScreen: () => false, emulator };
        }, system);
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname,
          '../deploy/webrcade/touch/assets/controller.js'), 'utf8') });
        await page.waitForTimeout(300);
        for (const view of system === '3ds' ? [0, 1, 2] : [0, 2]) {
          await page.evaluate((view) => app.emulator.setView(view), view);
          for (const viewport of [{ width: 874, height: 402 }, { width: 402, height: 874 },
            {width: 393, height: 852}, {width: 320, height: 568}, {width: 768, height: 1024}]) {
            await page.setViewportSize(viewport);
            await page.evaluate(() => document.documentElement.style.setProperty('--test-top',
              innerWidth > innerHeight ? '0px' : '59px'));
            await page.waitForTimeout(200);
            await page.evaluate(() => app.emulator.updateScreenSize());
            const size = await page.evaluate(() => ({
              width: parseFloat(app.emulator.canvas.style.width),
              height: parseFloat(app.emulator.canvas.style.height),
              ratio: app.emulator.getDefaultAspectRatio(),
            }));
            assert(size.width > 0 && size.height > 0, `${system} dimensions retained`);
            assert(Math.abs(size.width / size.height - size.ratio) < .001,
              `${system} view ${view} keeps aspect ratio after rotation`);
            assert.deepEqual(await page.evaluate(() => [app.emulator.canvas.width, app.emulator.canvas.height]),
              [1200, 1440], 'CSS placement must not resize the core drawing buffer');
            if (viewport.width <= viewport.height && (system === '3ds' || view === 0)) {
              const canvas = await page.locator('canvas').boundingBox();
              assert(canvas.y >= 59 - .5, `${system} view ${view} ${viewport.width}x${viewport.height}: game stays below the status-bar safe area (${JSON.stringify(canvas)})`);
              for (const control of await page.locator('.kt-pad button, .kt-pad .kt-stick').all()) {
                const r = await control.boundingBox();
                if (!r) continue;
                assert(canvas.y + canvas.height + 10 <= r.y + .5,
                  `${system} ${viewport.width}x${viewport.height}: game clears every controller touch target`);
                assert(r.y + r.height <= viewport.height - 34 + .5,
                  'controls stay above the home indicator, including restored positions');
              }
            }
          }
        }
        await page.setViewportSize({width: 393, height: 852});
        await page.evaluate(() => {document.documentElement.style.setProperty('--test-top', '59px'); app.emulator.setView(0);});
        await page.waitForTimeout(200);
        const withControls = await page.locator('canvas').boundingBox();
        await page.locator('.kt-tab').tap();
        assert.deepEqual(await page.locator('canvas').boundingBox(), withControls,
          'opening the controller drawer must not shift the game screens');
        await page.locator('.kt-toggle').tap();
        await page.locator('.kt-close').tap();
        const withoutControls = await page.locator('canvas').boundingBox();
        assert(withoutControls.height > withControls.height, 'controls off restores display space');
        await page.locator('.kt-tab').tap();
        await page.locator('.kt-toggle').tap();
        await page.locator('.kt-close').tap();
        assert.deepEqual(await page.locator('canvas').boundingBox(), withControls,
          'reenabling controls restores the separate screen/control areas');
        await page.locator('.kt-tab').tap();
        await page.locator('.kt-edit').tap();
        await page.waitForTimeout(200);
        const shoulder = page.locator('.kt-pad [data-cid="8"]');
        const beforeDrag = await shoulder.boundingBox();
        await page.mouse.move(beforeDrag.x + beforeDrag.width / 2, beforeDrag.y + beforeDrag.height / 2);
        await page.mouse.down(); await page.mouse.move(120, 90); await page.mouse.up();
        const dragged = await shoulder.boundingBox(), editingCanvas = await page.locator('canvas').boundingBox();
        assert(dragged.y >= (await page.locator('.kt-pad').boundingBox()).y - .5,
          'editing cannot drag a portrait button over the game');
        assert(editingCanvas.y + editingCanvas.height + 10 <= dragged.y + .5,
          'editing keeps game screens clear of controller touch targets');
        await page.locator('.kt-cancel').tap();
        await page.waitForTimeout(200);
        assert.deepEqual(await page.locator('canvas').boundingBox(), withControls,
          'cancel restores the prior screen/control layout');
        await page.close();
        console.log('PASS', engine.name(), system, 'screen/control separation, safe areas, restored layouts, views, rotation, controls off/on and drawing-buffer ownership');
      }
    } finally { await browser.close(); }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
