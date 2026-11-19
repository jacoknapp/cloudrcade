const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname,
  '../deploy/webrcade/retro-azahar/app/src/emulator/draw-batch.js'));
const modulePromise = import('data:text/javascript;base64,' + source.toString('base64'));
const GL = {
  ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, ELEMENT_ARRAY_BUFFER_BINDING: 0x8895,
  VERTEX_ARRAY_BINDING: 0x85b5, PIXEL_UNPACK_BUFFER: 0x88ec, PIXEL_UNPACK_BUFFER_BINDING: 0x88ef,
  UNPACK_ALIGNMENT: 0x0cf5, UNPACK_ROW_LENGTH: 0x0cf2, UNPACK_SKIP_ROWS: 0x0cf3, UNPACK_SKIP_PIXELS: 0x0cf4,
  TEXTURE_2D: 0x0de1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, STREAM_DRAW: 0x88e0,
  INVALID_OPERATION: 0x0502, NO_ERROR: 0, TRIANGLES: 4, CURRENT_PROGRAM: 0x8b8d,
};

function bytes(view, offset = 0, count = 0) {
  const width = view.BYTES_PER_ELEMENT || 1;
  return new Uint8Array(view.buffer, view.byteOffset + offset * width,
    count ? count * width : view.byteLength - offset * width);
}

// Model the GL state that affects these commands. The log observes when the
// actual context receives a call and which bytes or objects it sees.
class FakeGL {
  canvas = new EventTarget();
  calls = [];
  unpack = new Map([[GL.UNPACK_ALIGNMENT, 4]]);
  vao = null;
  elements = new Map();
  program = null;
  error = GL.NO_ERROR;
  failClear = false;

  getParameter(name) {
    switch (name) {
      case GL.VERTEX_ARRAY_BINDING: return this.vao;
      case GL.ELEMENT_ARRAY_BUFFER_BINDING: return this.elements.get(this.vao) ?? null;
      case GL.PIXEL_UNPACK_BUFFER_BINDING: return null;
      case GL.CURRENT_PROGRAM: return this.program;
      default: return this.unpack.get(name) ?? 0;
    }
  }
  createVertexArray() { return {}; }
  bindVertexArray(vao) { this.vao = vao; }
  createBuffer() { return {target: null}; }
  isBuffer(buffer) { return buffer.target !== null; }
  bindBuffer(target, buffer) {
    if (buffer && buffer.target !== null && buffer.target !== target) {
      this.error = GL.INVALID_OPERATION;
      return;
    }
    if (buffer) buffer.target = target;
    if (target === GL.ELEMENT_ARRAY_BUFFER) this.elements.set(this.vao, buffer);
  }
  getError() {
    const result = this.error;
    this.error = GL.NO_ERROR;
    return result;
  }
  bufferData(target, view, usage, offset, count) {
    const payload = bytes(view, offset, count);
    this.calls.push(['bufferData', payload.length > 64 ? payload.length : [...payload]]);
  }
  bufferSubData(target, destination, view, offset, count) {
    this.calls.push(['bufferSubData', destination, [...bytes(view, offset, count)]]);
  }
  pixelStorei(name, value) { this.unpack.set(name, value); }
  texSubImage2D(target, level, x, y, width, height, format, type, view, offset) {
    assert.equal(format, GL.RGBA);
    assert.equal(type, GL.UNSIGNED_BYTE);
    const alignment = this.unpack.get(GL.UNPACK_ALIGNMENT);
    const rowLength = this.unpack.get(GL.UNPACK_ROW_LENGTH) || width;
    const stride = Math.ceil(rowLength * 4 / alignment) * alignment;
    const first = (this.unpack.get(GL.UNPACK_SKIP_ROWS) || 0) * stride +
      (this.unpack.get(GL.UNPACK_SKIP_PIXELS) || 0) * 4;
    const data = bytes(view, offset);
    assert.ok(first + (height - 1) * stride + width * 4 <= data.length);
    const pixels = [];
    for (let row = 0; row < height; row++) {
      const start = first + row * stride;
      pixels.push(...data.subarray(start, start + width * 4));
    }
    this.calls.push(['texSubImage2D', pixels]);
  }
  createProgram() { return {linked: false}; }
  linkProgram(program) { program.linked = true; }
  getProgramParameter(program) { return program.linked; }
  useProgram(program) { this.program = program; }
  uniform1i(program, value) { this.calls.push(['sampler', this.program, program, value]); }
  uniform4iv(program, view, offset = 0, length = 0) {
    this.calls.push(['uniform', this.program, program, [...view.subarray(offset, length ? offset + length : undefined)]]);
  }
  clear() {
    if (this.failClear) throw new Error('clear failed');
    this.calls.push(['clear']);
  }
  drawArrays(mode, first) { this.calls.push(['draw', first]); }
  readPixels(x, y, width, height, format, type, destination) {
    destination[0] = this.calls.filter(([name]) => name === 'draw').length;
  }
}
Object.assign(FakeGL.prototype, GL);

