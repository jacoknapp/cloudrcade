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
  const result=await page.evaluate(async()=>{
   const {default:Gpu}=await import('./core/Gpu.js'),failures=[];
   const m=await Gpu({canvas:document.getElementById('outputCanvas'),onGpuError:error=>failures.push(error)});
   if(!await m.ccall('gpu_init','number',[],[],{async:true}))throw Error('No device WebGPU');
   await m.ccall('gpu_reset',null,[],[],{async:true});
   const p=m._malloc(8*1024*1024),regs=[];
   function write(reg,value){value=BigInt(value);regs.push(reg,Number(value&0xffffffffn),Number(value>>32n));}
   function flush(){m.HEAPU8.set(new Uint8Array(new Uint32Array(regs).buffer),p);m._gpu_write(p,regs.length);regs.length=0;}
   async function download(){await m.ccall('gpu_download',null,['number'],[p],{async:true});return m.HEAPU8.slice(p,p+4*1024*1024);}
   write(0x1a,1);write(0x46,1);write(0x4c,1<<16);write(0x4e,1n<<32n);write(0x40,(63n<<48n)|(63n<<16n));write(0x47,0x30000);
   write(0x01,0x3f80000080204080n);write(0x00,6);write(0x05,0);write(0x05,0x100010);flush();
   const raster=Array.from((await download()).subarray(0,4));
   // A 9-byte PSMCT24 transfer paused after one pixel and one remainder byte.
   write(0x50,(0x100n<<32n)|(1n<<48n)|(1n<<56n));write(0x51,0);write(0x52,3n|(1n<<32n));write(0x53,0);flush();
   m.HEAPU8.set([10,20,30,40],p);m._gpu_image(p,4);
   const stateLength=m._gpu_state_size(),stateAddress=await m.ccall('gpu_save','number',[],[],{async:true}),state=m.HEAPU8.slice(stateAddress,stateAddress+stateLength);
   m.HEAPU8.set([1,2,3,4,5],p);m._gpu_image(p,5);
   m.HEAPU8.set(state,p);await m.ccall('gpu_load',null,['number','number'],[p,state.length],{async:true});
   m.HEAPU8.set([50,60,70,80,90],p);m._gpu_image(p,5);
   const vram=await download(),partial=[...vram.subarray(65536,65539),...vram.subarray(65540,65543),...vram.subarray(65552,65555)];
   // Upload two single-pixel display buffers, then blend blue over red at 50%.
   function upload(bp,color){write(0x50,(BigInt(bp)<<32n)|(1n<<48n));write(0x51,0);write(0x52,1n|(1n<<32n));write(0x53,0);flush();m.HEAPU8.set(color,p);m._gpu_image(p,4);}
   upload(0,[255,0,0,128]);upload(32,[0,0,255,128]);
   const packet=new Uint32Array([1,1,1,0,0,1,1,0,1,0,1,128,0,0,1,0,0,1,1,32,1,0,1,64,0,0]);
   m.HEAPU8.set(new Uint8Array(packet.buffer),p);
   const composed=await new Promise(resolve=>requestAnimationFrame(()=>{m._gpu_present(p);const c=document.createElement('canvas');c.width=640;c.height=480;const ctx=c.getContext('2d');ctx.drawImage(document.getElementById('outputCanvas'),0,0);resolve(Array.from(ctx.getImageData(320,240,1,1).data));}));
   await m.ccall('gpu_wait',null,[],[],{async:true});
   const beforeLoss=failures.slice();m._gpu_destroy();await new Promise(resolve=>setTimeout(resolve,100));m._free(p);
   return {raster,partial,composed,beforeLoss,loss:failures};
  });
  assert.deepEqual(result.raster,[128,64,32,128]);assert.deepEqual(result.partial,[10,20,30,40,50,60,70,80,90]);
  assert(result.composed[0]>=126&&result.composed[0]<=128&&result.composed[1]===0&&result.composed[2]>=126&&result.composed[2]<=128&&result.composed[3]===255,JSON.stringify(result.composed));
  assert.deepEqual(result.beforeLoss,[]);assert(result.loss.some(message=>/device lost/i.test(message)));assert.deepEqual(errors,[]);
  console.log('PASS PS2 hardware WebGPU raster, swizzled VRAM, partial upload state, dual-circuit alpha composition and device loss',JSON.stringify(result));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
