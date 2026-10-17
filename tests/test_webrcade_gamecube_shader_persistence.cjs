const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
(async () => {
  const {encodeShaderSnapshot,decodeShaderSnapshot,validShaderRecords,PersistentShaderTranslations,SHADER_CACHE_LIMITS} =
    await import(pathToFileURL(path.join(__dirname,'../deploy/webrcade/retro-dolphin/app/shader-translation-cache.mjs')));
  const build = 'a'.repeat(64), game = 'TEST01';
  const records = [{stage:0,variant:0,source:'vertex exact',wgsl:'@vertex fn main() {}'},
    {stage:2,variant:1,source:'fragment color variant',wgsl:'@fragment fn main() {}'}];
  const record = await encodeShaderSnapshot(build,game,records);
  assert.deepEqual(await decodeShaderSnapshot(record,build,game),records);
  for (const changed of [{hash:'b'.repeat(64)}, {build:'c'.repeat(64)}, {game:'OTHER1'},
    {schema:2}, {size:record.size-1}, {blob:new Blob(['corrupt'])}, {key:'other namespace'}])
    assert.equal(await decodeShaderSnapshot({...record,...changed},build,game),null);
  const noRead = new Blob([new Uint8Array(SHADER_CACHE_LIMITS.bytes+1)]);
  noRead.arrayBuffer = () => { throw Error('oversized Blob must never be read'); };
  assert.equal(await decodeShaderSnapshot({...record,size:noRead.size,blob:noRead},build,game),null);
  assert.equal(await decodeShaderSnapshot(record,'f'.repeat(64),game),null);
  assert.equal(await decodeShaderSnapshot(record,build,'OTHER1'),null);
  for (const bad of [null, {}, Array(257).fill(records[0]), [{...records[0],stage:4}],
    [{...records[0],variant:2}], [{...records[0],source:'\0'}], [{...records[0],wgsl:''}],
    [{...records[0],wgsl:'w'.repeat(SHADER_CACHE_LIMITS.bytes+1)}]])
    assert.equal(validShaderRecords(bad),false);
  const badJson = await encodeShaderSnapshot(build,game,[]);
  const garbage = new TextEncoder().encode('{bad json');
  badJson.blob = new Blob([garbage]); badJson.size = garbage.length;
  badJson.hash = Buffer.from(await crypto.subtle.digest('SHA-256',garbage)).toString('hex');
  assert.equal(await decodeShaderSnapshot(badJson,build,game),null);

  function native() {
    const cache = new Map();
    return {HEAPU8:new Uint8Array(4096), revision:0, allocations:0, imports:0, exports:0,
      _malloc() { this.allocations++; return 1; }, _free() { this.allocations--; },
      _DolphinWeb_ShaderTranslationRevision() { return this.revision; },
      _DolphinWeb_ImportShaderTranslation(stage,variant,s,n,w,m) {
        const decoder = new TextDecoder();
        const source = decoder.decode(this.HEAPU8.subarray(s,s+n));
        const wgsl = decoder.decode(this.HEAPU8.subarray(w,w+m));
        cache.set(JSON.stringify([stage,variant,source]),{stage,variant,source,wgsl});
        this.imports++; this.revision++; return 1;
      },
      _DolphinWeb_ExportShaderTranslations() { this.exports++; this._cloudrcadeShaderSnapshot = [...cache.values()]; },
      add(row) { cache.set(JSON.stringify([row.stage,row.variant,row.source]),row); this.revision++; }};
  }
  let disk = null, reads = 0, writes = 0;
  const storage = {async get() { reads++; return disk; }, async put(value) { writes++; disk = value; }};
  const first = native(), launch1 = new PersistentShaderTranslations(first,build,game,storage);
  await launch1.load();
  assert.equal(first.imports,0);
  first.add(records[0]); first.add(records[1]);
  launch1.checkpoint(9999); assert.equal(first.exports,0,'bounded snapshot frequency');
  launch1.checkpoint(10000);
  while (launch1.pending) await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes,1); assert.equal(launch1.stats.written,1);
  launch1.checkpoint(30000); assert.equal(first.exports,1,'unchanged cache has no export/write');
  const second = native(), launch2 = new PersistentShaderTranslations(second,build,game,storage);
  await launch2.load();
  assert.equal(reads,2); assert.equal(second.imports,2,'new module receives previous successful outputs');
  assert.equal(second.allocations,0); assert.equal(launch2.stats.loaded,2);
  launch2.checkpoint(30000); assert.equal(second.exports,0,'restore alone causes no redundant write');
  const corrupt = native(); disk = {...disk,hash:'b'.repeat(64)};
  await new PersistentShaderTranslations(corrupt,build,game,storage).load();
  assert.equal(corrupt.imports,0,'corruption leaves ordinary translation authoritative');
  const quota = new PersistentShaderTranslations(native(),build,game,
    {get:async()=>null,put:async()=>{ throw new DOMException('full','QuotaExceededError'); }});
  await quota.load(); quota.module.add(records[0]); quota.checkpoint(10000);
  while (quota.pending) await new Promise(resolve => setImmediate(resolve));
  assert.equal(quota.stats.errors,1); assert.equal(quota.stats.written,0); assert.equal(quota.ready,false);
  const denied = new PersistentShaderTranslations(native(),build,game,
    {get:async()=>{throw Error('denied');}});
  await denied.load(); assert.equal(denied.ready,false); assert.equal(denied.stats.errors,1);
  console.log('PASS GameCube persistent WGSL build/game identity, integrity, bounded decode, cold reload, write gating and quota/denial fallback');
})().catch(error => {console.error(error);process.exitCode=1;});
