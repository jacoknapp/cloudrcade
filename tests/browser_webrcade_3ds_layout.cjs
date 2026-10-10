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
        args: ['--no-sandbox'] } : {}),
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
        await page.evaluate((system) => {
          const canvas = document.createElement('canvas');
          canvas.style.position = 'fixed'; document.body.appendChild(canvas);
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
          for (const viewport of [{ width: 874, height: 402 }, { width: 402, height: 874 }]) {
            await page.setViewportSize(viewport);
            await page.evaluate(() => app.emulator.updateScreenSize());
            const size = await page.evaluate(() => ({
              width: parseFloat(app.emulator.canvas.style.width),
              height: parseFloat(app.emulator.canvas.style.height),
              ratio: app.emulator.getDefaultAspectRatio(),
            }));
            assert(size.width > 0 && size.height > 0, `${system} dimensions retained`);
            assert(Math.abs(size.width / size.height - size.ratio) < .001,
              `${system} view ${view} keeps aspect ratio after rotation`);
          }
        }
        await page.close();
        console.log('PASS', engine.name(), system, 'screen sizing across views and rotation');
      }
    } finally { await browser.close(); }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
