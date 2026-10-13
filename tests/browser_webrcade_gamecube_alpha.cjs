// Synthetic device-GPU regression; no games, saves, accounts or optional GPU
// features. WEBRCADE_GAMECUBE_ORIGIN must serve the prepared GameCube modules.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async () => {
  const browser = await chromium.launch({args:['--no-sandbox','--enable-unsafe-webgpu',
    '--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface']});
  try {
    const context = await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
    const page = await context.newPage();
    await page.goto((process.env.WEBRCADE_GAMECUBE_ORIGIN || 'https://127.0.0.1:19007') + '/experimental/gamecube/');
    const results = await page.evaluate(async () => {
      const {createDestinationAlphaPipeline, drawDestinationAlpha} = await import('./destination-alpha.mjs');
      const adapter = await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
      if (!adapter || adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter ||
          /software|swiftshader|llvmpipe|lavapipe/i.test(adapter.info?.description || '')) throw Error('Device GPU required');
      const device = await adapter.requestDevice();
      device.pushErrorScope('validation');
      const layout = device.createPipelineLayout({bindGroupLayouts:[]});
      const results = [];
      async function run(name, {depth=false, equal=false, destination=false, discard=false, indexed=false, repeat=false, strip=false, instances=1}={}) {
        const texture=device.createTexture({size:[4,4],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
        const depthTexture=depth?device.createTexture({size:[4,4],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT}):null;
        const vertex=device.createShaderModule({code:`@vertex fn main(@builtin(vertex_index) i:u32) -> @builtin(position) vec4f {
          let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
          ${strip ? 'let q=array<vec2f,4>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(1,1));return vec4f(q[i],0.25,1);' : `return vec4f(p[i%3u],${equal?'0.5':'select(0.25,0.4,i>=3u)'},1);`}
        }`});
        const fs=alpha=>device.createShaderModule({code:`@fragment fn main(@builtin(position) p:vec4f)->@location(0) vec4f {
          ${discard?'if(p.x<2){discard;}':''} return vec4f(1,0,0,${alpha});
        }`});
        const target={format:'rgba8unorm',writeMask:15,blend:{color:{operation:'add',srcFactor:'src-alpha',dstFactor:destination?'dst-alpha':'one-minus-src-alpha'},alpha:{operation:'add',srcFactor:'one',dstFactor:'zero'}}};
        const descriptor={label:name,layout,vertex:{module:vertex},fragment:{module:fs('0.5'),targets:[target]},primitive:{topology:strip?'triangle-strip':'triangle-list',cullMode:strip?'back':'none',frontFace:'ccw',...(strip&&indexed?{stripIndexFormat:'uint16'}:{})},...(depth?{depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}}:{})};
        const pipeline=createDestinationAlphaPipeline(device,descriptor,{module:fs('0.25')});
        const encoder=device.createCommandEncoder();
        const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:1,a:0.75}}],...(depth?{depthStencilAttachment:{view:depthTexture.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:0.5}}:{})});
        pass.setPipeline(pipeline);
        let indices;
        if(indexed){indices=device.createBuffer({size:16,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(indices,0,new Uint16Array([0,1,2,3,4,5,0,0]));pass.setIndexBuffer(indices,'uint16');}
        drawDestinationAlpha(pass,pipeline,indexed,strip?4:6,instances,0);
        // No setPipeline here: the replay helper must restore the binding.
        if(repeat)drawDestinationAlpha(pass,pipeline,indexed,strip?4:3,1,0);
        pass.end();
        const read=device.createBuffer({size:1024,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        encoder.copyTextureToBuffer({texture},{buffer:read,bytesPerRow:256},[4,4]);device.queue.submit([encoder.finish()]);
        await read.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(read.getMappedRange());
        const pixels=[];for(let y=0;y<4;y++)for(let x=0;x<4;x++)pixels.push(Array.from(bytes.slice(y*256+x*4,y*256+x*4+4)));
        results.push({name,pixels});read.unmap();read.destroy();texture.destroy();depthTexture?.destroy();indices?.destroy();
      }
      await run('batch');
      await run('depth-order',{depth:true});
      await run('equal-rejected',{depth:true,equal:true});
      await run('destination-order',{destination:true,indexed:true});
      await run('discard',{depth:true,discard:true});
      await run('retained-pipeline',{repeat:true});
      await run('strip-winding',{depth:true,strip:true,indexed:true});
      await run('instances',{destination:true,instances:2});
      const error=await device.popErrorScope();device.destroy();return {results,error:error?.message||null};
    });
    assert.equal(results.error,null);
    const expected={batch:[112,0,143,128],'depth-order':[64,0,191,128],'equal-rejected':[0,0,255,191],
      'destination-order':[96,0,96,128],discard:[64,0,191,128],'retained-pipeline':[148,0,107,128],
      'strip-winding':[64,0,191,128],instances:[120,0,24,128]};
    for(const result of results.results)for(let i=0;i<result.pixels.length;i++) {
      const want=result.name==='discard'&&i%4<2?[0,0,255,191]:expected[result.name];
      result.pixels[i].forEach((v,c)=>assert(Math.abs(v-want[c])<=2,`${result.name} pixel${i} channel${c}: ${v} vs ${want[c]}`));
    }
    console.log('PASS device GPU RGB/source-alpha, constant framebuffer alpha, depth rejection/order, discard, indexed draws, strips, instances and retained pipeline');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
