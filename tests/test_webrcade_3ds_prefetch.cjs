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
  const { ReadAheadRom: LazyRom, PAGE_SIZE: CHUNK_SIZE, MAX_PAGES: MAX_CHUNKS } = await import(
    'data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const requests = [];
  global.fetch = (url, options) => new Promise((resolve, reject) => {
    requests.push({ url, options, resolve, reject });
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const make = () => {
    const rom = new LazyRom('https://example.invalid/game.cia', CHUNK_SIZE * (MAX_CHUNKS * 2) + 17);
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
  const nearEnd = CHUNK_SIZE - CHUNK_SIZE / 8;
  rom.read(buffer, 0, 8, nearEnd);
  rom.read(buffer, 0, 8, nearEnd);
  rom.read(buffer, 0, 8, nearEnd - 8);
  assert.equal(requests.length, 0, 'header reads, seeks, repeated and backward reads do not speculate');
  rom.read(buffer, 0, 8, nearEnd);
  assert.equal(requests.length, 1, 'sequential progress near the boundary starts prefetch');
  const first = requests.at(-1);
  assert.equal(first.options.headers.Range, `bytes=${CHUNK_SIZE}-${2 * CHUNK_SIZE - 1}`);
  for (let i = 2; i < MAX_CHUNKS + 6; i++) rom.getChunk(i);
  assert.equal(rom.chunks.size + Number(!!rom.pending), MAX_CHUNKS,
    'in-flight data occupies one page of the 16 MiB cache');
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
  const partial = make(); partial.prefetch(MAX_CHUNKS * 2);
  answer(requests.at(-1), partial, MAX_CHUNKS * 2); await flush();
  assert.equal(partial.getChunk(MAX_CHUNKS * 2).length, 17);
  const count = requests.length; partial.prefetch(MAX_CHUNKS * 2 + 1);
  assert.equal(requests.length, count, 'no request after EOF');
  const seek = make(); seek.read(buffer, 0, 8, nearEnd); seek.read(buffer, 0, 8, nearEnd + 8);
  const abandoned = requests.at(-1); seek.read(buffer, 0, 8, 10 * CHUNK_SIZE);
  assert(abandoned.options.signal.aborted, 'unrelated seeks cancel read-ahead');
  abandoned.reject(new Error('cancelled')); await flush();
  assert.equal(seek.failedPrefetch, -1, 'cancellation does not poison future reads');
  // Large contiguous reads coalesce missing pages, even at a partial EOF.
  const bulk = new LazyRom('/bulk', 20 * CHUNK_SIZE + 17);
  const ranges = [];
  bulk.fetchBytes = (first, last) => {
    ranges.push([first, last]);
    const data = new Uint8Array(last - first + 1);
    for (let i = 0; i < data.length; i++) data[i] = Math.floor((first + i) / CHUNK_SIZE);
    return data;
  };
  bulk.getChunk(4);
  ranges.length = 0;
  bulk.prefetch(7);
  const overlapping = requests.at(-1);
  const all = new Uint8Array(bulk.size + 10).fill(255);
  assert.equal(bulk.read(all, 2, all.length - 2, 0), bulk.size);
  assert.deepEqual(ranges, [[0, 4 * CHUNK_SIZE - 1], [5 * CHUNK_SIZE, 13 * CHUNK_SIZE - 1], [13 * CHUNK_SIZE, bulk.size - 1]]);
  assert(overlapping.options.signal.aborted, 'a grouped demand takes over the pending page');
  answer(overlapping, bulk, 7); await flush();
  assert(!bulk.prefetched.has(7));
  for (let i = 0; i < bulk.size; i += CHUNK_SIZE) assert.equal(all[i + 2], i / CHUNK_SIZE);
  assert.equal(all[bulk.size + 1], 20);
  assert.equal(all[bulk.size + 2], 255);
  assert.notEqual(bulk.chunks.get(1).buffer, bulk.chunks.get(2).buffer);
  assert.equal(bulk.read(all, 2, bulk.size, 0), bulk.size);
  assert.equal(ranges.length, 3, 'rereading the same pages needs no new ranges');
  bulk.close();
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