async function fixture() {
  const {createDrawBatch} = await modulePromise;
  return {gl: new FakeGL(), batch: createDrawBatch()};
}

function start(gl, batch, first = 0) {
  batch.begin(gl);
  gl.drawArrays(GL.TRIANGLES, first, 3);
}

test('copies Wasm upload ranges before mutable or detached views can change', async () => {
  const {gl, batch} = await fixture();
  const memory = new WebAssembly.Memory({initial: 1, maximum: 2});
  const input = new Uint16Array(memory.buffer, 12, 5);
  bytes(input).set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  start(gl, batch);
  gl.bufferData(GL.ARRAY_BUFFER, input, GL.STREAM_DRAW, 2, 2);
  gl.bufferSubData(GL.ARRAY_BUFFER, 17, input, 3, 0);
  assert.deepEqual(gl.calls, []);
  input.fill(0);
  memory.grow(1);
  assert.equal(input.byteLength, 0);
  batch.flush();
  assert.deepEqual(gl.calls, [['draw', 0], ['bufferData', [5, 6, 7, 8]], ['bufferSubData', 17, [7, 8, 9, 10]]]);
});

test('copies texture pixels using the queued unpack state and source offset', async () => {
  const {gl, batch} = await fixture();
  const input = Uint8Array.from({length: 49}, (_, index) => index);
  start(gl, batch);
  gl.pixelStorei(GL.UNPACK_ALIGNMENT, 8);
  gl.pixelStorei(GL.UNPACK_ROW_LENGTH, 3);
  gl.pixelStorei(GL.UNPACK_SKIP_ROWS, 1);
  gl.pixelStorei(GL.UNPACK_SKIP_PIXELS, 1);
  gl.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, 2, 2, GL.RGBA, GL.UNSIGNED_BYTE, input, 5);
  assert.deepEqual(gl.calls, []);
  input.fill(0);
  gl.pixelStorei(GL.UNPACK_ROW_LENGTH, 0);
  batch.flush();
  assert.deepEqual(gl.calls.at(-1), ['texSubImage2D', [25, 26, 27, 28, 29, 30, 31, 32, 41, 42, 43, 44, 45, 46, 47, 48]]);
  assert.equal(gl.getParameter(GL.UNPACK_ROW_LENGTH), 0);
});

test('allows independent linking while keeping program and sampler changes ordered', async () => {
  const {gl, batch} = await fixture();
  const first = gl.createProgram();
  gl.useProgram(first);
  start(gl, batch);
  gl.uniform1i(first, 3);
  const values = Int32Array.of(0, 1, 2, 3, 4, 5, 6, 7);
  gl.uniform4iv(first, values, 2, 4);
  const next = gl.createProgram();
  gl.linkProgram(next);
  assert.ok(gl.getProgramParameter(next));
  assert.deepEqual(gl.calls, []);
  values.fill(0);
  gl.useProgram(next);
  gl.uniform1i(next, 1);
  batch.flush();
  assert.deepEqual(gl.calls, [['draw', 0], ['sampler', first, first, 3],
    ['uniform', first, first, [2, 3, 4, 5]], ['sampler', next, next, 1]]);
});

test('flushes before synchronous queries and readback into caller memory', async () => {
  const {gl, batch} = await fixture();
  const program = gl.createProgram();
  start(gl, batch);
  gl.useProgram(program);
  assert.equal(gl.getParameter(GL.CURRENT_PROGRAM), program);
  assert.deepEqual(gl.calls, [['draw', 0]]);
  start(gl, batch, 1);
  const output = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, output);
  assert.equal(output[0], 2);
});

