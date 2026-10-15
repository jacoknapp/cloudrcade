/* Device WebGPU GS conformance: raster/VRAM, partial 24-bit uploads, state restore,
 * two display circuits with alpha composition, and explicit device-loss handling.
 * Run on an owned hardware-GPU browser, never against an operator profile.
 */
const assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME,args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({ignoreHTTPSErrors:true}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){if(/webgl/i.test(kind))throw new Error('Unexpected WebGL context');return original.call(this,kind,...args);};});
  await page.goto((process.env.WEBRCADE_TEST_ORIGIN||'https://localhost:8443')+'/experimental/ps2/');
  const result=await page.evaluate(async(useBatch)=>{
   const {default:Gpu}=await import('./core/Gpu.js'),failures=[];
   const m=await Gpu({canvas:document.getElementById('outputCanvas'),onGpuError:error=>failures.push(error)});
   if(!await m.ccall('gpu_init','number',[],[],{async:true}))throw Error('No device WebGPU');
   await m.ccall('gpu_reset',null,[],[],{async:true});
   const p=m._malloc(8*1024*1024),regs=[],queued=[];
   function enqueue(op,bytes){queued.push({op,bytes:new Uint8Array(bytes)});}
   function drain(){
    if(!queued.length)return 1;
    const words=new Uint32Array(queued.reduce((n,r)=>n+2+Math.ceil(r.bytes.length/4),0));
    let cursor=0;
    for(const {op,bytes} of queued){words[cursor++]=op;words[cursor++]=bytes.length;new Uint8Array(words.buffer,cursor*4,bytes.length).set(bytes);cursor+=Math.ceil(bytes.length/4);}
    m.HEAPU8.set(new Uint8Array(words.buffer),p);queued.length=0;return m._gpu_batch(p,words.byteLength);
   }
   function image(bytes){if(useBatch)enqueue(2,bytes);else{m.HEAPU8.set(bytes,p);m._gpu_image(p,bytes.length);}}
   function write(reg,value){value=BigInt(value);regs.push(reg,Number(value&0xffffffffn),Number(value>>32n));}
   function flush(){const bytes=new Uint8Array(new Uint32Array(regs).buffer);if(useBatch)enqueue(1,bytes);else{m.HEAPU8.set(bytes,p);m._gpu_write(p,regs.length);}regs.length=0;}
   async function download(){drain();await m.ccall('gpu_download',null,['number'],[p],{async:true});return m.HEAPU8.slice(p,p+4*1024*1024);}
   write(0x1a,1);write(0x46,1);write(0x4c,1<<16);write(0x4e,1n<<32n);write(0x40,(63n<<48n)|(63n<<16n));write(0x47,0x30000);
   write(0x01,0x3f80000080204080n);write(0x00,6);write(0x05,0);write(0x05,0x100010);flush();
   const raster=Array.from((await download()).subarray(0,4));
   // A 9-byte PSMCT24 transfer paused after one pixel and one remainder byte.
   write(0x50,(0x100n<<32n)|(1n<<48n)|(1n<<56n));write(0x51,0);write(0x52,3n|(1n<<32n));write(0x53,0);flush();
   image([10,20,30,40]);drain();
   const stateLength=m._gpu_state_size(),stateAddress=await m.ccall('gpu_save','number',[],[],{async:true}),state=m.HEAPU8.slice(stateAddress,stateAddress+stateLength);
   image([1,2,3,4,5]);drain();
   m.HEAPU8.set(state,p);await m.ccall('gpu_load',null,['number','number'],[p,state.length],{async:true});
   image([50,60,70,80,90]);
   const vram=await download(),partial=[...vram.subarray(65536,65539),...vram.subarray(65540,65543),...vram.subarray(65552,65555)];
   // Upload two single-pixel display buffers, then blend blue over red at 50%.
   function upload(bp,color){write(0x50,(BigInt(bp)<<32n)|(1n<<48n));write(0x51,0);write(0x52,1n|(1n<<32n));write(0x53,0);flush();image(color);}
   upload(0,[255,0,0,128]);upload(32,[0,0,255,128]);
   const packet=new Uint32Array([1,1,1,0,0,1,1,0,1,0,1,128,0,0,1,0,0,1,1,32,1,0,1,64,0,0]);
   if(useBatch)enqueue(3,new Uint8Array(packet.buffer));else m.HEAPU8.set(new Uint8Array(packet.buffer),p);
   const composed=await new Promise((resolve,reject)=>requestAnimationFrame(()=>{if(useBatch){if(drain()!==7){reject(Error('Batched display not presented'));return;}}else m._gpu_present(p);const c=document.createElement('canvas');c.width=640;c.height=480;const ctx=c.getContext('2d');ctx.drawImage(document.getElementById('outputCanvas'),0,0);resolve(Array.from(ctx.getImageData(320,240,1,1).data));}));
   await m.ccall('gpu_wait',null,[],[],{async:true});
   const malformed=[];
   if(useBatch)for(const words of [[99,0],[1,1,0],[2,8,0],[3,104],[2], [3,104,...Array(26).fill(0),2,0]]){
    m.HEAPU8.set(new Uint8Array(new Uint32Array(words).buffer),p);
    let rejected=false;try{m._gpu_batch(p,words.length*4);}catch(error){rejected=true;}
    if(!rejected)throw Error('Malformed GS batch accepted');malformed.push(words[0]);
   }
   const beforeLoss=failures.slice();m._gpu_destroy();await new Promise(resolve=>setTimeout(resolve,100));m._free(p);
   return {raster,partial,composed,malformed,beforeLoss,loss:failures};
  },process.env.PS2_GPU_BATCH==='1');
  if(process.env.PS2_GPU_BATCH==='1')assert.equal(result.malformed.length,6);
  assert.deepEqual(result.raster,[128,64,32,128]);assert.deepEqual(result.partial,[10,20,30,40,50,60,70,80,90]);
  assert(result.composed[0]>=126&&result.composed[0]<=128&&result.composed[1]===0&&result.composed[2]>=126&&result.composed[2]<=128&&result.composed[3]===255,JSON.stringify(result.composed));
  assert.deepEqual(result.beforeLoss,[]);assert(result.loss.some(message=>/device lost/i.test(message)));assert.deepEqual(errors,[]);
  console.log('PASS PS2 hardware WebGPU raster, swizzled VRAM, partial upload state, dual-circuit alpha composition and device loss',JSON.stringify(result));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
