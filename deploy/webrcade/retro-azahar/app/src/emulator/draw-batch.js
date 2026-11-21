// First use of a driver pipeline can hold up a synchronous query for the next
// shader. Submit independent shader work immediately and keep rendering commands
// in their original order until the end of the current emulation turn.
const MAX_CALLS = 1536;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_FRAME_CALLS = 4096;
const UNIFORM_BYTES = 1024 * 1024;
const states = new Set((
  'activeTexture bindBuffer bindFramebuffer bindSampler bindTexture bindVertexArray ' +
  'blendColor blendEquation blendFunc blendFuncSeparate clear clearBufferfi clearColor ' +
  'colorMask cullFace depthFunc depthMask disable disableVertexAttribArray drawArrays ' +
  'drawElements enable enableVertexAttribArray framebufferTexture2D pixelStorei readBuffer ' +
  'samplerParameterf samplerParameteri scissor stencilFunc stencilMask stencilOp ' +
  'texParameteri texStorage2D uniform1i uniform4f uniformBlockBinding useProgram ' +
  'vertexAttrib4f vertexAttribPointer viewport blitFramebuffer'
).split(' '));
const allocations = new Set((
  'createBuffer createFramebuffer createProgram createSampler createShader createTexture createVertexArray'
).split(' '));
const shaderQueries = new Set((
  'getActiveAttrib getActiveUniform getAttachedShaders getAttribLocation getProgramInfoLog ' +
  'getProgramParameter getShaderInfoLog getShaderParameter getShaderSource getUniformBlockIndex getUniformLocation'
).split(' '));
const shaderWrites = new Set((
  'attachShader bindAttribLocation compileShader detachShader linkProgram shaderSource transformFeedbackVaryings'
).split(' '));
const track = new Set(['bindBuffer','bindVertexArray','createVertexArray','deleteBuffer','deleteVertexArray','pixelStorei']);
const integral = value => Number.isSafeInteger(value) && value >= 0;

// WebGL2 source offsets and lengths are expressed in elements of the supplied
// view. Emscripten often passes its entire Wasm heap for a much smaller upload.
function snapshot(args, at, offsetAt, lengthAt, available, fixedLength) {
  const view = args[at];
  if (!ArrayBuffer.isView(view) || !view.BYTES_PER_ELEMENT) return -1;
  const start = args[offsetAt] === undefined ? 0 : args[offsetAt];
  const supplied = lengthAt === null ? 0 : args[lengthAt];
  const length = fixedLength === undefined ? (supplied || view.length - start) : fixedLength;
  if (!integral(start) || !integral(length) || start + length > view.length ||
      length * view.BYTES_PER_ELEMENT > available) return -1;
  const copy = view.slice(start, start + length);
  args[at] = copy;
  if (args.length > offsetAt) args[offsetAt] = 0;
  return copy.byteLength;
}

function uploadSize(gl, state, name, args, available) {
  switch (name) {
    case 'bufferData':
      if (typeof args[1] === 'number') return 0;
      return snapshot(args, 1, 3, 4, available);
    case 'bufferSubData': return snapshot(args, 2, 3, 4, available);
    case 'uniform4iv': return snapshot(args, 1, 2, 3, available);
    case 'uniformMatrix3x2fv': return snapshot(args, 2, 3, 4, available);
    case 'clearBufferfv': {
      const n = args[0] === gl.COLOR ? 4 : args[0] === gl.DEPTH ? 1 : 0;
      return n ? snapshot(args, 2, 3, null, available, n) : -1;
    }
    case 'drawBuffers':
      if (!Array.isArray(args[0]) || args[0].length > 16) return -1;
      args[0] = args[0].slice();
      return 0;
    case 'texSubImage2D': {
      if (args.length < 9 || state.pbo || !ArrayBuffer.isView(args[8])) return -1;
      const [, , , , width, height, format, type, view] = args;
      let pixelBytes;
      if (format === gl.RGBA && type === gl.UNSIGNED_BYTE) pixelBytes = 4;
      else if (format === gl.RGB && type === gl.UNSIGNED_SHORT_5_6_5) pixelBytes = 2;
      else if (format === gl.RG && type === gl.FLOAT) pixelBytes = 8;
      else return -1;
      const {row, skipRows, skipPixels, alignment} = state;
      if (!integral(width) || !width || !integral(height) || !height || !integral(row) ||
          !integral(skipRows) || !integral(skipPixels) || (row || width) < width + skipPixels ||
          ![1, 2, 4, 8].includes(alignment)) return -1;
      const stride = Math.ceil((row || width) * pixelBytes / alignment) * alignment;
      const bytes = (skipRows + height - 1) * stride + (skipPixels + width) * pixelBytes;
      return snapshot(args, 8, 9, null, available, bytes / view.BYTES_PER_ELEMENT);
    }
    default: return -1;
  }
}

