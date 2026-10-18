const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
(async()=>{
 const {Ps2Gpu}=await import(pathToFileURL(process.argv[2]));
 const MiB=1024*1024,source=512,output=2*MiB,ack=16,offset=8192,length=8192;
 const core={HEAPU8:new Uint8Array(new SharedArrayBuffer(8*MiB))};
 const errors=[];const gpu=new Ps2Gpu(core,e=>errors.push(e));
 let resolveDownload,called;
 const module={HEAPU8:new Uint8Array(8*MiB),_malloc:()=>64,_free:()=>{},
  ccall:async(name,ret,types,args,opts)=>{
   called={name,args,opts};await new Promise(resolve=>resolveDownload=resolve);
   // Asyncify/memory growth must not leave a stale heap view in the bridge.
   const grown=new Uint8Array(12*MiB);grown.set(module.HEAPU8);module.HEAPU8=grown;
   module.HEAPU8.fill(0x71,args[0]+args[1],args[0]+args[1]+args[2]);
  },_gpu_seed_download_snapshot:(buffer,size)=>{called={seed:module.HEAPU8.slice(buffer,buffer+size)};}};
 gpu.module=module;
 function descriptor(off,n){const view=new DataView(core.HEAPU8.buffer,source,8);view.setUint32(0,off,true);view.setUint32(4,n,true);}
 descriptor(offset,length);core.HEAPU8.fill(0xa5,output-1,output+length+1);
 gpu.nativeCall(9,source,8,output,ack);
 await Promise.resolve();assert.equal(Atomics.load(new Int32Array(core.HEAPU8.buffer),ack/4),0);
 assert.equal(called.name,'gpu_download_snapshot_range');assert.deepEqual(called.args,[64,offset,length]);
 assert.equal(core.HEAPU8[output],0xa5);resolveDownload();await gpu.chain;
 assert.equal(Atomics.load(new Int32Array(core.HEAPU8.buffer),ack/4),1);
 assert.equal(core.HEAPU8[output],0x71);assert.equal(core.HEAPU8[output+length-1],0x71);
 assert.equal(core.HEAPU8[output-1],0xa5);assert.equal(core.HEAPU8[output+length],0xa5);
 core.HEAPU8.fill(0x82,source,source+4*MiB);gpu.nativeCall(10,source,4*MiB,0,ack);await gpu.chain;
 assert.equal(called.seed.length,4*MiB);assert.equal(called.seed[0],0x82);assert.equal(called.seed.at(-1),0x82);
 assert.equal(errors.length,0);
 for(const [off,n,size] of [[0,0,8],[1,4,8],[0,3,8],[4*MiB-4,8,8],[0,4,4]]){
  const bad=new Ps2Gpu(core,()=>{});bad.module=module;descriptor(off,n);Atomics.store(new Int32Array(core.HEAPU8.buffer),ack/4,0);
  bad.nativeCall(9,source,size,output,ack);await bad.chain;
  assert.equal(Atomics.load(new Int32Array(core.HEAPU8.buffer),ack/4),-1);assert(bad.error);
 }
 console.log('PASS actual JS bridge: async copy/ack, grown memory, output offset, seed and invalid-range rejection');
})().catch(e=>{console.error(e);process.exit(1);});
