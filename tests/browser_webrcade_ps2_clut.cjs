/* Device-WebGPU CLUT alpha regression using original generated GS commands.
 * CPSM24 palettes use 32-bit entries (including alpha), as in pinned Play!
 * ReadCLUT4/ReadCLUT8. Ordinary PSMCT24 textures must still use TEXA.
 * PS2_GPU_APP selects built renderer bytes; PS2_CLUT_BASELINE=1 expects the
 * historical transparent-palette failure for a controlled negative run.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({ignoreHTTPSErrors:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(process.env.PS2_GPU_APP)for(const file of ['Gpu.js','Gpu.wasm'])await page.route('**/core/'+file,r=>r.fulfill({status:200,contentType:file.endsWith('.wasm')?'application/wasm':'text/javascript',body:fs.readFileSync(path.join(process.env.PS2_GPU_APP,file))}));
  await page.goto((process.env.WEBRCADE_TEST_ORIGIN||'https://localhost:8443')+'/experimental/ps2/');
  const result=await page.evaluate(async()=>{
   const {default:Gpu}=await import('./core/Gpu.js'),failures=[],m=await Gpu({canvas:document.getElementById('outputCanvas'),onGpuError:e=>failures.push(e)});
   if(!await m.ccall('gpu_init','number',[],[],{async:true}))throw Error('No device WebGPU');
   await m.ccall('gpu_reset',null,[],[],{async:true});const p=m._malloc(8*1048576),regs=[];
   const write=(reg,v)=>{v=BigInt(v);regs.push(reg,Number(v&0xffffffffn),Number(v>>32n));};
   function flush(){m.HEAPU8.set(new Uint8Array(new Uint32Array(regs).buffer),p);m._gpu_write(p,regs.length);regs.length=0;}
   function upload(bp,width,height,pixel){
    write(0x50,(BigInt(bp)<<32n)|(1n<<48n));write(0x51,0);write(0x52,BigInt(width)|(BigInt(height)<<32n));write(0x53,0);flush();
    m.HEAPU8.set(new Uint8Array(new Uint32Array(width*height).fill(pixel).buffer),p);m._gpu_image(p,width*height*4);
   }
   // Index 1 in either 4-bit or 8-bit views; both palette formats have alpha64.
   upload(0x1000,64,32,0x11111111);upload(0x1100,64,32,0x01010101);
   upload(0x2000,16,16,0x40281e50);
   // A direct 24-bit texture carries alpha128 in RAM but TEXA supplies alpha32.
   upload(0x2100,8,8,0x80281e50);
   write(0x1a,1);write(0x46,1);write(0x4c,1<<16);write(0x4e,1n<<32n);write(0x40,(63n<<16n)|(31n<<48n));write(0x47,0x30000);write(0x18,0);write(0x42,0x44);write(0x3b,32);write(0x08,5);
   const sprite=(x,y)=>{write(0x03,0);write(0x05,BigInt(x*16)|(BigInt(y*16)<<16n));write(0x03,0);write(0x05,BigInt((x+8)*16)|(BigInt((y+8)*16)<<16n));};
   // Clear each tested tile to RGB20,40,60, alpha128 before blending.
   for(let i=0;i<5;i++){write(0,6);write(1,0x803c2814);sprite(i*8,0);}
   const cases=[[0x14,0,0x1000],[0x14,1,0x1000],[0x13,0,0x1100],[0x13,1,0x1100]];
   for(let i=0;i<cases.length;i++){
    const [psm,cpsm,tbp]=cases[i];write(0,0x156);write(1,0x3f80000080808080n);
    write(6,BigInt(tbp)|(2n<<14n)|(BigInt(psm)<<20n)|(3n<<26n)|(3n<<30n)|(1n<<34n)|(1n<<35n)|(0x2000n<<37n)|(BigInt(cpsm)<<51n)|(1n<<61n));sprite(i*8,0);
   }
   write(6,0x2100n|(1n<<14n)|(1n<<20n)|(3n<<26n)|(3n<<30n)|(1n<<34n)|(1n<<35n));sprite(32,0);
   flush();await m.ccall('gpu_download',null,['number'],[p],{async:true});
   const bytes=m.HEAPU8.slice(p,p+4*1048576),block=[0,1,4,5,16,17,20,21];
   const pixels=Array.from({length:5},(_,i)=>Array.from(bytes.slice(block[i]*256,block[i]*256+4)));
   // Retain the loaded palette through a real GPU state round trip. CLD0 must
   // use the saved entries, without hiding a broken restore by reloading VRAM.
   const statePointer=await m.ccall('gpu_save','number',[],[],{async:true});
   const state=m.HEAPU8.slice(statePointer,statePointer+m._gpu_state_size());
   await m.ccall('gpu_reset',null,[],[],{async:true});m.HEAPU8.set(state,p);
   await m.ccall('gpu_load',null,['number','number'],[p,state.length],{async:true});
   write(0,6);write(1,0x803c2814);sprite(40,0);
   write(0,0x156);write(1,0x3f80000080808080n);
   write(6,0x1000n|(2n<<14n)|(0x14n<<20n)|(3n<<26n)|(3n<<30n)|(1n<<34n)|(1n<<35n)|(0x2000n<<37n)|(1n<<51n));sprite(40,0);
   flush();await m.ccall('gpu_download',null,['number'],[p],{async:true});
   const restored=Array.from(m.HEAPU8.slice(p+block[5]*256,p+block[5]*256+4));
   const before=failures.slice();m._free(p);m._gpu_destroy();return{pixels,restored,failures:before};
  });
  assert.deepEqual(errors,[]);assert.deepEqual(result.failures,[]);
  const color=[50,35,50,64],background=[20,40,60,0];
  assert.deepEqual(result.pixels[0],color,'4-bit CPSM32 palette');
  assert.deepEqual(result.pixels[2],color,'8-bit CPSM32 palette');
  assert.deepEqual(result.pixels[1],process.env.PS2_CLUT_BASELINE==='1'?background:color,'4-bit CPSM24 palette retains alpha');
  assert.deepEqual(result.pixels[3],process.env.PS2_CLUT_BASELINE==='1'?background:color,'8-bit CPSM24 palette retains alpha');
  assert.deepEqual(result.pixels[4],[35,37,55,32],'ordinary24-bit textures still use TEXA alpha32');
  assert.deepEqual(result.restored,process.env.PS2_CLUT_BASELINE==='1'?background:color,'saved CLUT alpha survives reset/load with CLD0');
  console.log('PASS PS2 device WebGPU paletted sprite alpha',JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
