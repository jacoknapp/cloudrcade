// Exercise byte correctness, range failures, LRU and the real app adapter contract.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,
  '../deploy/webrcade/touch/assets/psx-stream.js'), 'utf8');
const chunk = 2 * 1024 * 1024;
let size = chunk * 20 + 17, calls = [], bad = '', bom = false;
const byte = at => (at * 13 + Math.floor(at / 256)) & 255;
class XHR {
  open(method, url, async) { assert.equal(async, false); }
  setRequestHeader(name, value) { this.range = value; }
  overrideMimeType(value) { assert.match(value, /x-user-defined/); }
  send() {
    const [, first, last] = /bytes=(\d+)-(\d+)/.exec(this.range).map(Number);
    calls.push([first, last]);
    this.status = bad === 'status' ? 200 : 206;
    this.header = `bytes ${first}-${last}/${size + (bad === 'range' ? 1 : 0)}`;
    const bytes = Buffer.alloc(last - first + 1);
    for (let i = 0; i < bytes.length; i++) bytes[i] = byte(first + i);
    this.responseText = bytes.toString('latin1');
    if (bad === 'short' || (bom && first === chunk)) this.responseText = this.responseText.slice(1);
  }
  getResponseHeader() { return this.header; }
}
const sandbox = { window: {}, location: new URL('https://games.test/play/app/psx/'),
  URL, XMLHttpRequest: XHR, Uint8Array, Map, Number, Promise, Error };
vm.runInNewContext(source, sandbox);
const { Disc, fetchDisc, attach } = sandbox.window.WrcadPsxStreaming;
(async () => {
  const disc = new Disc('/disc.chd', size);
  const buffer = new Uint8Array(39);
  disc.read(buffer, 3, 31, chunk - 11);
  assert.deepEqual(Array.from(buffer.slice(3, 34)), Array.from({length:31}, (_, i) => byte(chunk - 11 + i)));
  assert.equal(calls.length, 2);
  disc.read(buffer, 0, 1, 100); // refresh chunk zero before eviction
  for (let i = 2; i <= 8; i++) disc.read(buffer, 0, 1, chunk * i);
  assert.equal(disc.chunks.size, 8);
  assert(disc.chunks.has(0)); assert(!disc.chunks.has(1));
  assert.equal(disc.read(buffer, 0, 30, size - 2), 2);
  assert.equal(disc.read(buffer, 0, 30, size), 0);
  const reads = calls.length;
  disc.read(buffer, 0, 2, size - 2); assert.equal(calls.length, reads);
  for (const fault of ['status', 'range', 'short']) {
    bad = fault;
    assert.throws(() => new Disc('/disc.chd', size).read(buffer, 0, 1, chunk * 2));
  }
  bad = ''; bom = true;
  const bomDisc = new Disc('/disc.chd', size);
  bomDisc.read(buffer, 0, 1, chunk);
  assert.equal(buffer[0], byte(chunk));
  assert.deepEqual(calls.slice(-2), [[chunk, 2*chunk-1], [chunk-1, 2*chunk-1]]);
  bom = false;
  // The final chunk and >4GB offsets must not truncate to signed 32-bit.
  size = 5 * 1024 * 1024 * 1024 + 17;
  const huge = new Disc('/huge.pbp', size);
  huge.read(buffer, 0, 2, size - 2);
  assert.equal(buffer[0], byte(size - 2));

  let node, mountedRead;
  disc.mount({ unlink() {}, createFile(parent, name, data, read, write) {
    assert.equal(name, 'game.chd'); assert(read); assert(!write);
    return node = { stream_ops: {} };
  }, ErrnoError: Error }, '/retroarch/game.chd');
  assert.equal(node.usedBytes, disc.size);
  assert.equal(node.contents, null);
  assert.throws(() => node.stream_ops.write());
  assert.throws(() => node.stream_ops.mmap());

  size = chunk * 20 + 17;
  let downloads = 0, saves = 0, requested = [];
  const fetcher = { fetch: async () => { downloads++; return 'full'; } };
  const response = { status: 200, redirected: false, headers: new Map([
    ['Content-Length', String(size)], ['Accept-Ranges', 'bytes'], ['Content-Type', 'application/octet-stream']]) };
  sandbox.fetch = async (url, options) => {
    requested.push(options);
    if (options.method === 'HEAD') return response;
    return { status: 206, headers: new Map([['Content-Range', `bytes 0-${chunk-1}/${size}`]]),
      arrayBuffer: async () => new Uint8Array(chunk).buffer };
  };
  const app = { uid: 'existing-save-id', fetchResponseBuffer: async () => 'normal',
    onPreExit: async () => { saves++; } }, emulator = {};
  assert.equal(attach(app, emulator), emulator);
  const head = await fetchDisc(fetcher, app, '/disc.chd');
  assert.equal(requested.length, 2); assert.equal(requested[0].method, 'HEAD');
  assert.equal(requested[1].headers.Range, `bytes=0-${chunk-1}`);
  assert.equal(downloads, 0);
  assert.equal(await app.fetchResponseBuffer({}), 'normal', 'BIOS and other assets still use upstream buffering');
  assert.equal((await app.fetchResponseBuffer(head)).length, 1);
  assert.equal(app.uid, 'existing-save-id');
  assert.equal(emulator.wrcadLazyDisc.chunks.size, 1);
  await app.onPreExit(); assert.equal(saves, 1); assert.equal(emulator.wrcadLazyDisc.chunks.size, 0);
  assert.equal(await fetchDisc(fetcher, app, 'https://other.test/disc.chd'), 'full');
  assert.equal(await fetchDisc(fetcher, app, '/archive.zip'), 'full');
  response.headers.delete('Accept-Ranges');
  assert.equal(await fetchDisc(fetcher, app, '/disc.pbp'), 'full');
  assert.equal(downloads, 3);
  response.headers.set('Accept-Ranges', 'bytes');
  sandbox.fetch = async (url, options) => options.method === 'HEAD' ? response :
    { status: 200, headers: new Map(), body: { cancel: async () => {} } };
  await assert.rejects(fetchDisc(fetcher, app, '/disc.chd'), /requested PlayStation disc range/);
  assert.equal(app.wrcadPendingDisc, null);
  console.log('PASS PSX byte ranges, EOF, >4GB, LRU, BOM, malformed ranges, read-only mount, HEAD startup, unchanged UID, fallback and save-before-cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
