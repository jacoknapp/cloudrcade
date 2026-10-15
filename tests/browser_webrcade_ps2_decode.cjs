/* Actual device WebGPU decode jobs: sub-workgroup tails, shared setups, and
 * >1024 workgroups. Original generated textures/GS commands, no game/BIOS data.
 * PS2_GPU_APP optionally selects source native bytes; PS2_DECODE_REFERENCE=1
 * records the old renderer's dispatch count for a controlled baseline run.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({ignoreHTTPSErrors:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(process.env.PS2_GPU_APP)for(const file of ['Gpu.js','Gpu.wasm'])await page.route('**/core/'+file,r=>r.fulfill({status:200,contentType:file.endsWith('.wasm')?'application/wasm':'text/javascript',body:fs.readFileSync(path.join(process.env.PS2_GPU_APP,file))}));
  await page.goto((process.env.WEBRCADE_TEST_ORIGIN||'https://localhost:8443')+'/experimental/ps2/');
  const result=await page.evaluate(async()=>{
   const entry=new WeakMap(),active=new WeakMap();let decodes=0,decodeGroups=0;
   const create=GPUDevice.prototype.createComputePipeline,set=GPUComputePassEncoder.prototype.setPipeline,dispatch=GPUComputePassEncoder.prototype.dispatchWorkgroups;
   GPUDevice.prototype.createComputePipeline=function(d){const p=create.call(this,d);entry.set(p,d.compute.entryPoint);return p;};
   GPUComputePassEncoder.prototype.setPipeline=function(p){active.set(this,entry.get(p));return set.call(this,p);};
   GPUComputePassEncoder.prototype.dispatchWorkgroups=function(x,y=1,z=1){if(active.get(this)==='decode'){decodes++;decodeGroups+=x*y*z;}return dispatch.call(this,x,y,z);};
   const {default:Gpu}=await import('./core/Gpu.js'),failures=[],m=await Gpu({canvas:document.getElementById('outputCanvas'),onGpuError:e=>failures.push(e)});
   if(!await m.ccall('gpu_init','number',[],[],{async:true}))throw Error('No device WebGPU');
   await m.ccall('gpu_reset',null,[],[],{async:true});const p=m._malloc(8*1048576),regs=[];
   const write=(reg,v)=>{v=BigInt(v);regs.push(reg,Number(v&0xffffffffn),Number(v>>32n));};
   function flush(){m.HEAPU8.set(new Uint8Array(new Uint32Array(regs).buffer),p);m._gpu_write(p,regs.length);regs.length=0;}
   // One 1024x128 swizzled image, sampled through ten differently sized views.
   write(0x50,(0x1000n<<32n)|(16n<<48n));write(0x51,0);write(0x52,1024n|(128n<<32n));write(0x53,0);flush();
   const image=new Uint8Array(1024*128*4);
   for(let i=0;i<image.length/4;i++){image[i*4]=i*17&255;image[i*4+1]=(i*31>>>7)&255;image[i*4+2]=(i^127)&255;image[i*4+3]=128;}
   m.HEAPU8.set(image,p);m._gpu_image(p,image.length);
   write(0x1a,1);write(0x46,1);write(0x4c,4<<16);write(0x4e,1n<<32n);write(0x40,(255n<<16n)|(127n<<48n));write(0x47,0x30000);write(0x01,0x3f80000080808080n);write(0x00,0x116);
   const sizes=[[0,0],[1,0],[1,1],[2,1],[3,2],[3,3],[4,4],[7,5],[9,6],[10,7]];
   for(let i=0;i<96;i++){
    const [tw,th]=sizes[i%sizes.length],x=(i%12)*16,y=Math.floor(i/12)*12,u=i*31%2**tw,v=i*7%2**th;
    write(0x06,0x1000n|(16n<<14n)|(BigInt(tw)<<26n)|(BigInt(th)<<30n)|(1n<<34n)|(1n<<35n));
    write(0x03,BigInt(u*16)|(BigInt(v*16)<<16n));write(0x05,BigInt(x*16)|(BigInt(y*16)<<16n));
    write(0x03,BigInt(u*16)|(BigInt(v*16)<<16n));write(0x05,BigInt((x+8)*16)|(BigInt((y+8)*16)<<16n));
   }
   flush();await m.ccall('gpu_download',null,['number'],[p],{async:true});
   const bytes=m.HEAPU8.slice(p,p+4*1048576),digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
   const before=failures.slice();m._free(p);m._gpu_destroy();return{hash,decodes,decodeGroups,failures:before,first:Array.from(bytes.subarray(0,4))};
  });
  assert.deepEqual(errors,[]);assert.deepEqual(result.failures,[]);
  assert.equal(result.decodes,process.env.PS2_DECODE_REFERENCE==='1'?10:1,'one independent texture batch, with ten unique jobs');
  // PSMCT32 top-left texel: source RGB 0,0,127 and alpha128, no interpolation.
  assert.deepEqual(result.first,[0,0,127,128]);
  if(process.env.PS2_DECODE_REFERENCE!=='1')assert.equal(result.hash,'7e03a144019870650b6f1881d9b11b546fcc0a8710699e94df2738e1d7882ae8');
  console.log('PASS PS2 hardware GPU decode tails, shared setups, multi-row dispatch and full VRAM',JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
