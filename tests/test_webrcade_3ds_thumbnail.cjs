// Capture only on demand after a rendered frame; preserve pause and save metadata.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
(async () => {
  const source = fs.readFileSync(path.join(__dirname,
    '../deploy/webrcade/retro-azahar/app/src/emulator/index.js'), 'utf8');
  const names = ['saveStateForSlot', 'captureStateScreenshot', 'captureStateFrame'];
  const methods = names.map(name => source.match(new RegExp(
    '  (?:async )?' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}'))[0]);
  let frame = 5, copies = 0, transparent = false, timer, writes = [];
  const toggles = [];
  const Module = { _get_current_frame_count: () => frame,
    _toggleMainLoop: value => toggles.push(value), _cmd_save_state: () => {},
    FS: { readFile: () => new Uint8Array([1, 2, 3]) } };
  const context = { drawImage: () => copies++, getImageData: () => ({
    data: new Uint8ClampedArray([50, 80, 90, transparent ? 0 : 255]),
  }) };
  const Wrapper = vm.runInNewContext('(class { ' + methods.join('\n') + ' })', {
    window: { Module }, document: { createElement: () => ({
      getContext: () => context, toDataURL: () => 'data:image/png;base64,fixture',
    }) }, setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => { timer = null; },
    STATE_PATH: '/state', LOG: { error: () => {} },
  });
  const emulator = new Wrapper();
  Object.assign(emulator, { canvas: { width: 400, height: 480 }, paused: true,
    crumb: () => {}, releaseStateFile: () => {}, updateSaveStateForSlotProps: () => {},
    getSaveManager: () => ({ saveState: async (...args) => writes.push(args) }) });
  emulator.captureStateFrame();
  assert.equal(copies, 0, 'ordinary frames have no screenshot readback');
  const capture = emulator.captureStateScreenshot(Module);
  assert.equal(emulator.captureStateScreenshot(Module), capture, 'only one pending capture');
  emulator.captureStateFrame();
  assert.equal(copies, 0, 'wait for a fresh frame');
  frame++; transparent = true; emulator.captureStateFrame();
  assert(emulator.pendingStateShot, 'discarded transparent frame is retried');
  transparent = false; frame++; emulator.captureStateFrame();
  assert.equal(await capture, 'data:image/png;base64,fixture');
  assert.equal(toggles.at(-1), 0, 'game remains paused after capture');
  const saving = emulator.saveStateForSlot(3);
  frame++; emulator.captureStateFrame(); await saving;
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1], 3);
  assert.equal(writes[0][3], null);
  assert.equal(writes[0][5], 'data:image/png;base64,fixture', 'thumbnail travels with saved state');
  const timedOut = emulator.captureStateScreenshot(Module);
  timer(); assert.equal(await timedOut, null);
  assert.equal(toggles.at(-1), 0);
  assert.equal(emulator.pendingStateShot, null);
  console.log('PASS thumbnail capture, discarded-frame retry, metadata, timeout and pause restoration');
})().catch(error => { console.error(error); process.exitCode = 1; });
