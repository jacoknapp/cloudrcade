// Real device-GPU snapshot semantics for the packaged immediate-upload helpers.
// Synthetic pixels only; GPU readback exists in this test, never gameplay.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const origin=process.env.WEBRCADE_GAMECUBE_ORIGIN;
const root=process.env.WEBRCADE_GAMECUBE_ROOT;
if(!origin||!root)throw new Error('Set packaged GameCube origin and root');
(async()=>{
 const worker=fs.readFileSync(path.join(root,'vendor/src/upstream-discio-worker.js'),'utf8');
 const begin=worker.indexOf('function copyWgpuUploadPayload('),end=worker.indexOf('function stageHeldWgpuUploads(',begin);
 assert(begin>=0&&end>begin);
 assert(worker.includes('uploadPayload = borrowTextureUpload(heap, src, uploadBytes, copyImmediateWgpuBufferUpload);'));
 const browser=await chromium.launch({args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface']});
 try{
  const page=await browser.newPage({ignoreHTTPSErrors:true});await page.goto(origin+'/experimental/gamecube/');
  await page.addScriptTag({content:worker.slice(begin,end)});
  const result=await page.evaluate(async()=>{
   const {borrowTextureUpload}=await import('./upload-scratch.mjs');
   const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
   if(!adapter||adapter.info?.isFallbackAdapter||/software|swiftshader|llvmpipe/i.test(adapter.info?.description||''))throw new Error('Device GPU required');
   const device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
   const heap=new Uint8Array(new SharedArrayBuffer(4096));const q=device.queue;
   const tests=[];
   for(const [format,bpp]of [['rgba8unorm',4],['r8unorm',1]]){
    const w=3,h=3,bytes=w*h*bpp,records=[];
    for(const value of [17,231]){
     const tex=device.createTexture({format,size:[w,h],usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});
     heap.fill(value,9,9+bytes);
     const payload=borrowTextureUpload(heap,9,bytes,copyImmediateWgpuBufferUpload);
     if(payload.byteLength!==bytes)throw new Error('Unexpected texture padding');
     q.writeTexture({texture:tex},payload,{bytesPerRow:w*bpp,rowsPerImage:h},[w,h]);
     // The next buffer upload uses exactly the same backing store before any
     // submission/readback wait, matching real interleaved replay commands.
     heap.fill(99);const buffer=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST});
     q.writeBuffer(buffer,0,copyImmediateWgpuBufferUpload(heap,0,256));buffer.destroy();
     const read=device.createBuffer({size:256*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
     const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:tex},{buffer:read,bytesPerRow:256,rowsPerImage:h},[w,h]);q.submit([encoder.finish()]);
     records.push({tex,read,value});
    }
    for(const {tex,read,value}of records){
     await read.mapAsync(GPUMapMode.READ);const pixels=new Uint8Array(read.getMappedRange());
     for(let y=0;y<h;y++)for(let x=0;x<w*bpp;x++)if(pixels[y*256+x]!==value)throw new Error('Earlier texture upload was overwritten');
     read.unmap();read.destroy();tex.destroy();
    }
    tests.push(format);
   }
   await q.onSubmittedWorkDone();device.destroy();return {tests,errors};
  });
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.tests,['rgba8unorm','r8unorm']);
  console.log('PASS device-GPU exact texture pixels across shared-heap mutation, odd byte spans, scratch reuse and interleaved buffer uploads');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
