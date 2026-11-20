// Run against the patched RetroArch library used by the 3DS build.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const file = process.argv[2] || path.join(process.env.WEBRCADE_BUILD_ROOT || '',
  'RetroArch/emscripten/library_platform_emscripten.js');
const source = fs.readFileSync(file, 'utf8');
const canvas = {width: 300, height: 150, clientWidth: 0, clientHeight: 0};
const sizes = [];
let notify;
const sandbox = {
  Module: {canvas}, RPE: {}, window: {devicePixelRatio: 3, addEventListener() {}},
  ResizeObserver: class {constructor(fn) { notify = fn; } observe() {}},
  PlatformEmscriptenOnWindowResize() {},
  _platform_emscripten_update_canvas_dimensions_cb(width, height) {
    sizes.push([width, height]);
    Object.assign(canvas, {width, height});
  },
};

function libraryFunction(name, next) {
  const start = source.indexOf(name + ': function(');
  const end = source.indexOf(next, start);
  assert(start >= 0 && end > start);
  const fn = source.slice(start + name.length + 2, end).trim().replace(/,$/, '');
  return vm.runInNewContext('(' + fn.replace(/\{\{\{[^]*?\}\}\}/g, '0') + ')', sandbox);
}

libraryFunction('PlatformEmscriptenWatchCanvasSizeAndDpr', '$PlatformEmscriptenOnCanvasPointerDown')(0);
function measure(width, height, pixels) {
  notify([{target:canvas, contentRect:{width, height}, devicePixelContentBoxSize:pixels}]);
}
measure(0, 0, []);
assert.deepEqual(sizes, []);
measure(669, 867, [{inlineSize:0, blockSize:0}]);
assert.deepEqual(sizes, [[2007,2601]]);
canvas.clientWidth = 669;
canvas.clientHeight = 867;
measure(0, 0, []);
assert.equal(sizes.length, 1);
measure(669, 867);
measure(669, 867, []);
measure(0, 0, []);
assert.equal(sizes.length, 1);
measure(951, 585, [{inlineSize:2854, blockSize:1756}]);
assert.deepEqual(sizes.at(-1), [2854,1756]);
canvas.width = 1;
measure(951, 585, [{inlineSize:2854, blockSize:1756}]);
assert.equal(sizes.length, 3);
assert.equal(canvas.width, 2854);
console.log('PASS native 3DS canvas sizing, hidden frames, repeated observations, and rotation');
