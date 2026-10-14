// Actual device-GPU equal-depth overlay and completion-fence qualification.
const assert=require('node:assert/strict');const{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface']});
 try{
  const page=await browser.newPage({ignoreHTTPSErrors:true});
  await page.goto(process.env.WEBRCADE_GAMECUBE_ORIGIN+'/experimental/gamecube/');
  const result=await page.evaluate(async()=>{
   const {invariantVertexPosition}=await import('./shader-position.mjs');
   const {GpuFrameQueue}=await import('./gpu-frame-queue.mjs');
   const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
   if(!adapter||adapter.isFallbackAdapter||adapter.info?.isFallbackAdapter||/software|swiftshader|llvmpipe|lavapipe/i.test(adapter.info?.description||''))throw Error('Device GPU required');
   const device=await adapter.requestDevice();device.pushErrorScope('validation');
   const vs=invariantVertexPosition('struct Out { @builtin(position) p:vec4<f32> }; @vertex fn main(@builtin(vertex_index) i:u32)->Out {var p=array<vec2<f32>,3>(vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));var o:Out;o.p=vec4(p[i],0.5,1.);return o;}',0);
   const fragment=color=>'@fragment fn main(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{return '+color+';}';
   const make=(color,compare,write)=>device.createRenderPipeline({layout:'auto',vertex:{module:device.createShaderModule({code:vs})},fragment:{module:device.createShaderModule({code:invariantVertexPosition(fragment(color),2)}),targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:write,depthCompare:compare}});
   const base=make('vec4(0.,0.,1.,1.)','always',true),overlay=make('vec4(0.,1.,0.,1.)','equal',false);
   const texture=device.createTexture({size:[16,16],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   const depth=device.createTexture({size:[16,16],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
   const read=device.createBuffer({size:4096,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   const errors=[],frames=new GpuFrameQueue({onError:e=>errors.push(e.message)});
   for(let i=0;i<2;i++){
    const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});
    pass.setPipeline(base);pass.draw(3);pass.setPipeline(overlay);pass.draw(3);pass.end();
    if(i===1)encoder.copyTextureToBuffer({texture},{buffer:read,bytesPerRow:256},[16,16]);
    device.queue.submit([encoder.finish()]);frames.submitted(device.queue);
   }
   const blocked=frames.blocked();await device.queue.onSubmittedWorkDone();await new Promise(r=>setTimeout(r,0));
   await read.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(read.getMappedRange());let valid=true;
   for(let y=0;y<16;y++)for(let x=0;x<16;x++){const i=y*256+x*4;if(bytes[i]||bytes[i+1]!==255||bytes[i+2]||bytes[i+3]!==255)valid=false;}
   read.unmap();read.destroy();texture.destroy();depth.destroy();
   const error=await device.popErrorScope(),stats=frames.snapshot();device.destroy();return {valid,blocked,error:error?.message||null,errors,stats};
  });
  assert(result.valid);assert(result.blocked);assert.equal(result.error,null);assert.deepEqual(result.errors,[]);
  assert.equal(result.stats.pending,0);assert.equal(result.stats.maximum,2);assert.equal(result.stats.completed,2);
  console.log('PASS device GPU invariant vertex programs preserve coplanar equal-depth overlay pixels; two completion fences retire without validation errors',JSON.stringify(result.stats));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
