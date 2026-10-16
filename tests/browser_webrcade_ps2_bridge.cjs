/* Shared native payload ownership across queued work, memory growth and GPU
 * fences, in Chromium/WebKit. Real adapter module; no emulator/GPU is loaded.
 * WEBRCADE_TEST_ORIGIN and optional PS2_BRIDGE_APP select exact/source assets.
 * WEBRCADE_CHROMIUM_EXECUTABLE/WEBRCADE_WEBKIT_EXECUTABLE can select installed engines.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright');
(async()=>{for(const engine of [chromium,webkit]){
 const executablePath=process.env[engine===chromium?'WEBRCADE_CHROMIUM_EXECUTABLE':'WEBRCADE_WEBKIT_EXECUTABLE'];
 const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{}),...(engine===chromium?{args:['--no-sandbox']}:{})});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
  if(process.env.PS2_BRIDGE_APP)await context.route('**/gpu.mjs',async route=>{const response=await route.fetch();await route.fulfill({response,body:fs.readFileSync(process.env.PS2_BRIDGE_APP)});});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.WEBRCADE_TEST_ORIGIN+'/experimental/ps2/');
  const result=await page.evaluate(async()=>{
   const {Ps2Gpu}=await import('./gpu.mjs'),memory=new WebAssembly.Memory({initial:1,maximum:3,shared:true});
   const core={HEAPU8:new Uint8Array(memory.buffer)},expected=Uint8Array.from({length:4096},(_,i)=>(i*37+11)&255);
   core.HEAPU8.set(expected,1024);let copied=0,destroyed=0,releaseQueue,releaseFence,enteredFence;
   const fenceEntered=new Promise(resolve=>{enteredFence=resolve;}),failures=[];
   const gpu=new Ps2Gpu(core,error=>failures.push(error.message));
   gpu.module={HEAPU8:new Uint8Array(8*1048576),_malloc:()=>16,_free(){},_gpu_destroy(){destroyed++;},
    _gpu_batch(pointer,size){if(size!==expected.length||!expected.every((v,i)=>this.HEAPU8[pointer+i]===v))throw Error('Queued payload changed');copied++;return 7;},
    ccall(name){if(name!=='gpu_wait')throw Error('Unexpected operation');enteredFence();return new Promise(resolve=>{releaseFence=resolve;});}};
   gpu.chain=new Promise(resolve=>{releaseQueue=resolve;});gpu.nativeCall(8,1024,4096,0,128);
   const originalBuffer=core.HEAPU8.buffer;memory.grow(1);core.HEAPU8=new Uint8Array(memory.buffer);
   core.HEAPU8.fill(77,65536,65552);
   if(copied||Atomics.load(new Int32Array(core.HEAPU8.buffer),32))throw Error('Queue acknowledged early');
   releaseQueue();await fenceEntered;
   if(copied!==1||Atomics.load(new Int32Array(core.HEAPU8.buffer),32))throw Error('Fence acknowledged early');
   memory.grow(1);core.HEAPU8=new Uint8Array(memory.buffer);releaseFence();await gpu.chain;
   const acknowledged=Atomics.load(new Int32Array(core.HEAPU8.buffer),32);
   core.HEAPU8.fill(99,1024,5120); // The native producer may reuse its packet now.
   const retained=expected.every((v,i)=>gpu.module.HEAPU8[16+i]===v);
   await gpu.dispose();gpu.nativeCall(8,1024,4096,0,128);
   const queued=new Ps2Gpu(core,error=>failures.push(error.message)),received=[];let releaseQueued;
   queued.module={HEAPU8:new Uint8Array(8*1048576),_malloc:()=>16,_free(){},_gpu_destroy(){},_gpu_write(pointer,size){received.push([...this.HEAPU8.subarray(pointer,pointer+size*4)]);}};
   queued.chain=new Promise(resolve=>{releaseQueued=resolve;});
   core.HEAPU8.set([1,2,3,4],1024);queued.nativeCall(1,1024,4,0,128);core.HEAPU8.fill(0,1024,1028);
   core.HEAPU8.set([5,6,7,8],2048);queued.nativeCall(1,2048,4,0,132);core.HEAPU8.fill(0,2048,2052);
   releaseQueued();await queued.chain;await queued.dispose();
   Atomics.store(new Int32Array(core.HEAPU8.buffer),32,0);
   const rejected=new Ps2Gpu(core,error=>failures.push(error.message));
   rejected.module={HEAPU8:new Uint8Array(8*1048576),_malloc:()=>16,_free(){},_gpu_destroy(){destroyed++;},_gpu_batch(){throw Error('Owned bridge failure');}};
   rejected.nativeCall(8,1024,4096,0,128);await rejected.chain;
   const failedAck=Atomics.load(new Int32Array(core.HEAPU8.buffer),32);await rejected.dispose();
   return{copied,acknowledged,retained,grew:originalBuffer!==core.HEAPU8.buffer,destroyed,failedAck,failures,received};
  });
  assert.deepEqual(result,{copied:1,acknowledged:2,retained:true,grew:true,destroyed:2,failedAck:-1,failures:['Owned bridge failure'],received:[[1,2,3,4],[5,6,7,8]]});assert.deepEqual(errors,[]);
  console.log('PASS',engine.name(),'PS2 queued payload, shared-memory growth, deferred fence acknowledgement, failure and disposal');
 }finally{await browser.close();}
}})().catch(error=>{console.error(error);process.exitCode=1;});
