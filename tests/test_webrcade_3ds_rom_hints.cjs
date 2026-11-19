const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const readerDir = path.join(__dirname, '../deploy/webrcade/retro-azahar/app/src/emulator');

async function reader() {
  const text = fs.readFileSync(path.join(readerDir, 'lazyrom.js'), 'utf8')
    + fs.readFileSync(path.join(readerDir, 'read-ahead-rom.js'), 'utf8').replace(/^import .*?;\n/, '');
  return import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
}
const flush = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  const { ReadAheadRom, PAGE_SIZE, MAX_PAGES } = await reader();
  const size = (MAX_PAGES * 4) * PAGE_SIZE - 20;
  const uid = 'a'.repeat(32);
  const alternateUid = 'b'.repeat(32);
  const bytesFor = (first, last) => Uint8Array.from({ length: last - first + 1 },
    (_, offset) => ((first + offset) ^ ((first + offset) >>> 12)) & 255);
  const requests = [];
  const disk = new Map();
  let writes = 0;
  const storage = {
    getItem: key => disk.get(key),
    setItem(key, value) { writes++; disk.set(key, value); },
  };
  global.fetch = (_url, request) => new Promise(resolve => {
    const [first, last] = request.headers.Range.slice(6).split('-').map(Number);
    requests.push({
      first, last, signal: request.signal,
      finish: (bad = false) => resolve({
        status: 206,
        headers: { get: () => `bytes ${first}-${last}/${size}` },
        arrayBuffer: async () => (bad ? new Uint8Array(1) : bytesFor(first, last)).buffer,
      }),
    });
  });
  function make(id = uid, hintStorage = storage) {
    const rom = new ReadAheadRom('/game.cia', size);
    const sync = [];
    rom.enableReadHints(id, hintStorage);
    rom.fetchBytes = (first, last) => {
      sync.push([first, last]);
      return bytesFor(first, last);
    };
    function read(frame, first, length = 8) {
      rom.markReadAheadFrame(frame);
      const bytes = new Uint8Array(length);
      assert.equal(rom.read(bytes, 0, length, first), length);
      assert.deepEqual(bytes, bytesFor(first, first + length - 1));
    }
    return { read, rom, sync };
  }
  const start = session => {
    session.read(10, 2 * PAGE_SIZE + 27);
    session.read(50, 25 * PAGE_SIZE + 88);
    session.read(68, 25 * PAGE_SIZE + 96);
  };
  const target = 200 * PAGE_SIZE - 4;
  const run = async (session, prediction = false) => {
    const count = requests.length;
    start(session);
    assert.equal(requests.length, count + Number(prediction));
    if (prediction) {
      const request = requests.at(-1);
      assert.equal(request.first, 199 * PAGE_SIZE);
      assert.equal(request.last, 201 * PAGE_SIZE - 1);
      request.finish();
      await flush();
    }
    session.read(160, target);
    return session.sync;
  };
  const cold = make(uid, null);
  const baseline = await run(cold);
  const seed = make();
  assert.deepEqual(await run(seed), baseline);
  assert.equal(writes, 0, 'no writes in a frame');
  seed.rom.close();
  assert.equal(writes, 1, 'prior play persists an offset hint only at exit');
  const rows = JSON.parse([...disk.values()][0]);
  assert.deepEqual(rows, [[25 * PAGE_SIZE + 88, 25 * PAGE_SIZE + 96, [[199, 2]]]]);
  assert([...disk.values()][0].length <= 32);
  const learned = make();
  assert.deepEqual(await run(learned, true), baseline.slice(0, -1));
  assert.equal(learned.rom.readAheadStats.prefetchHits, 2);
  learned.rom.close();
  assert.equal(writes, 1, 'using a prediction alone writes nothing');

  const differentGame = make(alternateUid);
  assert.deepEqual(await run(differentGame), baseline, 'hints are scoped to the stable game ID');
  const badMatch = make();
  const before = requests.length;
  badMatch.read(10, 2 * PAGE_SIZE + 27);
  badMatch.read(50, 25 * PAGE_SIZE + 86);
  badMatch.read(68, 25 * PAGE_SIZE + 96);
  assert.equal(requests.length, before, 'both anchor offsets must match');
  badMatch.read(160, target);
  assert.equal(badMatch.sync.length, baseline.length);

  for (const destination of [target, 233 * PAGE_SIZE + 4]) {
    const race = make();
    start(race);
    const speculative = requests.at(-1);
    race.read(90, destination);
    assert(speculative.signal.aborted, 'an uncached demand cancels speculative work immediately');
    assert.equal(race.sync.length, 3);
    speculative.finish();
    await flush();
    assert.equal(race.rom.prefetched.size, 0, 'a cancelled response cannot affect cache');
    race.rom.close();
    // Restore the original first-play state for subsequent independent scenarios.
    disk.set([...disk.keys()][0], JSON.stringify(rows));
  }
  const badResponse = make();
  start(badResponse);
  requests.at(-1).finish(true);
  await flush();
  assert.equal(badResponse.rom.prefetched.size, 0);
  badResponse.read(160, target);
  assert.deepEqual(badResponse.sync, baseline, 'invalid speculative result leaves demand unchanged');

  const atCapacity = make();
  for (let page = 0; page < MAX_PAGES; page++) atCapacity.rom.getChunk(page + 250);
  const full = requests.length;
  start(atCapacity);
  assert.equal(requests.length, full + 1);
  assert.equal(atCapacity.rom.chunks.size + 2, MAX_PAGES, 'guess must reserve only its two LRU pages');
  assert(!atCapacity.rom.chunks.has(252) && !atCapacity.rom.chunks.has(253));
  requests.at(-1).finish();
  await flush();
  atCapacity.read(160, target);
  assert.equal(atCapacity.rom.chunks.size, MAX_PAGES);

  const ordinary = make();
  start(ordinary);
  const predicted = requests.at(-1);
  ordinary.read(80, 25 * PAGE_SIZE + 100);
  // An unrelated sequential miss has priority over the learned request.
  ordinary.read(90, 26 * PAGE_SIZE - 4, 4);
  ordinary.read(100, 26 * PAGE_SIZE, 4);
  assert(predicted.signal.aborted);
  assert.deepEqual(ordinary.sync.at(-1), [26 * PAGE_SIZE, 30 * PAGE_SIZE - 1]);

  const nullStorage = make(uid, null);
  assert.deepEqual(await run(nullStorage), baseline);
  nullStorage.rom.close();

  const closedStorage = make(uid, {
    getItem() { throw Error('Storage is closed'); },
    setItem() { throw Error('Storage is closed'); },
  });
  assert.deepEqual(await run(closedStorage), baseline);
  assert.doesNotThrow(() => closedStorage.rom.close());
  assert.equal(closedStorage.rom.chunks.size, 0);

  let chainHints = null;
  const chainStorage = {
    getItem: () => chainHints,
    setItem: (_key, value) => { chainHints = value; },
  };
  const chainSeed = make(uid, chainStorage);
  await run(chainSeed);
  chainSeed.read(161, 220 * PAGE_SIZE + 1);
  chainSeed.rom.close();
  assert.deepEqual(JSON.parse(chainHints)[0][2], [[199, 2], [220, 1]]);
  const chain = make(uid, chainStorage);
  const chainStart = requests.length;
  start(chain);
  assert.equal(requests.length, chainStart + 1);
  requests.at(-1).finish();
  await flush();
  assert.equal(requests.length, chainStart + 2);
  const unfinished = requests.at(-1);
  assert.equal(unfinished.first, 220 * PAGE_SIZE);
  chain.rom.close();
  assert(unfinished.signal.aborted);
  unfinished.finish();
  await flush();
  assert.equal(requests.length, chainStart + 2);
  assert.equal(chain.rom.chunks.size, 0);

  const repeatedAnchor = make(uid, chainStorage);
  const firstAttempt = requests.length;
  start(repeatedAnchor);
  const canceledFirst = requests.at(-1);
  repeatedAnchor.read(160, target);
  assert(canceledFirst.signal.aborted);
  canceledFirst.finish();
  await flush();
  assert.equal(requests.length, firstAttempt + 1, 'cancellation also discards the continuation');
  repeatedAnchor.rom.chunks.delete(199);
  repeatedAnchor.rom.chunks.delete(200);
  repeatedAnchor.read(510, 2 * PAGE_SIZE + 27);
  repeatedAnchor.read(550, 25 * PAGE_SIZE + 88);
  repeatedAnchor.read(568, 25 * PAGE_SIZE + 96);
  assert.equal(requests.length, firstAttempt + 1, 'a matching anchor never repeats a started chain');
  repeatedAnchor.rom.close();

  const anchors = Array.from({ length: 64 }, (_, i) => [
    (5 + 8 * i) * PAGE_SIZE + 9, (9 + 8 * i) * PAGE_SIZE + 11,
    [[650 + 2 * i, 1], [651 + 2 * i, 1]],
  ]);
  const limited = make(uid, {
    getItem: () => JSON.stringify(anchors),
    setItem() { assert.fail('no schedule edits expected'); },
  });
  const startCount = requests.length;
  for (const [index, [before, after, ranges]] of anchors.entries()) {
    const count = requests.length;
    if (index === anchors.length - 1) {
      assert.equal(count - startCount, 126, 'startup requests leave the late action anchor eligible');
    }
    limited.read(1000 * index + 1, before);
    limited.read(1000 * index + 2, after);
    for (let i = 0; i < ranges.length; i++) {
      assert.equal(requests.length, count + i + 1);
      assert.equal(requests.at(-1).first, ranges[i][0] * PAGE_SIZE);
      requests.at(-1).finish();
      await flush();
    }
  }
  const [lastPage] = anchors.at(-1)[2][1];
  const lateDemandCount = limited.sync.length;
  limited.read(64005, lastPage * PAGE_SIZE);
  assert.equal(limited.sync.length, lateDemandCount, 'late action was prefetched after all startup anchors');
  assert.equal(requests.length, startCount + 128, 'all saved anchors can use both ranges once');
  limited.rom.close();

  console.log(`PASS cold/control ${baseline.length} sync ranges; repeat ${learned.sync.length} + one 128 KiB async; game identity, bad predictions, contention, validity, and 16 MiB checked`);
})().catch(error => { console.error(error); process.exitCode = 1; });
