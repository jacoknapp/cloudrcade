const fs = require('fs'), path = require('path'), assert = require('assert');

(async () => {
  const generators = {};
  for (const name of ['baseline', 'candidate']) generators[name] = await require('./' + name + '.cjs')();
  const layout = Array.from({length: 18}, (_, i) => generators.baseline._layout(i));
  assert.deepStrictEqual(layout, Array.from({length: 18}, (_, i) => generators.candidate._layout(i)));
  const [contextSize, stateSize, timeOffset, inputOffset, statusOffset, divisionOffset] = layout;
  const pipes = [0, 1, 2].map(i => {
    const [value, index, values, times] = layout.slice(6 + i * 4, 10 + i * 4);
    return {value, index, values, times};
  });
  const base = 64, region = contextSize + 128;
  const memory = new WebAssembly.Memory({initial: 4, maximum: 32768, shared: true});
  const table = new WebAssembly.Table({initial: 1, element: 'anyfunc'});
  const bytes = new Uint8Array(memory.buffer);
  let rng = 0x12498bad, cases = 0, kernels = 0, controls = 0;
  const coverage = {newestMature: 0, newestNotMature: 0, noMature: 0, signedUnsignedDisagreements: 0};
  function random() { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return rng >>> 0; }
  function get(buffer, offset) { return buffer.readUInt32LE(base + offset); }
  function put(buffer, offset, value) { buffer.writeUInt32LE(value >>> 0, base + offset); }
  const add = (a, b) => (a + b) >>> 0;
  const mature = (time, now) => (time | 0) <= (now | 0);

  function read(buffer, pipe, relative) {
    const now = add(get(buffer, timeOffset), relative), index = get(buffer, pipe.index);
    for (let i = 0; i < 8; ++i) {
      const slot = (index + i) & 7;
      if (mature(get(buffer, pipe.times + slot * 4), now))
        put(buffer, pipe.value, get(buffer, pipe.values + slot * 4));
    }
  }
  function queue(buffer, pipe, relative) {
    const slot = get(buffer, pipe.index);
    put(buffer, pipe.times + slot * 4, add(get(buffer, timeOffset), add(relative, 4)));
    put(buffer, pipe.values + slot * 4, get(buffer, inputOffset));
    put(buffer, pipe.index, (slot + 1) & 7);
  }
  function reset(buffer, pipe) {
    for (let slot = 0; slot < 8; ++slot) {
      put(buffer, pipe.times + slot * 4, 0);
      put(buffer, pipe.values + slot * 4, get(buffer, inputOffset));
    }
  }
  function oracle(initial, mode, pipe, relative) {
    const result = Buffer.from(initial);
    if (mode === 0) read(result, pipe, relative);
    if (mode === 1) {
      read(result, pipes[0], relative); read(result, pipes[1], relative);
      const mac = get(result, pipes[0].value), sticky = get(result, pipes[1].value);
      put(result, statusOffset, (mac & 15 ? 1 : 0) | (mac & 240 ? 2 : 0) |
        (sticky & 15 ? 64 : 0) | (sticky & 240 ? 128 : 0) | (get(result, divisionOffset) ? 32 : 0));
    }
    if (mode === 2) {
      read(result, pipe, relative); queue(result, pipe, relative);
      read(result, pipe, add(relative, 1)); read(result, pipe, add(relative, 4));
    }
    if (mode === 3) { reset(result, pipe); read(result, pipe, relative); }
    if (mode === 4) {
      for (let i = 0; i < 3; ++i) read(result, pipes[i], add(relative, i));
      for (let i = 0; i < 3; ++i) read(result, pipes[i], add(relative, i + 4));
    }
    if (mode === 5) { queue(result, pipe, relative); reset(result, pipe); }
    return result;
  }
  function initial(index, pipeTime) {
    const result = Buffer.alloc(region, 0xc3);
    for (let offset = 0; offset < contextSize; offset += 4) put(result, offset, random());
    put(result, timeOffset, pipeTime);
    for (const pipe of pipes) {
      put(result, pipe.index, index);
      put(result, pipe.value, index === 0 ? 0 : index === 7 ? 0xffffffff : random());
    }
    return result;
  }
  function build(mode, which, relative) {
    const pair = {mode, which, relative};
    for (const name of ['baseline', 'candidate']) {
      const generator = generators[name], ptr = generator._generate(mode, which, relative);
      const code = Buffer.from(generator.HEAPU8.subarray(ptr, ptr + generator._generatedSize()));
      pair[name] = {code, run: new WebAssembly.Instance(new WebAssembly.Module(code),
        {env: {memory, fctTable: table}}).exports.codeGenFunc};
      if (mode === 0 && which === 0 && relative === 0)
        fs.writeFileSync(path.join(__dirname, name + '-direct.wasm'), code);
    }
    if (mode === 5) { assert(pair.baseline.code.equals(pair.candidate.code), 'Queue/reset control changed'); controls++; }
    kernels++;
    return pair;
  }
  function equal(actual, expected, label) {
    if (!actual.equals(expected)) {
      const offset = actual.findIndex((value, i) => value !== expected[i]);
      throw Error(label + ': first differing byte ' + offset + ', actual=' + actual[offset] + ', expected=' + expected[offset]);
    }
  }
  function compare(pair, input) {
    const expected = oracle(input, pair.mode, pipes[pair.which], pair.relative);
    for (const name of ['baseline', 'candidate']) {
      bytes.set(input); pair[name].run(base);
      equal(Buffer.from(bytes.subarray(0, region)), expected,
        name + ' complete state/canaries mode/pipe/relative=' + [pair.mode, pair.which, pair.relative]);
    }
    if (pair.mode === 0) {
      const pipe = pipes[pair.which], now = add(get(input, timeOffset), pair.relative), index = get(input, pipe.index);
      const newestTime = get(input, pipe.times + ((index + 7) & 7) * 4);
      coverage[mature(newestTime, now) ? 'newestMature' : 'newestNotMature']++;
      if (mature(newestTime, now) !== (newestTime <= now)) coverage.signedUnsignedDisagreements++;
      if (!Array.from({length: 8}, (_, i) => mature(get(input, pipe.times + i * 4), now)).some(Boolean)) coverage.noMature++;
    }
    cases++;
  }

  // Exhaust every eligibility pattern and ring index at four signed thresholds.
  // Times are intentionally unsorted; equal timestamps qualify under <=.
  for (let which = 0; which < 3; ++which) {
    const pair = build(0, which, 0), pipe = pipes[which];
    for (const now of [0, 0xffffffff, 0x80000001, 0x7ffffffe])
      for (let index = 0; index < 8; ++index)
        for (let mask = 0; mask < 256; ++mask) {
          const input = initial(index, now);
          for (let i = 0; i < 8; ++i) {
            const slot = (index + i) & 7;
            put(input, pipe.times + slot * 4, mask & (1 << i) ? now : add(now, 1));
            put(input, pipe.values + slot * 4, (0x10203040 + i * 0x01010101) >>> 0);
          }
          compare(pair, input);
        }
  }
  // High index bits must be masked exactly as in the original eight reads.
  const indexEdges = [8, 9, 15, 16, 0x7ffffffe, 0x7fffffff, 0x80000000,
    0x80000001, 0xfffffff8, 0xfffffffe, 0xffffffff];
  for (let which = 0; which < 3; ++which) {
    const pair = build(0, which, 0), pipe = pipes[which];
    for (const index of indexEdges)
      for (const now of [0, 0xffffffff, 0x80000001, 0x7ffffffe])
        for (let mask = 0; mask < 256; ++mask) {
          const input = initial(index, now);
          for (let i = 0; i < 8; ++i)
            put(input, pipe.times + ((index + i) & 7) * 4, mask & (1 << i) ? now : add(now, 1));
          compare(pair, input);
        }
  }
  const edges = [0, 1, 3, 4, 0x7ffffffe, 0x7fffffff, 0x80000000, 0x80000001, 0xfffffffc, 0xffffffff];
  const relatives = [0, 1, 4, 0x7fffffff, 0x80000000, 0xfffffffc, 0xffffffff];
  for (const relative of relatives)
    for (let mode = 0; mode < 6; ++mode)
      for (let which = 0; which < 3; ++which) {
        const pair = build(mode, which, relative);
        // Exercise explicit addition/sign wrap boundaries and all-ring reads.
        for (let index = 0; index < 8; ++index)
          for (const now of edges) {
            const input = initial(index, now);
            for (let p = 0; p < 3; ++p)
              for (let i = 0; i < 8; ++i)
                put(input, pipes[p].times + i * 4, edges[(i + index + p) % edges.length]);
            compare(pair, input);
          }
        // Arbitrary ring times/values and initial flags, deterministic seed.
        for (let sample = 0; sample < 128; ++sample) compare(pair, initial(mode === 2 || mode === 5 ? sample & 7 : random(), random()));
      }
  assert(coverage.newestMature > 0 && coverage.newestNotMature > 0 && coverage.noMature > 0);
  assert(coverage.signedUnsignedDisagreements > 0, 'Missing signed wrap negative controls');

  // Test the new operation on arbitrary lane payloads, independently of VU compares.
  let maskCases = 0, makeSzControls = 0;
  function maskKernel(name, mode, source, destination) {
    const g = generators[name], ptr = g._generateMask(mode, source, destination);
    const code = Buffer.from(g.HEAPU8.subarray(ptr, ptr + g._generatedSize()));
    return {code, run: new WebAssembly.Instance(new WebAssembly.Module(code),
      {env: {memory, fctTable: table}}).exports.codeGenFunc};
  }
  const lowerEdges = [0, 1, 3, 0x007fffff, 0x00800000, 0x3fffffff, 0x7ffffffe, 0x7fffffff];
  for (const source of [32, 33, 36, 48])
    for (const destination of [source, 128]) {
      const oldSz = maskKernel('baseline', 3, source, destination);
      const newSz = maskKernel('candidate', 3, source, destination);
      assert(oldSz.code.equals(newSz.code), 'Unchanged MakeSz generated bytes differ');
      makeSzControls++;
      for (const mode of [0, 1, 2]) {
        const kernel = maskKernel('candidate', mode, source, destination);
        assert(kernel.code.includes(Buffer.from([0xfd, 0xa4, 1])), 'Missing dedicated bitmask opcode');
        for (let mask = 0; mask < 16; mask++)
          for (let sample = 0; sample < 72; sample++) {
            const actualSource = mode === 2 ? bytes.length - 16 : base + source;
            const initialHead = Buffer.alloc(256, 0xa7), initialTail = Buffer.alloc(64, 0x5c);
            bytes.set(initialHead); bytes.set(initialTail, bytes.length - 64);
            const view = new DataView(memory.buffer);
            if (mode === 2) view.setUint32(base, actualSource, true);
            let expectedMask = 0;
            for (let lane = 0; lane < 4; lane++) {
              const value = ((sample < 8 ? lowerEdges[sample] : random() & 0x7fffffff) |
                ((mask >>> lane & 1) * 0x80000000)) >>> 0;
              view.setUint32(actualSource + lane * 4, value, true);
              let expected = value;
              if (mode === 1) {
                const other = random();
                view.setUint32(actualSource + 16 + lane * 4, other, true);
                expected ^= other;
              }
              expectedMask |= (expected >>> 31) << lane;
            }
            const head = Buffer.from(bytes.subarray(0, 256));
            const tail = Buffer.from(bytes.subarray(bytes.length - 64));
            head.writeUInt32LE(expectedMask, base + destination);
            kernel.run(base);
            assert(Buffer.from(bytes.subarray(0, 256)).equals(head), 'Bitmask full head/alias mismatch');
            assert(Buffer.from(bytes.subarray(bytes.length - 64)).equals(tail), 'Bitmask tail canary changed');
            maskCases++;
          }
      }
    }
  fs.writeFileSync(path.join(__dirname, 'bitmask-api-result.json'), JSON.stringify({
    maskCases, makeSzControls, signMasks: 16, modes: ['relative', 'xor temporary', 'reference at memory end'],
    sourceOffsets: [32, 33, 36, 48], aliasesSource: true, arbitraryLower31Bits: true,
    zeroUpperResultBits: true, originalMakeSzByteIdentical: true,
  }, null, 2) + '\n');
  console.log('PASS dedicated bitmask API:', maskCases, 'cases;', makeSzControls, 'unchanged MakeSz controls');

  const result = {
    cases, generatedKernelPairs: kernels, identicalQueueResetControls: controls,
    contextBytes: contextSize, stateBytes: stateSize, canaryBytes: 128,
    allRingIndices: 8, highIndexEdges: indexEdges, exhaustiveEligibilityMasks: 256, relativeConstants: relatives,
    modes: ['read', 'GetStatus', 'read/queue/read/read', 'reset/read', 'all rings twice', 'queue/reset control'],
    coverage, comparison: 'wrapped i32 addition followed by signed i32 <=, verified by actual baseline Wasm',
    gameHitFrequencyClaim: false, gamePerformanceClaim: false,
  };
  fs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS actual generated VU dedicated-bitmask differential:', JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
