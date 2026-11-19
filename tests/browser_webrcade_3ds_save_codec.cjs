// Run against a 3DS build's patched SDK sources. The browser sees only fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');

const common = path.join(process.env.WEBRCADE_BUILD_ROOT || '/tmp/retro-azahar-build', 'webrcade-app-common/src');
const worker = path.join(__dirname, '../deploy/webrcade/retro-azahar/app/public/save-codec-v1.js');
const fixture = 'https://save.test';

async function test(engine) {
  const browser = await engine.launch(engine === webkit ? { executablePath: process.env.WEBRCADE_TEST_WEBKIT_PATH } : {});
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== fixture) return route.abort();
      const name = url.pathname.slice(1);
      if (!name) return route.fulfill({ contentType: 'text/html', body: '<title>3DS save test</title>' });
      const stubs = {
        'storage/cloud/dropbox': 'export const dropbox = {};',
        'settings/settings': 'export const settings = {};',
        'storage/storage': 'export const storage = {};',
        resources: 'export const Resources = {}, TEXT_IDS = {};',
        log: 'export function info() {}',
        zip: 'export * from "/zip/index.js";',
        util: 'export { md5 } from "/util/md5.js"; export { blobToStr } from "/util/stringutil.js";',
      };
      const body = stubs[name] ?? fs.readFileSync(name === 'save-codec-v1.js' ? worker : path.join(common, name));
      return route.fulfill({ contentType: 'text/javascript', body });
    });
    await page.goto(fixture);
    const results = await page.evaluate(async () => {
      const { SaveManager } = await import('/app/saves.js');
      const { zip } = await import('/zip/3rdparty/zip.js');
      const manager = new SaveManager({ getTitle: () => 'Fixture' });
      const data = new Uint8Array(1048581);
      for (let i = 0; i < data.length; i++) data[i] = (i * 31 + (i >>> 13)) & 255;
      const payload = data.subarray(3, -2);
      const files = [{ name: 'sdmc/large', content: payload }, { name: 'empty', content: new Uint8Array() }];
      const NativeWorker = window.Worker;
      let nativeEntries = 0;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', event => { if (event.data.payload) nativeEntries++; });
        }
      };
      const archive = await manager.createZip(files);
      const read = async blob => {
        const decoded = await manager.getFiles(blob);
        const bytes = decoded.find(f => f.name === files[0].name).content;
        return bytes.length === payload.length && bytes.every((v, i) => v === payload[i]) &&
          decoded.find(f => f.name === 'empty').content.length === 0 &&
          JSON.parse(new TextDecoder().decode(decoded.find(f => f.name === 'info.txt').content)).title === 'Fixture';
      };
      const nativeRoundtrip = await read(archive);
      // Ask the original reader to verify the ZIP CRC written by the worker.
      await new Promise((resolve, reject) => zip.createReader(new zip.BlobReader(archive), reader => {
        reader.getEntries(entries => entries[0].getData(new zip.BlobWriter(), resolve, undefined, true));
      }, reject));
      window.Worker = undefined;
      const fallbackRead = await read(archive);
      const legacyArchive = await manager.createZip(files);
      window.Worker = NativeWorker;
      const legacyRead = await read(legacyArchive);
      const slot = await manager.createZip([{ name: 'state', content: payload }]);
      const slotHeader = new DataView(await slot.slice(0, 30).arrayBuffer());
      const slotBytes = (await manager.getFiles(slot)).find(f => f.name === 'state').content;
      const storedSlot = slotHeader.getUint16(8, true) === 0 &&
        slotBytes.length === payload.length && slotBytes.every((v, i) => v === payload[i]);
      const changed = async () => manager.checkFilesChanged(files);
      const changes = [await changed(), await changed()];
      files[0].content = new Blob([payload]);
      changes.push(await changed());
      payload[0] ^= 1; files[0].content = payload;
      changes.push(await changed()); files.pop(); changes.push(await changed());
      return { nativeRoundtrip, fallbackRead, legacyRead, nativeEntries, storedSlot, changes };
    });
    assert.deepEqual(results, {
      nativeRoundtrip: true, fallbackRead: true, legacyRead: true, nativeEntries: 2, storedSlot: true,
      changes: [true, false, false, true, true],
    });
    console.log('PASS', engine.name(), '3DS save ZIP native and legacy reads, CRC, offsets, metadata, digest changes');
  } finally {
    await browser.close();
  }
}

(async () => { for (const engine of [chromium, webkit]) await test(engine); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
