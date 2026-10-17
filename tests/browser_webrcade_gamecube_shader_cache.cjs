// Own disposable localhost IndexedDB only. No runtime, GPU, ROMs or accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path'), os = require('node:os');
const {chromium,webkit} = require('playwright');
(async () => {
  const source = fs.readFileSync(path.join(__dirname,'../deploy/webrcade/retro-dolphin/app/shader-translation-cache.mjs'));
  const server = http.createServer((req,res) => {
    res.setHeader('Content-Type',req.url === '/cache.mjs' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/cache.mjs' ? source : '<!doctype html><title>Owned shader cache fixture</title>');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    for (const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
      const executablePath = process.env['GC_SHADER_CACHE_' + name.toUpperCase()];
      const profile = fs.mkdtempSync(path.join(os.tmpdir(),'gc-shader-idb-'));
      const context = await engine.launchPersistentContext(profile,{...(executablePath ? {executablePath} : {}),
        ...(name === 'chromium' ? {args:['--no-sandbox','--disable-gpu']} : {})});
      try {
        const page = await context.newPage();
        await page.goto('http://127.0.0.1:' + server.address().port);
        const result = await page.evaluate(async () => {
          const {ShaderSnapshotStorage,encodeShaderSnapshot,decodeShaderSnapshot} = await import('/cache.mjs');
          const storage = new ShaderSnapshotStorage(), build = 'a'.repeat(64);
          const shader = [{stage:0,variant:0,source:'exact GLSL',wgsl:'exact WGSL'}];
          const keys = [];
          for (let i = 0; i < 6; ++i) {
            const record = await encodeShaderSnapshot(build,'TEST0'+i,shader);
            record.used = i+1; keys.push(record.key);
            try { await storage.put(record); }
            catch (error) { throw new Error('put ' + i + ': ' + error); }
          }
          const present = [];
          for (const key of keys) {
            try { present.push(Boolean(await storage.get(key))); }
            catch (error) { throw new Error('get ' + key + ': ' + error); }
          }
          const stored = await storage.get(keys[5]);
          const decoded = await decodeShaderSnapshot(stored,build,'TEST05');
          // Read across a fresh controller/connection, then corrupt the Blob.
          const second = new ShaderSnapshotStorage();
          const fresh = await decodeShaderSnapshot(await second.get(keys[5]),build,'TEST05');
          const db = await storage.open();
          await new Promise((resolve,reject) => {
            const tx = db.transaction('snapshots','readwrite');
            tx.objectStore('snapshots').put({...stored,blob:new Blob(['bad'])});
            tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
          });
          db.close();
          const corrupted = await decodeShaderSnapshot(await storage.get(keys[5]),build,'TEST05');
          return {present,decoded,fresh,corrupted};
        });
        assert.deepEqual(result.present,[false,false,true,true,true,true]);
        assert.equal(result.decoded[0].wgsl,'exact WGSL');
        assert.deepEqual(result.fresh,result.decoded); assert.equal(result.corrupted,null);
        console.log('PASS ' + name + ' real IndexedDB bounded eviction, fresh-connection restore and corrupted-Blob fallback');
      } finally { await context.close(); fs.rmSync(profile,{recursive:true,force:true}); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => {console.error(error);process.exitCode=1;});
