// Exercise real LazyRom demand/prefetch races with controlled range responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  let source = fs.readFileSync(path.join(__dirname,
    '../deploy/webrcade/retro-azahar/app/src/emulator/lazyrom.js'), 'utf8');
  source += fs.readFileSync(path.join(__dirname,
    '../deploy/webrcade/retro-azahar/app/src/emulator/read-ahead-rom.js'), 'utf8')
    .replace(/^import .*?;\n/, '');
  const { ReadAheadRom: LazyRom, CHUNK_SIZE, MAX_CHUNKS } = await import(
    'data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const requests = [];
  global.fetch = (url, options) => new Promise((resolve, reject) => {
    requests.push({ url, options, resolve, reject });
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const make = () => {
    const rom = new LazyRom('https://example.invalid/game.cia', CHUNK_SIZE * 24 + 17);
    rom.fetchChunk = index => new Uint8Array(Math.min(CHUNK_SIZE,
      rom.size - index * CHUNK_SIZE)).fill(index);
    return rom;
  };
  const answer = (request, rom, index, changes = {}) => request.resolve({
    status: 206,
    headers: { get: () => `bytes ${index * CHUNK_SIZE}-${Math.min((index + 1) * CHUNK_SIZE, rom.size) - 1}/${rom.size}` },
    arrayBuffer: async () => new Uint8Array(Math.min(CHUNK_SIZE,
      rom.size - index * CHUNK_SIZE)).fill(index).buffer,
    ...changes,
  });
  const rom = make(), buffer = new Uint8Array(8);
  rom.read(buffer, 0, 8, 0);
  assert.equal(requests.length, 0, 'first random read does not speculate');
  rom.read(buffer, 0, 8, 8);
  assert.equal(requests.length, 1);
  const first = requests.at(-1);
  assert.equal(first.options.headers.Range, `bytes=${CHUNK_SIZE}-${2 * CHUNK_SIZE - 1}`);
  for (let i = 2; i < 14; i++) rom.getChunk(i);
  assert.equal(rom.chunks.size + Number(!!rom.pending), MAX_CHUNKS,
    'in-flight data occupies one of the original eight cache slots');
  answer(first, rom, 1); await flush();
  assert.equal(rom.chunks.size, MAX_CHUNKS);
  const misses = rom.readAheadStats.misses;
  rom.read(buffer, 0, 8, CHUNK_SIZE);
  assert.deepEqual([...buffer], Array(8).fill(1));
  assert.equal(rom.readAheadStats.misses, misses, 'binary read-ahead avoids a synchronous miss');
  assert.equal(rom.readAheadStats.prefetchHits, 1);
  const pending = requests.at(-1);
  rom.getChunk(2);
  assert(pending.options.signal.aborted, 'demand wins over pending speculation');
  answer(pending, rom, 2); await flush();
  assert(!rom.prefetched.has(2), 'late cancelled bytes cannot replace demand data');

  const closed = make(); closed.prefetch(1);
  const stale = requests.at(-1); closed.close(); answer(stale, closed, 1); await flush();
  assert(stale.options.signal.aborted);
  assert.equal(closed.chunks.size, 0, 'exit cannot repopulate the cache');
  assert.equal(closed.pending, null);
  assert.throws(() => closed.getChunk(1), /closed/);

  for (const bad of [
    { status: 200 },
    { headers: { get: () => 'bytes 0-7/8' } },
    { arrayBuffer: async () => new Uint8Array(3).buffer },
  ]) {
    const invalid = make(); invalid.prefetch(1);
    answer(requests.at(-1), invalid, 1, bad); await flush();
    assert.equal(invalid.chunks.size, 0, 'invalid speculative data is rejected');
    const count = requests.length; invalid.prefetch(1);
    assert.equal(requests.length, count, 'bad speculation is not retried every frame');
    assert.equal(invalid.getChunk(1)[0], 1, 'demand fallback remains available');
    invalid.close();
  }
  const partial = make(); partial.prefetch(24);
  answer(requests.at(-1), partial, 24); await flush();
  assert.equal(partial.getChunk(24).length, 17);
  const count = requests.length; partial.prefetch(25);
  assert.equal(requests.length, count, 'no request after EOF');
  const seek = make(); seek.read(buffer, 0, 8, 0); seek.read(buffer, 0, 8, 8);
  const abandoned = requests.at(-1); seek.read(buffer, 0, 8, 10 * CHUNK_SIZE);
  assert(abandoned.options.signal.aborted, 'unrelated seeks cancel read-ahead');
  abandoned.reject(new Error('cancelled')); await flush();
  assert.equal(seek.failedPrefetch, -1, 'cancellation does not poison future reads');
  rom.close(); partial.close(); seek.close();
  console.log('PASS read-ahead hit, shared 16 MiB budget, demand/exit/seek races, range rejection and EOF');
})().catch(error => { console.error(error); process.exitCode = 1; });