// Only Azahar's dedicated uniform buffers enter this path. Other uploads use
// the ordinary command queue and remain visible to the original WebGL object.
function uniformUploads(gl, methods) {
  const rawBind = methods.get('bindBuffer');
  const rawData = methods.get('bufferData');
  const rawBase = methods.get('bindBufferBase');
  const rawRange = methods.get('bindBufferRange');
  if (!rawBind || !rawData || !rawBase || !rawRange) return null;
  const alignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT);
  if (!integral(alignment) || !alignment || alignment > UNIFORM_BYTES) return null;
  const stream = gl.createBuffer();
  if (!stream) return null;
  const bytes = new Uint8Array(UNIFORM_BYTES);
  const target = gl.UNIFORM_BUFFER;
  let used = 0;
  const latest = new Map();
  function stage(pending, owner, slot, source, offset, size) {
    const start = Math.ceil(used / alignment) * alignment;
    if (start + size > bytes.length) return false;
    bytes.set(source.subarray(offset, offset + size), start);
    used = start + size;
    latest.set(slot, {owner, start, size});
    pending.calls.push([rawRange, [target, slot, stream, start, size]]);
    // bindBufferRange updates the generic binding as well as the slot.
    pending.calls.push([rawBind, [target, owner]]);
    return true;
  }
  function submit(pending, binding) {
    if (used) {
      rawBind.call(gl, target, stream);
      rawData.call(gl, target, bytes, gl.STREAM_DRAW, 0, used);
      rawBind.call(gl, target, pending.uniform);
    }
    for (const [fn, args] of pending.calls) fn.apply(gl, args);
    if (!used) return;
    // Preserve each original buffer and its base binding at every boundary.
    // Readbacks, state changes and a later frame can use the contents normally.
    for (const [slot, {owner, start, size}] of latest) {
      rawBind.call(gl, target, owner);
      rawData.call(gl, target, bytes, gl.STREAM_DRAW, start, size);
      rawBase.call(gl, target, slot, owner);
    }
    rawBind.call(gl, target, binding);
    used = 0;
    latest.clear();
  }
  function dispose() {
    methods.get('deleteBuffer').call(gl, stream);
  }
  return {stage, submit, dispose};
}

