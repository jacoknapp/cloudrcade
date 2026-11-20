// Empty extdata directories are meaningful to games even when the zip contains no files there.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../deploy/webrcade/retro-azahar/app/src/emulator/index.js'), 'utf8');
const constants = source.slice(source.indexOf('const SAVE_ROOTS'), source.indexOf('// RetroAppWrapper input'));
const methods = ['mkdirs', 'collectFiles', 'restoreSaveFiles', 'async saveState'].map(name => {
  return source.match(new RegExp('  ' + name + '\\([^]*?\\n  \\}'))[0];
});
const root = fs.mkdtempSync(path.join(os.tmpdir(), '3ds-save-'));
const FS = {
  readdir: fs.readdirSync, mkdir: fs.mkdirSync, readFile: fs.readFileSync, writeFile: fs.writeFileSync,
  stat: fs.statSync, isDir: mode => (mode & fs.constants.S_IFMT) === fs.constants.S_IFDIR,
};
function createEmulator(dir) {
  const Emulator = vm.runInNewContext(constants + '\n(class {\n' + methods.join('\n') + '\n})', {
    window: { FS }, USER_DIR: dir, TextDecoder, TextEncoder, LOG: { error: console.error },
  });
  return new Emulator();
}

(async () => {
  const first = path.join(root, 'first'), second = path.join(root, 'second');
  const prefix = 'sdmc/Nintendo 3DS/' + '0'.repeat(32) + '/' + 'a'.repeat(32) + '/extdata/00000000/';
  const userDir = prefix + '00001B50/user', otherDir = prefix + '00001B51/user';
  const index = dir => ({ name: dir + '/filelist.txt', content: Buffer.alloc(0) });
  const main = { name: 'sdmc/title/game/main', content: Buffer.from([0, 12, 255, 5]) };
  const entries = [main, index(userDir), index(otherDir)];
  const folders = ['btvideo', 'dummy2', 'dummy3', 'finder_studio', 'reg'];
  const manifestName = 'azahar-directories-v1.json';
  const manifest = value => ({ name: manifestName, content: Buffer.from(JSON.stringify(value)) });
  const a = createEmulator(first);
  a.restoreSaveFiles(FS, entries);
  assert.deepEqual(fs.readdirSync(path.join(first, userDir)).sort(), [...folders, 'filelist.txt'].sort());
  assert.deepEqual(fs.readdirSync(path.join(first, otherDir)), ['filelist.txt']);
  fs.mkdirSync(path.join(first, 'nand/folder/child'), { recursive: true });
  fs.mkdirSync(path.join(first, 'shaders'));

  let archive;
  Object.assign(a, {
    started: true, saveStatePath: 'sav', saveQueue: Promise.resolve(),
    storeShaderCache() {}, shaderFailures: { async flush() {} },
    getSaveManager: () => ({ checkFilesChanged: async () => true, async save(_, entries) { archive = entries; return true; } }),
  });
  await a.saveState();
  const saved = JSON.parse(new TextDecoder().decode(archive.find(e => e.name === manifestName).content));
  assert.deepEqual(saved, ['nand/folder/child', ...folders.map(name => userDir + '/' + name)].sort());

  const b = createEmulator(second);
  b.restoreSaveFiles(FS, archive);
  assert.deepEqual(fs.readFileSync(path.join(second, main.name)), main.content);
  for (const dir of saved) assert.ok(fs.statSync(path.join(second, dir)).isDirectory());

  const explicit = path.join(root, 'explicit');
  createEmulator(explicit).restoreSaveFiles(FS, [...entries, manifest([42, 'nand/../../escape', 'sysdata/new', 'nand/legit'])]);
  assert.deepEqual(fs.readdirSync(path.join(explicit, userDir)), ['filelist.txt']);
  assert.ok(fs.existsSync(path.join(explicit, 'nand/legit')));
  assert.ok(!fs.existsSync(path.join(root, 'escape')));
  assert.ok(!fs.existsSync(path.join(explicit, 'sysdata')));
  const damaged = path.join(root, 'damaged');
  createEmulator(damaged).restoreSaveFiles(FS, [...entries, { name: manifestName, content: Buffer.from('{') }]);
  assert.deepEqual(fs.readFileSync(path.join(damaged, main.name)), main.content);
  assert.ok(fs.statSync(path.join(damaged, userDir, 'reg')).isDirectory());
  console.log('PASS 3DS empty save directory round trip and legacy extdata recovery');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
