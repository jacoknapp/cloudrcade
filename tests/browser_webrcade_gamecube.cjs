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
      // Selection can be cancelled before a session exists; stale fetches cannot
      // enable Boot or overwrite the next selection's status.
      await page.route('**/fixtures/hanging.gcm',()=>{});
      await page.locator('#url').fill('/fixtures/hanging.gcm');
      await page.locator('#selectUrl').click();
      await page.getByRole('status').filter({hasText:'Checking GameCube disc URL'}).waitFor();
      assert.equal(await page.locator('#close').isEnabled(),true);
      await page.locator('#close').click();
      await page.waitForTimeout(100);
      assert.equal(await page.getByRole('status').textContent(),'Core is stopped.');
      assert.equal(await page.locator('#boot').isDisabled(),true);
      await page.locator('#url').fill('/fixtures/'+fixtureName);
      await page.locator('#selectUrl').click();
      await page.getByRole('status').filter({hasText:'HTTP range streaming'}).waitFor();
      assert.equal(await page.locator('#boot').isEnabled(),true);
      const mismatch=await page.evaluate(async()=>{
        const {UpstreamWorkerAdapter}=await import('./vendor/src/upstream-worker-adapter.js');
        const adapter=new UpstreamWorkerAdapter({videoBackend:'Null',noJitCache:true,
          expectedCoreSha256:'0'.repeat(64)});
        try {await adapter.load();return 'unexpected acceptance';}
        catch(error){return error.message;}
        finally {adapter.rejectAll('integrity test exit');adapter.worker?.terminate();}
      });
      assert.match(mismatch,/Core WASM SHA-256 mismatch/,'downstream pin still rejects unexpected core bytes');
      for (let attempt=0;attempt<2;attempt++) {
        const result = await page.evaluate(async fixtureName => {
          const {UpstreamWorkerAdapter}=await import('./vendor/src/upstream-worker-adapter.js');
          const {remoteDisc}=await import('./transport.mjs');
          const adapter=new UpstreamWorkerAdapter({videoBackend:'Null',noJitCache:true,ppcWasmJit:false});
          try {
            await Promise.race([adapter.load(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Core load timed out')),60000))]);
            await adapter.request('importCards',{files:[{name:'JAP/Card A/任天堂 & fixture.gci',content:new Uint8Array([1,2,3,4])}]});
            const cards=await adapter.request('exportCards');
            if(cards.files.length!==1 || cards.files[0].content.join(',')!=='1,2,3,4')throw new Error('Memory card filesystem roundtrip failed');
            try { await adapter.request('importCards',{files:[{name:'../../invalid.gci',content:new Uint8Array(1)}]});throw new Error('Invalid card path accepted'); }
            catch(error){if(!/Invalid memory card path/.test(error.message))throw error;}
            const disc=await remoteDisc('/fixtures/'+fixtureName);
            const metadata=await adapter.request('mountUrl',{name:disc.name,url:disc.url,size:disc.size,validator:disc.validator,inspectOnly:true});
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
      // Exercise the actual blocking bridge without loading Dolphin: the
      // asynchronous helper rejects changed files before buffering the body.
      const changed = await page.evaluate(async fixtureName => {
        const {remoteDisc}=await import('./transport.mjs');
        const disc=await remoteDisc('/fixtures/'+fixtureName);
        const code=`import {RangeReader} from ${JSON.stringify(new URL('./range-reader.mjs',location.href).href)};
          onmessage=async({data})=>{const reader=new RangeReader(2*1024*1024,5000);
            try {await reader.ready;reader.read(data);postMessage('unexpected success');}
            catch(error){postMessage(error.message);}finally{reader.close();}};`;
        const blobUrl=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
        const worker=new Worker(blobUrl,{type:'module'});
        try { return await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('range bridge did not respond')),10000);
          worker.onmessage=({data})=>{clearTimeout(timer);resolve(data);};
          worker.onerror=error=>{clearTimeout(timer);reject(new Error(error.message));};
          worker.postMessage({url:disc.url,size:disc.size,first:0,last:31,
            validator:{header:'ETag',value:'"changed-disc"'}});
        }); }finally{worker.terminate();URL.revokeObjectURL(blobUrl);}
      },fixtureName);
      assert.match(changed,/changed or returned an invalid HTTP/);
      for(let retry=0;retry<20 && workers.size;retry++) await page.waitForTimeout(100);
      assert.equal(workers.size,0,'nested range workers are cleaned up after success and failure');
      // Isolated UI test doubles exercise input/pause behavior. They provide
      // no renderer, GPU, or evidence of real game compatibility.
      await page.evaluate(async()=>{
        const {GameCubeSession}=await import('./session.mjs');
        window.uiCalls={inputs:[],polls:0,pauses:0};
        GameCubeSession.prototype.boot=async function() {
          this.booted=true;window.uiSession=this;
          this.adapter={setInputState(state){uiCalls.inputs.push({...state});},
            applyFrame(){},async request(type){if(type==='pause'){uiCalls.pauses++;if(window.delayPause)await new Promise(resolve=>window.releasePause=resolve);}if(type==='runFrame')uiCalls.polls++;return {};},pause(){uiCalls.pauses++;},start(){},rejectAll(){}};
          return {gameId:'TEST01'};
        };
      });
      await page.locator('#url').fill('/fixtures/'+fixtureName);
      await page.locator('#selectUrl').click();
      await page.getByRole('status').filter({hasText:'HTTP range streaming'}).waitFor();
      await page.locator('#boot').click();
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(()=>document.activeElement.id),'screen');
      await page.locator('#screen').focus();
      await page.keyboard.down('x');
      await page.waitForFunction(()=>uiCalls.inputs.at(-1).mask===1,null,{timeout:3000});
      assert.equal(await page.evaluate(()=>uiCalls.inputs.at(-1).mask),1,'keyboard works after button focus');
      await page.keyboard.up('x');
      await page.waitForFunction(()=>uiCalls.inputs.at(-1).mask===0,null,{timeout:3000});
      assert.equal(await page.evaluate(()=>uiCalls.inputs.at(-1).mask),0);
      const inputCount=await page.evaluate(()=>uiCalls.inputs.length);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(()=>uiCalls.inputs.length),inputCount,'unchanged frames bypass adapter input');
      await page.evaluate(()=>WrcadGameCube.togglePause());
      const pollCount=await page.evaluate(()=>uiCalls.polls);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(()=>uiCalls.polls),pollCount,'pause stops the animation/poll loop');
      await page.evaluate(()=>WrcadGameCube.togglePause()); await page.waitForTimeout(100);
      assert(await page.evaluate(count=>uiCalls.polls>count,pollCount),'resume restarts polling');
      // Exercise the shipped app's lifecycle handlers, including a return
      // before the native worker acknowledges its background pause.
      await page.evaluate(()=>{
        window.testHidden=true;window.delayPause=true;
        Object.defineProperty(document,'hidden',{configurable:true,get:()=>testHidden});
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForFunction(()=>typeof releasePause==='function');
      assert.equal(await page.evaluate(()=>app.isPauseScreen()),false,'backgrounding does not open the menu');
      await page.evaluate(()=>{testHidden=false;document.dispatchEvent(new Event('visibilitychange'));delayPause=false;releasePause();});
      await page.waitForFunction(()=>!uiSession.paused);
      const returnedPolls=await page.evaluate(()=>uiCalls.polls);
      await page.waitForFunction(count=>uiCalls.polls>count,returnedPolls);
      await page.evaluate(()=>dispatchEvent(new Event('blur')));
      await page.waitForFunction(()=>uiSession.paused);
      await page.evaluate(()=>dispatchEvent(new Event('focus')));
      await page.waitForFunction(()=>!uiSession.paused);
      await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
      await page.waitForFunction(()=>uiSession.paused);
      assert.equal(await page.evaluate(()=>WrcadGameCube.ready),true,'persisted page retains the worker');
      await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
      await page.waitForFunction(()=>!uiSession.paused);
      await page.evaluate(()=>WrcadGameCube.showPauseMenu());
      await page.getByRole('button',{name:/^Resume/}).waitFor();
      await page.evaluate(()=>{testHidden=true;document.dispatchEvent(new Event('visibilitychange'));testHidden=false;document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('focus'));});
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(()=>uiSession.paused&&app.isPauseScreen()),true,'return preserves deliberate menu pause');
      await page.getByRole('button',{name:/^Resume/}).click();
      await page.waitForFunction(()=>!uiSession.paused&&!app.isPauseScreen());
      await page.evaluate(async()=>{
        const {AudioController}=await import('./vendor/src/audio.js');
        window.originalEnsureContext=AudioController.prototype.ensureContext;
        AudioController.prototype.ensureContext=()=>new Promise(()=>{});
        testHidden=true;document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForFunction(()=>uiSession.paused);
      await page.evaluate(()=>{testHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
      await page.waitForFunction(()=>!uiSession.paused);
      await page.evaluate(()=>{testHidden=true;document.dispatchEvent(new Event('visibilitychange'));});
      await page.waitForFunction(()=>uiSession.paused,null,{timeout:3000});
      await page.evaluate(async()=>{
        const {AudioController}=await import('./vendor/src/audio.js');
        AudioController.prototype.ensureContext=originalEnsureContext;
        testHidden=false;document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForFunction(()=>!uiSession.paused);
      await page.evaluate(()=>delete document.hidden);
      await page.evaluate(()=>uiSession.fail(new Error('Synthetic WebGPU device loss')));
      await page.getByRole('alert').filter({hasText:'Synthetic WebGPU device loss'}).waitFor();
      assert.equal(await page.evaluate(()=>WrcadGameCube.ready),false,'failed worker is stopped');
      await page.getByRole('button',{name:'Restart game',exact:true}).click();
      await page.waitForFunction(()=>WrcadGameCube.ready);
      assert.equal(await page.locator('#gamecube-failure').isVisible(),false);
      await page.evaluate(()=>WrcadGameCube.exit());
      assert.deepEqual(errors,[]);
      await context.close();
      const failureContext=await browser.newContext({serviceWorkers:'block'});
      const failedPage=await failureContext.newPage();
      await failedPage.route('**/library-invalid.iso',route=>route.fulfill({status:206,
        headers:{'Content-Range':'bytes 0-31/50000001',ETag:'"invalid-disc"'},body:Buffer.alloc(32)}));
      const launch=Buffer.from(encodeURIComponent(JSON.stringify({rom:origin+'/library-invalid.iso',
        title:'Invalid library fixture'}))).toString('base64');
      await failedPage.goto(origin+'/?props='+encodeURIComponent(launch));
      await failedPage.getByRole('alert').filter({hasText:'no GameCube disc header'}).waitFor();
      assert.equal(await failedPage.getByRole('button',{name:'Restart game',exact:true}).isVisible(),false);
      await failedPage.getByRole('button',{name:'Return to library',exact:true}).click();
      await failedPage.waitForURL('**/play/');
      await failureContext.close();
      console.log('PASS',engine.name(),'device-GPU guard, real Dolphin WASM/range-streamed DiscIO, reinitialization and worker cleanup; no GPU gameplay claim');
    } finally { await browser.close(); }
  }
  } finally {fs.unlinkSync(fixture);}
})().catch(error=>{console.error(error);process.exitCode=1;});
