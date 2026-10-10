// Persistent compiler reports: offline retry, deduplication, bounded retention,
// cloud merge and isolation from real game-save errors.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const source = fs.readFileSync(path.join(__dirname,
    '../deploy/webrcade/retro-azahar/app/src/emulator/shaderfailures.js'), 'utf8');
  const { ShaderFailureTracker, decodeFailureReports, mergeFailureReports, quietCloudManager } =
    await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  globalThis.crypto ||= require('node:crypto').webcrypto;
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'test-device' }, configurable: true });
  const storage = new Map();
  let cloud = null, uploads = 0, failUpload = true;
  let gameErrors = 0;
  const manager = {
    errorCallback: () => gameErrors++,
    isCloudEnabled: async () => true,
    loadCloud: async () => {
      if (!cloud) throw Error('missing');
      return [{ name: 'shader-failures.json', content: cloud }];
    },
    async saveCloud(name, files) {
      assert.equal(name, '/game/shader-failures');
      uploads++;
      if (failUpload) {
        if (this.errorCallback) this.errorCallback('failed');
        throw Error('offline');
      }
      cloud = files[0].content;
    },
  };
  const emulator = {
    uid: 'game-one', saveStatePrefix: '/game/', getTitle: () => 'Test Game',
    getStorage: () => ({ get: async (key) => storage.get(key), put: async (key, bytes) => storage.set(key, bytes) }),
    getSaveManager: () => manager,
  };
  const module = { ctx: {
    VENDOR: 1, RENDERER: 2, getExtension: () => null,
    getParameter: (parameter) => parameter === 1 ? 'vendor' : 'GPU',
  } };
  const failure = { log: 'link failed', shaders: [{
    type: 35633, compiled: false, log: 'line 17: compiler error', source: 'exact shader source\né',
  }] };
  const tracker = new ShaderFailureTracker(emulator, 'v18');
  await tracker.restore();
  tracker.capture(failure, module);
  clearTimeout(tracker.timer); tracker.timer = null;
  await assert.rejects(tracker.flush(), /offline/);
  const local = decodeFailureReports(storage.get('/wrc/3ds-shader-failures/game-one'));
  assert.equal(local.reports[0].shaders[0].source, failure.shaders[0].source);
  assert.equal(local.reports[0].device.renderer, 'GPU');
  assert.equal(local.reports[0].core, 'v18');
  assert.equal(gameErrors, 0, 'diagnostic failure does not report a game-save failure');
  const originalCallback = manager.errorCallback;
  const quiet = quietCloudManager(manager);
  assert.equal(quiet.errorCallback, null);
  assert.equal(manager.errorCallback, originalCallback, 'shared callback is never changed');
  manager.errorCallback();
  assert.equal(gameErrors, 1, 'overlapping real game-save errors remain visible');

  failUpload = false;
  await tracker.flush();
  assert.equal(uploads, 2, 'unchanged local report retries after offline upload');
  await tracker.flush();
  assert.equal(uploads, 2, 'successfully synced report is not uploaded again');
  const next = new ShaderFailureTracker(emulator, 'v18');
  await next.restore();
  next.capture(failure, module);
  clearTimeout(next.timer); next.timer = null;
  await next.flush();
  const merged = decodeFailureReports(cloud);
  assert.equal(merged.reports.length, 1, 'same shader/device/core failure deduplicates across sessions');
  assert.equal(merged.reports[0].sessions.length, 2);
  assert.equal(merged.reports[0].sessions.reduce((sum, session) => sum + session.count, 0), 2);
  assert.deepEqual(mergeFailureReports(merged, merged), merged, 'repeated cloud merge does not double-count');
  assert.equal(mergeFailureReports(merged, { schema: 1, game: 'another-game', reports: [] }), merged);
  assert.equal(decodeFailureReports(new Uint8Array([0, 1])), null);
  const many = { schema: 1, game: 'game-one', reports: Array.from({ length: 40 }, (_, i) => ({
    id: String(i), first: i, last: i, sessions: [], source: 'x'.repeat(100000),
  })) };
  const bounded = mergeFailureReports({ schema: 1, game: 'game-one', reports: [] }, many);
  assert(bounded.reports.length <= 32);
  assert(Buffer.byteLength(JSON.stringify(bounded)) <= 2 * 1024 * 1024);
  assert.equal(bounded.reports[0].id, '39', 'newest reports are retained');
  await tracker.close(); await next.close();
  console.log('PASS persistent shader failure reports, offline retry, cloud merge, deduplication, bounded retention, error isolation');
})().catch((error) => { console.error(error); process.exitCode = 1; });
