// Hardware-only resource lifetime check. Requires an isolated HTTPS/localhost
// app origin, Playwright, and a device WebGPU adapter; never loads a game/save.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--enable-unsafe-webgpu',
  '--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface']});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
  const page=await context.newPage();
  const origin=process.env.WEBRCADE_GAMECUBE_ORIGIN||'https://127.0.0.1:18975';
  await page.goto(origin+'/experimental/gamecube/');
  const result=await page.evaluate(async()=>{
   const {releaseGpuResource}=await import('./gpu-resources.mjs');
   const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
   if(!adapter||adapter.isFallbackAdapter||adapter.info?.isFallbackAdapter||
    /software|swiftshader|llvmpipe|lavapipe/i.test(adapter.info?.description||''))
    throw new Error('This check requires the device GPU');
   const device=await adapter.requestDevice();device.pushErrorScope('validation');
   const texture=device.createTexture({size:[16,16],format:'rgba8unorm',
    usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   const read=device.createBuffer({size:256*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   const encoder=device.createCommandEncoder();
   const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),
    loadOp:'clear',storeOp:'store',clearValue:{r:1,g:0,b:1,a:1}}]});pass.end();
   encoder.copyTextureToBuffer({texture},{buffer:read,bytesPerRow:256},[16,16]);
   const maps={textures:new Map([[1,{tex:texture}]]),buffers:new Map(),
    bindGroups:new Map([[2,{}]]),bindGroupSamplingMasks:new Map([[2,1]])};
   let submits=0;
   releaseGpuResource(maps,3,2,{flush(){throw new Error('bind group triggered a submission');}});
   releaseGpuResource(maps,2,1,{flush(){device.queue.submit([encoder.finish()]);submits++;return true;}});
   await read.mapAsync(GPUMapMode.READ);
   const bytes=new Uint8Array(read.getMappedRange());
   let valid=true;for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const i=y*256+x*4;if(bytes[i]!==255||bytes[i+1]!==0||bytes[i+2]!==255||bytes[i+3]!==255)valid=false;
   }
   read.unmap();read.destroy();const error=await device.popErrorScope();device.destroy();
   return {submits,valid,error:error?.message||null,textures:maps.textures.size,
    bindGroups:maps.bindGroups.size,masks:maps.bindGroupSamplingMasks.size};
  });
  assert.deepEqual(result,{submits:1,valid:true,error:null,textures:0,bindGroups:0,masks:0});
  console.log('PASS device GPU completes encoded work before resource destruction, with no validation errors');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
