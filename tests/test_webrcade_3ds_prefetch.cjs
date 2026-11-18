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
  const idSize = 64 * 1024;
  const startup = make();
  const loading = startup.readHeader();
  const initial = new Uint8Array(CHUNK_SIZE);
  for (let i = 0; i < initial.length; i++) initial[i] = i % 251;
  answer(requests.at(-1), startup, 0, { arrayBuffer: async () => initial.buffer });
  const id = await loading;
  assert.deepEqual(id, initial.slice(0, idSize), 'existing saves use exactly the original header');
  id.fill(0);
  const sample = new Uint8Array(8);
  startup.read(sample, 0, 8, idSize - 2);
  assert.deepEqual(sample, initial.slice(idSize - 2, idSize + 6));
  assert.equal(startup.readAheadStats.misses, 0);
  assert.notEqual(id.buffer, startup.getChunk(0).buffer, 'the ID cannot pin or overwrite the chunk');
  startup.close();

  const limited = make(), fallback = limited.readHeader();
  let discarded = false;
  answer(requests.at(-1), limited, 0, { headers: { get: () => null },
    body: { cancel() { discarded = true; } }, arrayBuffer() { assert.fail('invalid full chunk'); } });
  await flush();
  assert(discarded);
  assert.equal(requests.at(-1).options.headers.Range, `bytes=0-${idSize - 1}`);
  answer(requests.at(-1), limited, 0, { headers: { get: () => null },
    arrayBuffer: async () => initial.slice(0, idSize).buffer });
  assert.deepEqual(await fallback, initial.slice(0, idSize));
  assert.equal(limited.chunks.size, 0, 'short fallback is never installed as a full chunk');
  limited.close();

  const malformed = make(), rejected = malformed.readHeader();
  answer(requests.at(-1), malformed, 0, { arrayBuffer: async () => new Uint8Array(3).buffer });
  await flush();
  answer(requests.at(-1), malformed, 0, { headers: { get: () => `bytes 1-${idSize}/${malformed.size}` } });
  await assert.rejects(rejected, /requested range/);
  assert.equal(malformed.chunks.size, 0);
  malformed.close();

  const interrupted = make(), interruptedHeader = interrupted.readHeader();
  const interruptedRequest = requests.at(-1);
  interrupted.close();
  assert(interruptedRequest.options.signal.aborted);
  answer(interruptedRequest, interrupted, 0);
  await assert.rejects(interruptedHeader, /closed/);
  assert.equal(interrupted.chunks.size, 0);
  requests.length = 0;
  const rom = make(), buffer = new Uint8Array(8);
  rom.read(buffer, 0, 8, 0);
  rom.read(buffer, 0, 8, 8);
  const nearEnd = CHUNK_SIZE - 256 * 1024;
  rom.read(buffer, 0, 8, nearEnd);
  rom.read(buffer, 0, 8, nearEnd);
  rom.read(buffer, 0, 8, nearEnd - 8);
  assert.equal(requests.length, 0, 'header reads, seeks, repeated and backward reads do not speculate');
  rom.read(buffer, 0, 8, nearEnd);
  assert.equal(requests.length, 1, 'sequential progress near the boundary starts prefetch');
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
  rom.read(buffer, 0, 8, CHUNK_SIZE + nearEnd);
  rom.read(buffer, 0, 8, CHUNK_SIZE + nearEnd + 8);
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
  const seek = make(); seek.read(buffer, 0, 8, nearEnd); seek.read(buffer, 0, 8, nearEnd + 8);
  const abandoned = requests.at(-1); seek.read(buffer, 0, 8, 10 * CHUNK_SIZE);
  assert(abandoned.options.signal.aborted, 'unrelated seeks cancel read-ahead');
  abandoned.reject(new Error('cancelled')); await flush();
  assert.equal(seek.failedPrefetch, -1, 'cancellation does not poison future reads');
  const lru = make();
  for (let i = 0; i < MAX_CHUNKS - 1; i++) lru.getChunk(i);
  lru.prefetch(MAX_CHUNKS - 1);
  answer(requests.at(-1), lru, MAX_CHUNKS - 1); await flush();
  // The previous demand chunk must move behind the newly completed prefetch.
  lru.getChunk(MAX_CHUNKS - 2);
  assert.deepEqual([...lru.chunks.keys()].slice(-2), [MAX_CHUNKS - 1, MAX_CHUNKS - 2]);
  for (let i = MAX_CHUNKS; i < 2 * MAX_CHUNKS - 1; i++) lru.getChunk(i);
  assert(lru.chunks.has(MAX_CHUNKS - 2));
  assert(!lru.chunks.has(MAX_CHUNKS - 1));
  lru.close();
  rom.close(); partial.close(); seek.close();
  console.log('PASS startup chunk reuse, game ID, short fallback, LRU order, shared 16 MiB budget, demand/exit/seek races and EOF');
})().catch(error => { console.error(error); process.exitCode = 1; });