test('drains the queue at the command and byte limits in submission order', async () => {
  const {gl, batch} = await fixture();
  start(gl, batch);
  for (let index = 1; index < 1536; index++) gl.drawArrays(GL.TRIANGLES, index, 3);
  assert.deepEqual(gl.calls, []);
  gl.drawArrays(GL.TRIANGLES, 1536, 3);
  assert.equal(gl.calls.length, 1537);
  assert.deepEqual(gl.calls.map(([, index]) => index), Array.from({length: 1537}, (_, index) => index));

  gl.calls.length = 0;
  start(gl, batch);
  const sizes = [900000, 900001, 900002];
  for (const size of sizes.slice(0, 2)) gl.bufferData(GL.ARRAY_BUFFER, new Uint8Array(size), GL.STREAM_DRAW);
  assert.deepEqual(gl.calls, []);
  gl.bufferData(GL.ARRAY_BUFFER, new Uint8Array(sizes[2]), GL.STREAM_DRAW);
  assert.deepEqual(gl.calls, [['draw', 0], ...sizes.map(size => ['bufferData', size])]);
});

test('flushes once at turn end and keeps idle draws immediate', async () => {
  const {gl, batch} = await fixture();
  start(gl, batch);
  batch.flush();
  start(gl, batch, 1);
  assert.deepEqual(gl.calls, [['draw', 0]]);
  await Promise.resolve();
  assert.deepEqual(gl.calls, [['draw', 0], ['draw', 1]]);
  gl.drawArrays(GL.TRIANGLES, 2, 3);
  assert.deepEqual(gl.calls, [['draw', 0], ['draw', 1], ['draw', 2]]);
});

test('keeps element bindings per VAO and reports the real binding after a rejected bind', async () => {
  const {gl, batch} = await fixture();
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(GL.ARRAY_BUFFER, vertexBuffer);
  batch.begin(gl);
  const first = gl.createVertexArray();
  const second = gl.createVertexArray();
  const firstElement = gl.createBuffer();
  const secondElement = gl.createBuffer();
  gl.bindVertexArray(first);
  gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, firstElement);
  gl.bindVertexArray(second);
  gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, secondElement);
  gl.drawArrays(GL.TRIANGLES, 0, 3);
  gl.bindVertexArray(first);
  assert.equal(gl.getParameter(GL.ELEMENT_ARRAY_BUFFER_BINDING), firstElement);
  assert.deepEqual(gl.calls, []);
  gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, vertexBuffer);
  assert.equal(gl.getParameter(GL.ELEMENT_ARRAY_BUFFER_BINDING), firstElement);
  assert.equal(gl.getError(), GL.INVALID_OPERATION);
  assert.deepEqual(gl.calls, [['draw', 0]]);
});

test('a replay failure cannot leave stale unpack state for a later turn', async () => {
  const {gl, batch} = await fixture();
  gl.pixelStorei(GL.UNPACK_ALIGNMENT, 8);
  gl.pixelStorei(GL.UNPACK_ROW_LENGTH, 3);
  start(gl, batch);
  gl.failClear = true;
  gl.clear();
  gl.pixelStorei(GL.UNPACK_ALIGNMENT, 4);
  gl.pixelStorei(GL.UNPACK_ROW_LENGTH, 0);
  assert.throws(() => batch.flush(), /clear failed/);
  gl.failClear = false;
  start(gl, batch, 1);
  const input = Uint8Array.from({length: 24}, (_, index) => index);
  gl.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, 2, 2, GL.RGBA, GL.UNSIGNED_BYTE, input);
  batch.flush();
  assert.deepEqual(gl.calls, [['draw', 0], ['draw', 1],
    ['texSubImage2D', [0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23]]]);
});

test('context restoration cannot reuse the old VAO and its element buffer', async () => {
  const {gl, batch} = await fixture();
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  start(gl, batch);
  gl.canvas.dispatchEvent(new Event('webglcontextlost'));
  gl.vao = null;
  gl.elements.clear();
  gl.canvas.dispatchEvent(new Event('webglcontextrestored'));
  start(gl, batch, 1);
  assert.equal(gl.getParameter(GL.ELEMENT_ARRAY_BUFFER_BINDING), null);
  batch.flush();
  assert.deepEqual(gl.calls, [['draw', 1]]);
});
