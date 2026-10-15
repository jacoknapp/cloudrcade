// Exercise the real connection page's cross-origin form submission in both engines.
// Providers are intercepted; no accounts, app passwords or cloud files are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const root = path.join(__dirname, '../deploy/webrcade/touch/cloud');
const source = process.env.WEBRCADE_TEST_ORIGIN;
const origin = source || 'https://arcade.example.com';
const cloud = 'https://cloud.example.com';

(async () => {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({
      executablePath: engine === chromium ? process.env.CHROME : process.env.WEBRCADE_TEST_WEBKIT_PATH,
      args: engine === chromium ? ['--no-sandbox'] : [],
    });
    try {
      // The old policy is a negative control: an opaque origin cannot pass the
      // Nextcloud allowlist. Also test the packaged/live page without overlays.
      for (const negative of source ? [false] : [true, false]) {
        const context = await browser.newContext({ignoreHTTPSErrors: true, serviceWorkers: 'block'});
        try {
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          const config = {enabled: true, autoRedirect: true, accessAllowed: true,
            server: cloud, storagePrefix: 'login-origin-test', appName: 'Test Arcade', saveFolder: 'Saves'};
          if (!source) {
            await page.route(origin + '/cloud-saves/**', route => {
              const name = new URL(route.request().url()).pathname.split('/').pop() || 'index.html';
              if (name === 'index.html') {
                let body = fs.readFileSync(path.join(root, name), 'utf8');
                if (negative) body = body.replace(/<meta name="referrer" content="[^"]+">/, '<meta name="referrer" content="no-referrer">');
                return route.fulfill({contentType: 'text/html', body});
              }
              if (name === 'connect.js') return route.fulfill({contentType: 'text/javascript', body: fs.readFileSync(path.join(root, name), 'utf8')});
              return route.fulfill({contentType: 'text/javascript', body: ''});
            });
            await page.route(origin + '/touch-controls/**', route => route.fulfill({body: ''}));
          }
          await page.route(origin + '/cloud-saves/config.php', route => route.fulfill({contentType: 'text/javascript', body: 'window.WrcadCloudConfig=' + JSON.stringify(config)}));
          await page.route(origin + '/cloud-saves/api.php?*', route => route.fulfill({json:
            new URL(route.request().url()).searchParams.get('action') === 'status'
              ? {csrf: 'fixture-csrf', config}
              : {start: cloud + '/apps/retroarcade_login/start', flow: cloud + '/login/v2/flow/FixtureToken',
                login: cloud + '/manual', directLogin: cloud + '/direct'},
          }));
          await page.route(cloud + '/**', route => route.fulfill({contentType: 'text/html', body: '<p>Handoff received</p>'}));
          const submitted = page.waitForRequest(request => request.url() === cloud + '/apps/retroarcade_login/start');
          await page.goto(origin + '/cloud-saves/?connect=1&return=%2Fplay%2F%3Fprivate%3Dfixture');
          const request = await submitted;
          const headers = await request.allHeaders();
          assert.equal(request.method(), 'POST');
          assert.equal(new URLSearchParams(request.postData()).get('flow'), cloud + '/login/v2/flow/FixtureToken');
          assert.equal(headers.origin, negative ? 'null' : origin, 'handoff must preserve the allowlisted origin');
          if (negative) assert.equal(headers.referer, undefined);
          else assert.equal(headers.referer, origin + '/', 'only the origin may be disclosed, never paths or query parameters');
          assert.deepEqual(errors, []);
          console.log('PASS', engine.name(), negative ? 'old no-referrer reproduces rejected null origin' : 'real login page submits exact origin without URL details');
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
