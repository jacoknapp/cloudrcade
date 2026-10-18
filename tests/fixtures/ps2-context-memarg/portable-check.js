/* Synthetic emitted-code differential usable in Node or an isolated browser.
 * Pass portable-generated-corpus.json; no generator, emulator or ROM is needed.
 * Shared Wasm memory requires cross-origin isolation in browser environments.
 */
async function runContextMemargCorpus(corpus) {
  const memory = new WebAssembly.Memory({initial: 4, maximum: 32768, shared: true});
  const bytes = new Uint8Array(memory.buffer), view = new DataView(memory.buffer);
  let observations = [], checked = 0, traps = 0, validationFailures = 0;
  const callback = (ctx, address, value) => {
    observations.push([ctx >>> 0, address >>> 0, value >>> 0, view.getUint32(address >>> 0, true)]);
    view.setUint32(address >>> 0, 0xdeadbeef, true);
  };
  // A Wasm import/reexport supplies a typed table entry on engines without
  // WebAssembly.Function. This is fixture plumbing, not a product optimization.
  const wrapper = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from([
    0,97,115,109,1,0,0,0,1,7,1,96,3,127,127,127,0,
    2,7,1,1,101,1,102,0,0,7,5,1,1,102,0,0
  ])), {e: {f: callback}});
  const table = new WebAssembly.Table({initial: 32, element: 'anyfunc'});
  table.set(0, wrapper.exports.f);
  const decode = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  for (const entry of corpus.modules) {
    const pair = {};
    for (const name of ['baseline', 'candidate']) {
      try { pair[name] = new WebAssembly.Instance(new WebAssembly.Module(decode(entry[name])),
        {env: {memory, fctTable: table}}).exports.codeGenFunc; }
      catch (e) { pair[name] = e.constructor.name; }
    }
    if (typeof pair.baseline !== 'function' || typeof pair.candidate !== 'function') {
      if (pair.baseline !== pair.candidate) throw Error('Validation parity: ' + entry.mode);
      validationFailures++; continue;
    }
    const base = 64, initial = new Uint8Array(bytes.length), initialView = new DataView(initial.buffer);
    for (let i = 0; i < initial.length; i++) initial[i] = (i * 31 + (i >>> 8) + 17) & 255;
    const load = [8,10,12,14,18,19,20].includes(entry.mode);
    const store = [9,11,13,15,21,22,23].includes(entry.mode);
    if (load || store) {
      const at = base + (load ? entry.src : entry.dst);
      if (at + 8 <= initial.length) {
        initialView.setUint32(at, 8192, true);
        if ([10,11,14,15].includes(entry.mode)) initialView.setUint32(at + 4, 0, true);
      }
    }
    const result = {};
    for (const name of ['baseline', 'candidate']) {
      bytes.set(initial); observations = []; let error = null;
      try { pair[name](base); } catch (e) { error = e.constructor.name; }
      result[name] = {bytes: bytes.slice(), error, calls: JSON.stringify(observations)};
    }
    if (result.baseline.error !== result.candidate.error ||
        result.baseline.calls !== result.candidate.calls ||
        !same(result.baseline.bytes, result.candidate.bytes)) throw Error('State parity: ' + JSON.stringify(entry));
    if (result.baseline.error) traps++;
    checked++;
  }
  return {checked, traps, validationFailures, contextBytes: corpus.layout[0], pointerBytes: corpus.layout[1]};
}
if (typeof module !== 'undefined') module.exports = {runContextMemargCorpus};
