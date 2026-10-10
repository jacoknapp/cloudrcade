// Exercise the real wrapper method: failed uploads must retry unchanged caches.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
(async () => {
  const root = path.join(__dirname, '../deploy/webrcade/retro-azahar/app/src/emulator');
  const code = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const method = code.match(/  async storeShaderCache\(\) \{[\s\S]*?\n  \}/)[0];
  const { quietCloudManager } = await import('data:text/javascript;base64,' +
    Buffer.from(fs.readFileSync(path.join(root, 'shaderfailures.js'), 'utf8')).toString('base64'));
  let attempts = 0, puts = 0, callbacks = 0;
  const manager = {
    errorCallback: () => callbacks++,
    isCloudEnabled: async () => true,
    async saveCloud() {
      attempts++;
      // Ordinary game-save error reporting must remain active during uploads.
      manager.errorCallback('ordinary save error');
      if (this.errorCallback) this.errorCallback('background error');
      if (attempts === 1) throw Error('offline');
    },
  };
  let size = 27;
  const Wrapper = vm.runInNewContext('(class { ' + method + ' })', {
    window: { FS: { stat: () => ({ size }), readFile: () => new Uint8Array(size) } },
    SHADER_CACHE_PATH: '/cache', SHADER_CACHE_NAME: 'programs.bin',
    quietCloudManager, mergeShaderCaches: (mine) => mine,
  });
  const emulator = Object.assign(new Wrapper(), {
    getSaveManager: () => manager,
    getStorage: () => ({ put: async () => puts++ }),
    shaderCacheKey: () => 'local', sharedShaderCachePath: () => 'cloud',
    loadSharedShaderCache: async () => null,
  });
  await emulator.storeShaderCache();
  assert.equal(puts, 1, 'local cache persisted before failed cloud save');
  assert.equal(emulator.shaderCloudSize, undefined, 'failure never marks cloud clean');
  await emulator.storeShaderCache();
  assert.equal(attempts, 2, 'unchanged cache retries cloud upload');
  assert.equal(puts, 1, 'retry avoids redundant local writes');
  assert.equal(emulator.shaderCloudSize, size);
  await emulator.storeShaderCache();
  assert.equal(attempts, 2, 'successful unchanged copy does not upload again');
  size++;
  await emulator.storeShaderCache();
  assert.equal(attempts, 3, 'grown cache uploads');
  assert.equal(callbacks, 3, 'only ordinary save errors invoke shared callback');
  console.log('PASS shader cache offline retry, local-first persistence, concurrent error reporting');
})().catch((error) => { console.error(error); process.exitCode = 1; });
