const assert = require('node:assert/strict');
const {fixture} = require('./test_webrcade_recent.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const key = i => JSON.stringify(['nes', 'rom', `https://games.example/${i}.nes`]);
const error = status => Object.assign(new Error('test transport'), {status});
const server = new Map();
function client(uid = 'alice') {
  let revision;
  return {
    uid, offline: false, conflicts: 0,
    controlsAccount() { return this.uid; },
    async loadRecent() {
      if (this.offline) throw error(502);
      const record = server.get(this.uid);revision = record?.revision || 0;
      if (this.onLoad) await this.onLoad();
      if (!record) throw error(404);
      return copy(record.doc);
    },
    async saveRecent(doc) {
      if (this.offline) throw error(502);
      if (this.onSave) { const fn = this.onSave;this.onSave = null;await fn(); }
      if ((server.get(this.uid)?.revision || 0) !== revision) { this.conflicts++;throw error(409); }
      server.set(this.uid, {revision: ++revision, doc: copy(doc)});
    }
  };
}
(async () => {
  const ca = client(), a = fixture({cloud: ca, raw: JSON.stringify([key(0), key(1)])});
  await a.sync();
  assert.deepEqual(server.get('alice').doc.entries.map(e => e.key), [key(0), key(1)]);
  const cb = client(), b = fixture({cloud: cb});await b.sync();
  assert.deepEqual(JSON.parse(b.raw()), [key(0), key(1)]);
  assert.equal(b.browse.state.menuMode, 'categories');
  assert.equal(b.browse.state.currentItem.title, 'Recently Played');
  ca.offline = true;a.launch(a.items[2]);await a.sync();assert.equal(ca.recentStatus, 'pending');
  b.launch(b.items[3]);await b.sync();
  const restarted = fixture({cloud: ca, raw: a.raw(), data: new Map(a.data)});
  ca.offline = false;await restarted.sync();
  assert.deepEqual(new Set(server.get('alice').doc.entries.map(e => e.key)), new Set([0,1,2,3].map(key)));
  // The first write loses an ETag race; retry must retain both devices' plays.
  ca.onSave = async () => { b.launch(b.items[4]);await b.sync(); };
  restarted.launch(restarted.items[5]);await restarted.sync();
  assert.equal(ca.conflicts, 1);
  assert(server.get('alice').doc.entries.some(e => e.key === key(4)));
  assert(server.get('alice').doc.entries.some(e => e.key === key(5)));
  // A launch during upload stays local and is included in the next sync.
  ca.onSave = () => restarted.launch(restarted.items[7]);
  restarted.launch(restarted.items[6]);await restarted.sync();await restarted.sync();
  assert(server.get('alice').doc.entries.some(e => e.key === key(7)));
  for (const item of restarted.items) restarted.launch(item);
  await restarted.sync();assert.equal(server.get('alice').doc.entries.length, 20);
  assert.equal(server.get('alice').doc.entries[0].key, key(24));
  restarted.launch(restarted.items[5]);await restarted.sync();
  assert.equal(server.get('alice').doc.entries[0].key, key(5));
  assert.equal(new Set(server.get('alice').doc.entries.map(e => e.key)).size, 20);
  // Switching accounts restores only that account; disconnected play imports once.
  const aliceDoc = copy(server.get('alice').doc);
  ca.uid = 'bob';await restarted.sync();assert.deepEqual(JSON.parse(restarted.raw()), []);
  restarted.launch(restarted.items[22]);await restarted.sync();
  assert.deepEqual(server.get('bob').doc.entries.map(e => e.key), [key(22)]);
  assert.deepEqual(server.get('alice').doc, aliceDoc);
  ca.uid = null;await restarted.sync();assert.deepEqual(JSON.parse(restarted.raw()), []);
  restarted.launch(restarted.items[23]);ca.uid = 'bob';await restarted.sync();
  assert.deepEqual(new Set(server.get('bob').doc.entries.map(e => e.key)), new Set([key(22),key(23)]));
  ca.uid = 'alice';await restarted.sync();assert.deepEqual(server.get('alice').doc, aliceDoc);
  // A failed/unknown document must never be replaced by an empty local history.
  server.set('broken', {revision: 1, doc: {version: 2, entries: []}});
  ca.uid = 'broken';await restarted.sync();assert.equal(ca.recentStatus, 'pending');
  assert.equal(server.get('broken').doc.version, 2);
  server.set('badentries', {revision: 1, doc: {version: 1, entries: [null, {key: key(0), playedAt: -1}, {key: key(1), playedAt: 'yesterday'}, {key: key(2), playedAt: 1}]}});
  ca.uid = 'badentries';await restarted.sync();assert.deepEqual(JSON.parse(restarted.raw()), [key(2)]);
  // Account changes while a download is pending cannot upload its result elsewhere.
  ca.uid = 'alice';let release;ca.onLoad = () => new Promise(resolve => {release = resolve;});
  const pending = restarted.sync();await Promise.resolve();ca.uid = 'charlie';release();await pending;ca.onLoad = null;
  await restarted.sync();assert.deepEqual(JSON.parse(restarted.raw()), []);assert(!server.has('charlie'));
  console.log('PASS Nextcloud migration/second browser, offline restart merge, conditional-write retry, in-flight play, MRU cap/dedup, account isolation, invalid documents and account changes during requests');
})().catch(error => { console.error(error);process.exitCode = 1; });
