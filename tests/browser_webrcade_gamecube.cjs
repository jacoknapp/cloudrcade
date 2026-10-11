/* Real pinned Dolphin WASM/streaming with Null video for this headless check.
 * The product requires device WebGPU; this test does not qualify GPU gameplay.
 * Serve the prepared lab, then NODE_PATH=<Playwright modules> node this-file.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium,webkit} = require('playwright');
const origin = process.env.WEBRCADE_GAMECUBE_ORIGIN || 'http://127.0.0.1:18572';
(async () => {
  const app = process.env.WEBRCADE_GAMECUBE_ROOT || path.resolve(__dirname,'../release/gamecube/app');
  const fixtureName=`synthetic-${process.pid}.gcm`;
  const fixture=path.join(app,'fixtures',fixtureName);
  fs.mkdirSync(path.dirname(fixture),{recursive:true});
  const header=Buffer.alloc(0x2000); header.write('TEST01'); header.writeUInt32BE(0xc2339f3d,0x1c);
  header.write('CloudRcade synthetic DiscIO fixture',0x20);
  header.writeUInt32BE(0x1000,0x424); header.writeUInt32BE(12,0x428); header.writeUInt32BE(12,0x42c);
  header.writeUInt32BE(0x01000000,0x1000); header.writeUInt32BE(1,0x1008);
  const fd=fs.openSync(fixture,'wx');
  try {fs.writeSync(fd,header);fs.ftruncateSync(fd,64*1024*1024);} finally {fs.closeSync(fd);}
  try {
  for (const engine of [chromium,webkit]) {
    const browser = await engine.launch({headless:true,
      ...(engine === chromium ? {executablePath:process.env.CHROME,args:['--no-sandbox']} :
        {executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
    try {
      const context = await browser.newContext({serviceWorkers:'block'});
      const page = await context.newPage(); const errors=[]; const workers=new Set();
      page.on('pageerror',error=>errors.push(error.message));
      page.on('worker',worker=>{workers.add(worker);worker.on('close',()=>workers.delete(worker));});
      await page.goto(origin);
      assert(await page.evaluate(()=>crossOriginIsolated && isSecureContext));
      const hardware = await page.evaluate(async()=>{
        const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
        const info=adapter?.info;
        return !!adapter && !info?.isFallbackAdapter && !adapter.isFallbackAdapter &&
          !/swiftshader|llvmpipe|lavapipe|software/i.test(info?.description || '');
      });
      if (!hardware) {
        await page.getByRole('button',{name:'Initialize core',exact:true}).click();
        await page.getByRole('status').filter({hasText:/requires browser WebGPU|device GPU/}).waitFor({timeout:90000});
        assert.equal(workers.size,0,'unsupported GPU does not start a core worker');
      }
      for (let attempt=0;attempt<2;attempt++) {
        const result = await page.evaluate(async fixtureName => {
          const {UpstreamWorkerAdapter}=await import('./vendor/src/upstream-worker-adapter.js');
          const {remoteDisc}=await import('./transport.mjs');
          const adapter=new UpstreamWorkerAdapter({videoBackend:'Null',noJitCache:true,ppcWasmJit:false});
          try {
            await Promise.race([adapter.load(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Core load timed out')),60000))]);
            const disc=await remoteDisc('/fixtures/'+fixtureName);
            const metadata=await adapter.request('mountUrl',{name:disc.name,url:disc.url,size:disc.size,inspectOnly:true});
            const stats=await adapter.request('streamStats');
            return {loaded:adapter.loaded,gameId:metadata.gameId,boot:metadata.coreBoot,
              stream:stats.stream};
          } finally { adapter.rejectAll('test exit'); adapter.worker?.terminate(); }
        },fixtureName);
        assert.equal(result.loaded,true); assert.equal(result.gameId,'TEST01');
        assert.equal(result.boot.accepted,false,'inspection is never reported as gameplay');
        assert.equal(result.stream.chunkSize,2*1024*1024); assert.equal(result.stream.maxChunks,8);
        assert.equal(result.stream.fileContentsBuffered,false,'the real Emscripten file is range-backed');
        assert(result.stream.cachedBytes <= 16*1024*1024);
        assert(result.stream.bytesFetched < result.stream.size,'real WASM inspected a streamed disc without fetching it all');
        for(let retry=0;retry<20 && workers.size;retry++) await page.waitForTimeout(100);
        assert.equal(workers.size,0,'all owned core workers exit');
      }
      // Unsupported images must be rejected before a worker starts.
      await page.locator('#disc').setInputFiles({name:'invalid.iso',mimeType:'application/octet-stream',buffer:Buffer.alloc(32)});
      await page.getByRole('status').filter({hasText:'no GameCube disc header'}).waitFor();
      assert.equal(workers.size,0); assert.equal(await page.locator('#boot').isDisabled(),true);
      assert.deepEqual(errors,[]);
      await context.close();
      console.log('PASS',engine.name(),'device-GPU guard, real Dolphin WASM/range-streamed DiscIO, reinitialization and worker cleanup; no GPU gameplay claim');
    } finally { await browser.close(); }
  }
  } finally {fs.unlinkSync(fixture);}
})().catch(error=>{console.error(error);process.exitCode=1;});