export function createDrawBatch(packUniforms = false) {
  let device, armed = false, frame = false, batch, turn = 0;
  function disable() {
    armed = false;
    frame = false;
    batch = null;
    if (device) device.restore();
    device = null;
  }
  const drain = () => {
    armed = false;
    const pending = batch;
    batch = null;
    if (device && !device.uploads) device.idle();
    if (!pending) return;
    try {
      if (device.uploads) device.uploads.submit(pending, device.uniform);
      else for (const [fn, args] of pending.calls) fn.apply(device.gl, args);
    } catch (error) {
      disable();
      throw error;
    }
  };
  const flush = () => {
    frame = false;
    drain();
  };
  const start = () => ({calls: [], bytes: 0, uniform: device.uniform, newObjects: new WeakSet()});

  function install(gl) {
    const methods = new Map();
    for (let proto = gl; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = Object.getOwnPropertyDescriptor(proto, name).value;
        if (name !== 'constructor' && typeof fn === 'function' && !methods.has(name)) methods.set(name, fn);
      }
    }
    const state = {
      gl, vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), elements: new Map(),
      pbo: gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING), alignment: gl.getParameter(gl.UNPACK_ALIGNMENT),
      row: gl.getParameter(gl.UNPACK_ROW_LENGTH), skipPixels: gl.getParameter(gl.UNPACK_SKIP_PIXELS),
      skipRows: gl.getParameter(gl.UNPACK_SKIP_ROWS),
    };
    const query = methods.get('getParameter').bind(gl);
    state.uploads = packUniforms ? uniformUploads(gl, methods) : null;
    const uniformOwners = new WeakSet();
    if (state.uploads) {
      state.uniform = query(gl.UNIFORM_BUFFER_BINDING);
      if (state.uniform) uniformOwners.add(state.uniform);
      // Install before the guest's first draw where possible. The ordinary
      // tracker also learns buffers already allocated during core startup.
      for (let slot = 0; slot < 3; slot++) {
        const owner = gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, slot);
        if (owner) uniformOwners.add(owner);
      }
    }
    const vaos = new WeakSet(), elementBuffers = new WeakSet();
    if (state.vao) vaos.add(state.vao);
    const initialElement = query(gl.ELEMENT_ARRAY_BUFFER_BINDING);
    if (initialElement) elementBuffers.add(initialElement);
    state.elements.set(state.vao, initialElement);
    const originalDescriptors = new Map(), wrappers = new Map();
    let active = false;
    function restoreMethod(name) {
      const original = originalDescriptors.get(name);
      if (original) Object.defineProperty(gl, name, original);
      else delete gl[name];
    }
    function observe(name, a, result) {
      if (name === 'bindVertexArray') state.vao = a[0];
      else if (name === 'createVertexArray' && result) {
        vaos.add(result);
        state.elements.set(result, null);
      }
      else if (name === 'bindBuffer') {
        if (a[0] === gl.ELEMENT_ARRAY_BUFFER) state.elements.set(state.vao, a[1]);
        if (a[0] === gl.PIXEL_UNPACK_BUFFER) state.pbo = a[1];
        if (state.uploads && a[0] === gl.UNIFORM_BUFFER) state.uniform = a[1];
      } else if (name === 'pixelStorei') {
        if (a[0] === gl.UNPACK_ALIGNMENT && [1,2,4,8].includes(a[1])) state.alignment = a[1];
        if (a[0] === gl.UNPACK_ROW_LENGTH && integral(a[1])) state.row = a[1];
        if (a[0] === gl.UNPACK_SKIP_PIXELS && integral(a[1])) state.skipPixels = a[1];
        if (a[0] === gl.UNPACK_SKIP_ROWS && integral(a[1])) state.skipRows = a[1];
      } else if (name === 'deleteVertexArray') {
        vaos.delete(a[0]);
        state.elements.delete(a[0]);
        if (state.vao === a[0]) state.vao = null;
      } else if (name === 'deleteBuffer') {
        elementBuffers.delete(a[0]);
        if (state.pbo === a[0]) state.pbo = null;
        if (state.uploads) {
          uniformOwners.delete(a[0]);
          if (state.uniform === a[0]) state.uniform = query(gl.UNIFORM_BUFFER_BINDING);
        }
        // A deleted buffer can remain attached to an unbound VAO. Re-query
        // that VAO on its next use instead of manufacturing a null binding.
        for (const [vao, buffer] of state.elements) if (buffer === a[0]) state.elements.delete(vao);
      }
    }
    function call(name, fn, args) {
      // An object might belong to another context, have been deleted, or
      // already be a non-index buffer. Confirm unfamiliar bindings with GL.
      const checkVao = name === 'bindVertexArray' && args[0] && !vaos.has(args[0]);
      const checkElement = name === 'bindBuffer' && args[0] === gl.ELEMENT_ARRAY_BUFFER &&
        args[1] && !elementBuffers.has(args[1]);
      const checkUnpack = name === 'bindBuffer' && args[0] === gl.PIXEL_UNPACK_BUFFER && args[1];
      const checkUniform = state.uploads && (
        (name === 'bindBuffer' && args[0] === gl.UNIFORM_BUFFER && args[1] && !uniformOwners.has(args[1])) ||
        ((name === 'bindBufferBase' || name === 'bindBufferRange') && args[0] === gl.UNIFORM_BUFFER)
      );
      if (checkVao || checkElement || checkUnpack || checkUniform) {
        if (batch) drain();
        const result = fn.apply(gl, args);
        if (checkVao) {
          state.vao = query(gl.VERTEX_ARRAY_BINDING);
          if (state.vao) vaos.add(state.vao);
        }
        if (checkVao || checkElement) {
          const bound = query(gl.ELEMENT_ARRAY_BUFFER_BINDING);
          state.elements.set(state.vao, bound);
          if (bound && (!methods.has('isBuffer') || methods.get('isBuffer').call(gl, bound)))
            elementBuffers.add(bound);
        }
        if (checkUnpack) state.pbo = query(gl.PIXEL_UNPACK_BUFFER_BINDING);
        if (checkUniform) {
          state.uniform = query(gl.UNIFORM_BUFFER_BINDING);
          if (state.uniform) uniformOwners.add(state.uniform);
        }
        return result;
      }
      if (armed && (name === 'drawElements' || name === 'drawArrays')) {
        armed = false;
        batch = start();
      }
      if (batch) {
        if (allocations.has(name)) {
          const obj = fn.apply(gl, args);
          if (obj) batch.newObjects.add(obj);
          if (track.has(name)) observe(name, args, obj);
          return obj;
        }
        if (shaderQueries.has(name) || (shaderWrites.has(name) && batch.newObjects.has(args[0]))) {
          return fn.apply(gl, args);
        }
        if (name === 'getParameter' && args[0] === gl.ELEMENT_ARRAY_BUFFER_BINDING && state.elements.has(state.vao)) {
          return state.elements.get(state.vao);
        }
        const uniformBarrier = frame && args[0] === gl.UNIFORM_BUFFER &&
          (name === 'bufferData' || name === 'bufferSubData');
        if (!uniformBarrier && batch.calls.length < (frame ? MAX_FRAME_CALLS : MAX_CALLS)) {
          const bytes = states.has(name) ? 0 : uploadSize(gl, state, name, args, MAX_BYTES - batch.bytes);
          if (bytes >= 0) {
            batch.calls.push([fn, args]);
            batch.bytes += bytes;
            if (track.has(name)) observe(name, args);
            return;
          }
        }
        drain();
      }
      const result = fn.apply(gl, args);
      if (track.has(name)) observe(name, args, result);
      if (name === 'getParameter' && args[0] === gl.ELEMENT_ARRAY_BUFFER_BINDING) state.elements.set(state.vao, result);
      return result;
    }
    function restore() {
      for (const name of originalDescriptors.keys()) restoreMethod(name);
      if (gl.canvas && gl.canvas.removeEventListener) gl.canvas.removeEventListener('webglcontextlost', disable);
      if (state.uploads) state.uploads.dispose();
    }
    state.restore = restore;
    try {
      for (const [name, fn] of methods) {
        originalDescriptors.set(name, Object.getOwnPropertyDescriptor(gl, name));
        const descriptor = {configurable: true, writable: true, value: (...args) => call(name, fn, args)};
        wrappers.set(name, descriptor);
        if (track.has(name)) Object.defineProperty(gl, name, descriptor);
      }
      if (gl.canvas && gl.canvas.addEventListener) gl.canvas.addEventListener('webglcontextlost', disable);
    } catch {
      restore();
      return null;
    }
    state.activate = () => {
      if (active) return;
      active = true;
      for (const [name, descriptor] of wrappers)
        if (!track.has(name)) Object.defineProperty(gl, name, descriptor);
    };
    state.idle = () => {
      if (!active) return;
      active = false;
      for (const name of wrappers.keys()) if (!track.has(name)) restoreMethod(name);
    };
    return state;
  }
  function activate(gl) {
    if (!gl) return false;
    if (device === undefined) {
      try { device = install(gl); } catch { device = null; }
    }
    if (!device || device.gl !== gl) return false;
    try { device.activate(); } catch { disable(); return false; }
    return true;
  }
  function begin(gl) {
    if (batch || armed || !activate(gl)) return;
    armed = true;
    const current = ++turn;
    queueMicrotask(() => { if (turn === current) flush(); });
  }
  function beginFrame(gl) {
    if (!packUniforms || !activate(gl) || !device.uploads) return;
    frame = true;
  }
  function queueUniform(owner, slot, source, offset, size) {
    if (!frame || !owner || owner !== device.uniform ||
        !integral(slot) || slot > 2 || !integral(offset) || !integral(size) ||
        !size || size > UNIFORM_BYTES || offset + size > source.length) return false;
    if (!batch) batch = start();
    if (batch.calls.length < MAX_FRAME_CALLS && device.uploads.stage(batch, owner, slot, source, offset, size)) return true;
    drain();
    batch = start();
    return device.uploads.stage(batch, owner, slot, source, offset, size);
  }
  return {begin, beginFrame, queueUniform, flush};
}
