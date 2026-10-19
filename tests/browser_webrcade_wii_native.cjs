// Real Wii WASM/controller report builder and streaming. Synthetic disc, no gameplay claim.
const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const origin=process.env.WEBRCADE_WII_ORIGIN||'https://127.0.0.1:18573';
const app=process.env.WEBRCADE_WII_ROOT||path.resolve(__dirname,'../release/wii/app');
(async()=>{
 const fixture=path.join(app,'fixtures',`wii-fixture-${process.pid}.iso`);fs.mkdirSync(path.dirname(fixture),{recursive:true});
 const header=Buffer.alloc(0x100);header.write('TEST01');header.writeUInt32BE(0x5d1c9ea3,0x18);header.write('Wii synthetic DiscIO fixture',0x20);
 const fd=fs.openSync(fixture,'wx');try{fs.writeSync(fd,header);fs.ftruncateSync(fd,5*1024**3);}finally{fs.closeSync(fd);}
 try{for(const engine of [chromium,webkit]){
  const browser=await engine.launch(engine===chromium?{executablePath:process.env.CHROME,args:['--no-sandbox']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH});
  try{
   const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/experimental/wii/');
   await page.getByRole('status').filter({hasText:'Enable Wii (experimental)'}).waitFor();
   assert(await page.evaluate(()=>!!window.WrcadWii&&!window.WrcadGameCube),'Wii has its own controller interface');
   await page.getByRole('button',{name:'Initialize core',exact:true}).click();
   assert.equal(page.workers().length,0,'disabled experiment never starts a worker');
   await page.evaluate(()=>localStorage.setItem((WrcadCloudConfig.storagePrefix||'webrcade')+'.wii.enabled.v1','1'));
   const result=await page.evaluate(async name=>{
    const {UpstreamWorkerAdapter}=await import('./vendor/src/upstream-worker-adapter.js');
    const {padState,applyMotion,BUTTONS}=await import('./input.mjs');
    const {PERF_KEY,GameCubePerf}=await import('./perf.mjs');const element={};new GameCubePerf(element).reset();
    const {inspectDisc}=await import('./session.mjs');const {remoteDisc}=await import('./transport.mjs');
    const adapter=new UpstreamWorkerAdapter({videoBackend:'Null',ppcWasmJit:false,noJitCache:true});
    try{
     await adapter.load();
     const initial=(await adapter.request('wiiInputProbe')).report;
     adapter.setInputState(padState());const rest=(await adapter.request('wiiInputProbe')).report;
     const input=applyMotion(padState(new Set(['A','B','X','Y','START','Z','HOME','L','R','D_UP','STICK_UP'])),{active:true,down:false,x:.75,y:.25,dx:.5,dy:-.5});
     adapter.setInputState(input);const report=(await adapter.request('wiiInputProbe')).report;
     const files=[{name:'00010000/54455354/data/progress.bin',content:new Uint8Array([9,8,7])}];
     await adapter.request('importNand',{files});const nand=await adapter.request('exportNand');
     let rejected=false;try{await adapter.request('importNand',{files:[{name:'../../keys.bin',content:new Uint8Array(1)}]});}catch(e){rejected=/Invalid Wii save path/.test(e.message);}
     let rejectedGC=false;const gc=new Uint8Array(32);new DataView(gc.buffer).setUint32(28,0xc2339f3d);
     try{await inspectDisc({name:'cube.iso',size:32,slice:()=>new Blob([gc])});}catch(e){rejectedGC=/no Wii disc header/.test(e.message);}
     const disc=await remoteDisc('./fixtures/'+name);
     const mounted=await adapter.request('mountUrl',{...disc,inspectOnly:true});
     const stats=await adapter.request('streamStats');
     return {initial,rest,report,perfKey:PERF_KEY,perfText:element.textContent,nand:nand.files.map(f=>({name:f.name,bytes:Array.from(f.content)})),rejected,rejectedGC,remote:disc.remote,size:disc.size,gameId:mounted.gameId,platform:mounted.platform,boot:mounted.coreBoot,stream:stats.stream};
    }finally{adapter.rejectAll('Wii native fixture exit');adapter.worker?.terminate();}
   },path.basename(fixture));
   assert.equal(result.perfKey,'cloudrcade-wii-beta.wii.perf.v1');assert.match(result.perfText,/^Wii measuring/,'Wii owns its experimental performance overlay');
   assert.deepEqual(result.initial,result.rest,'neutral Wii motion is installed before any disc boots');
   assert.deepEqual(result.rest.slice(0,4),[0,512,512,616],'native neutral accelerometer is 0g/0g/1g');
   assert.deepEqual(result.rest.slice(4,8),[65535,65535,65535,65535],'no pointer produces no IR objects');
   assert.deepEqual(result.rest.slice(8,11),[128,128,0]);
   assert.equal(result.report[0],0x0800|0x0400|0x0200|0x0100|0x10|0x1000|0x8000|0x08,'actual Wii Remote button bits');
   assert(result.report[4]<result.report[6]&&result.report[7]>=0&&result.report[7]<768,'native paired IR sensor points');
   assert.deepEqual(result.report.slice(8,12),[128,224,3,1],'native Nunchuk stick/C/Z and MotionPlus attachment');
   assert.deepEqual(result.nand,[{name:'00010000/54455354/data/progress.bin',bytes:[9,8,7]}]);
   assert(result.rejected&&result.rejectedGC&&result.remote);assert.equal(result.size,5*1024**3,'Wii disc sizes survive beyond4GiB');assert.equal(result.gameId,'TEST01');assert.equal(result.platform,'Wii');assert.equal(result.boot.accepted,false,'disc inspection is not gameplay');
   assert(result.stream.cachedChunks<=8);assert(result.stream.cachedBytes<=16*1024*1024);
   assert.deepEqual(errors,[]);await context.close();console.log('PASS',engine.name(),'actual Wii WASM initialization, Remote/Nunchuk report output, accelerometer/IR, NAND roundtrip, path rejection, ISO inspection and bounded streaming');
  }finally{await browser.close();}
 }}finally{fs.unlinkSync(fixture);}
})().catch(e=>{console.error(e);process.exitCode=1;});
