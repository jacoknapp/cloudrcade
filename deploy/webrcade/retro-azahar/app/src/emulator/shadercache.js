// The core's record of the shader programs a game has used (RememberedPrograms
// in the core): a stamp naming the core build, then records
//   'S' hash(8) type(4) length(4) text      one shader's GLSL
//   'P' id(8) vertex hash(8) fragment hash(8)   one linked pair
// Copies of it from this browser and from the cloud are merged here, so that
// what one device has learnt is rebuilt ahead of time on the others.

const STAMP_LENGTH = 27; // "WRCP1 " + __DATE__ + " " + __TIME__ + NUL

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// Calls back with (key, record bytes) for every complete record.
function records(file, each) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let at = STAMP_LENGTH;
  while (at < file.length) {
    const kind = file[at];
    let end;
    if (kind === 0x53 /* S */) {
      if (at + 17 > file.length) return;
      end = at + 17 + view.getUint32(at + 13, true);
    } else if (kind === 0x50 /* P */) {
      end = at + 25;
    } else {
      return;
    }
    if (end > file.length) return;
    each(String.fromCharCode(kind) + hex(file.subarray(at + 1, at + 9)), file.subarray(at, end));
    at = end;
  }
}

const stamp = (file) => (file && file.length >= STAMP_LENGTH ? hex(file.subarray(0, STAMP_LENGTH)) : null);

// The union of two copies. `mine` decides which core build counts: a copy made
// by another build describes other shaders and is dropped.
export function mergeShaderCaches(mine, other) {
  if (!stamp(mine)) return stamp(other) ? other : null;
  if (stamp(other) !== stamp(mine)) return mine;
  const seen = new Set();
  const parts = [mine.subarray(0, STAMP_LENGTH)];
  let wanted;
  const take = (key, bytes) => {
    if (key[0] !== wanted || seen.has(key)) return;
    seen.add(key);
    parts.push(bytes);
  };
  // Shaders first: a pair is only of use once both of its shaders are known.
  for (wanted of ['S', 'P']) {
    records(mine, take);
    records(other, take);
  }
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    merged.set(part, at);
    at += part.length;
  }
  return merged;
}

// Shader text depends on what the graphics driver offers, so copies are only
// shared between devices that report the same one.
export function graphicsTag() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const text = [gl.getParameter(gl.VENDOR), gl.getParameter(gl.RENDERER),
      info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''].join('|');
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  } catch (e) {
    return 'unknown';
  }
}
