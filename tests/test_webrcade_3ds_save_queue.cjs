// A newer pause/exit snapshot must follow the current write, including retries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../deploy/webrcade/retro-azahar/app/src/emulator/index.js'), 'utf8');
  const method = source.match(/  async saveState\(\) \{[\s\S]*?\n  \}/)[0];
  const Emulator = vm.runInNewContext('(class { ' + method + ' })', {
    window: { FS: {} }, SAVE_ROOTS: ['sdmc'], USER_DIR: '/save', LOG: { error() {} },
  });
  let value = 1, seen, releaseFirst;
  const busy = new Promise(resolve => { releaseFirst = resolve; });
  const writes = [];
  const manager = {
    async checkFilesChanged(files) {
      const next = files[0].content[0], changed = next !== seen;
      seen = next; return changed;
    },
    async save(path, files) {
      const n = writes.push(files[0].content[0]);
      if (n === 1) { await busy; throw Error('Transient storage error'); }
      if (n === 2) return false;
      return true;
    },
  };
  const emulator = Object.assign(new Emulator(), {
    started: true, saveStatePath: 'sav', saveQueue: Promise.resolve(),
    storeShaderCache() {}, shaderFailures: { async flush() {} },
    getSaveManager: () => manager,
    collectFiles(fs, dir, prefix, out) { out.push({ name: 'sdmc/main', content: Uint8Array.of(value) }); },
  });
  const first = emulator.saveState(), retry = emulator.saveState();
  value = 2;
  const exit = emulator.saveState();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [1]);
  releaseFirst();
  await Promise.all([first, retry, exit]);
  assert.deepEqual(writes, [1, 1, 2]);
  await emulator.saveState();
  assert.deepEqual(writes, [1, 1, 2], 'acknowledged unchanged data stays clean');
  value = 3;
  manager.save = async () => { writes.push(3); return false; };
  await emulator.saveState();
  manager.save = async () => { writes.push(3); return true; };
  await emulator.saveState(); await emulator.saveState();
  assert.deepEqual(writes, [1, 1, 2, 3, 3], 'a pending upload retries once on unchanged data');
  console.log('PASS ordered 3DS pause/exit snapshots and failed-write retries');
})().catch(error => { console.error(error); process.exitCode = 1; });
