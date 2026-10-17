// Node: snapshot/binding/resource tests. Device pixels are in the hardware fixture.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const {encodeTextureDecode,validateTextureDecode}=await import('../deploy/webrcade/retro-dolphin/app/texture-decode.mjs');
 global.GPUShaderStage={COMPUTE:4};global.GPUBufferUsage={STORAGE:128,UNIFORM:64};
 const packet=new Uint8Array(48);new Uint32Array(packet.buffer,0,4).set([0,0,32,0]);packet.fill(0x79,16);
 const events=[],buffers=[],groups=[];let pipelines=0,fail=false;
 const device={
  createBindGroupLayout(d){assert.equal(d.entries[0].buffer.type,'read-only-storage');assert.equal(d.entries[1].storageTexture.format,'rgba8unorm');return d;},
  createPipelineLayout(d){return d;},createShaderModule(d){return d;},
  createComputePipeline(){pipelines++;return{getBindGroupLayout(){return {};}};},
  createBuffer(d){const data=new ArrayBuffer(d.size);const b={d,data,destroyed:false,getMappedRange(){return data;},unmap(){events.push('unmap');},destroy(){this.destroyed=true;events.push('destroy');}};buffers.push(b);return b;},
  createBindGroup(d){if(fail)throw Error('injected group failure');groups.push(d);return {};},
 };
 const encoder={beginComputePass(){events.push('compute');return{setPipeline(){},setBindGroup(){},dispatchWorkgroups(x,y){assert.equal(x,1);assert.equal(y,1);},end(){events.push('end');}};}};
 const texture={format:'rgba8unorm',layers:1,tex:{width:16,height:16,mipLevelCount:2,createView(d){assert.equal(d.baseMipLevel,1);assert.equal(d.mipLevelCount,1);assert.equal(d.dimension,'2d');return {};}}};
 const decoded=encodeTextureDecode(device,encoder,texture,packet,8,8,8,1);
 assert.equal(decoded.dataBytes,32);assert.equal(decoded.bytes,64);assert.equal(decoded.buffers.length,2);
 const snap=new Uint8Array(decoded.buffers[0].data);packet.fill(0,16);assert.equal(snap[16],0x79);
 assert.deepEqual([...new Uint32Array(decoded.buffers[1].data)],[8,8,8,0]);
 assert(decoded.buffers.every(x=>!x.destroyed),'inputs survive encoding until owner submits');
 encodeTextureDecode(device,encoder,texture,packet,8,8,8,1);assert.equal(pipelines,1,'pipeline cache belongs to this device');
 const nextDevice={...device};encodeTextureDecode(nextDevice,encoder,texture,packet,8,8,8,1);assert.equal(pipelines,2,'new device gets a new pipeline');
 fail=true;const before=buffers.length;assert.throws(()=>encodeTextureDecode(device,encoder,texture,packet,8,8,8,1),/injected/);assert(buffers.slice(before).every(x=>x.destroyed));fail=false;
 for(const mutate of [
  p=>new Uint32Array(p.buffer)[0]=7,
  p=>new Uint32Array(p.buffer)[2]=28,
  p=>new Uint32Array(p.buffer)[3]=32,
 ]) {const p=packet.slice();mutate(p);assert.throws(()=>validateTextureDecode(p,8,8,8,1,texture));}
 for(const [w,h,aw,mip] of [[0,8,8,1],[8,8,16,1],[8,8,8,2],[1025,8,1032,1],[8,7,8,1]])assert.throws(()=>validateTextureDecode(packet,w,h,aw,mip,texture));
 assert.throws(()=>validateTextureDecode(packet,8,8,8,1,{...texture,format:'bgra8unorm'}));
 assert.throws(()=>validateTextureDecode(packet,8,8,8,1,{...texture,layers:2}));

 // Run the real patched consumer's opcode body, rather than a second replay implementation.
 const workerPath=process.env.GAMECUBE_PATCHED_WORKER;
 if(!workerPath)throw Error('Set GAMECUBE_PATCHED_WORKER to the fully patched pinned worker');
 const worker=fs.readFileSync(workerPath,'utf8');
 const begin=worker.indexOf('        case TEXTURE_DECODE_OP: {');
 const end=worker.indexOf('        case WGPU_CMD_OP_UPLOAD_TEXTURE: {',begin);
 assert(begin>=0&&end>begin);
 const handler='(()=>{switch(TEXTURE_DECODE_OP){'+worker.slice(begin,end)+'}})()';
 const record=new Uint32Array([26,7,128,48,8,8,1,8]);
 const heap=new Uint8Array(1024);heap.set(packet,128);
 function context(staged=false){
  const ring={stagedUploads:new Map(),stagedUploadBytes:staged?48:0};
  if(staged)ring.stagedUploads.set(0,{data:packet.slice()});
  const c={Uint8Array,TEXTURE_DECODE_OP:26,pass:null,u32:record,recWord:0,read:0,ring,webGpuObjects:{textures:new Map([[7,texture]])},moduleInstance:{HEAPU8:heap},
   gamecubeDecodeBuffers:[],gamecubeDecodeBufferBytes:0,wgpuReplayFatal:false,causalMetricsEnabled:false,performance,
   gamecubeTextureDecodeStats:{count:0,sourceBytes:0,decodedBytes:0,encodeMs:0,byFormat:{}},
   dev:device,enc:encoder,encodeTextureDecode,releases:[],submits:[],ensureEnc(){},
   releaseWgpuUploadPayload(r,p,n){c.releases.push([p,n]);},
   submitEnc(reason){c.submits.push(reason);for(const b of c.gamecubeDecodeBuffers)b.destroy();c.gamecubeDecodeBuffers=[];c.gamecubeDecodeBufferBytes=0;},
  };return vm.createContext(c);
 }
 let c=context();vm.runInContext(handler,c);assert.deepEqual(c.releases,[[128,48]]);assert.equal(c.gamecubeTextureDecodeStats.count,1);assert.equal(c.gamecubeDecodeBuffers.length,2);assert(c.gamecubeDecodeBuffers.every(x=>!x.destroyed));
 c=context(true);vm.runInContext(handler,c);assert.equal(c.releases.length,0);assert.equal(c.ring.stagedUploads.size,0);assert.equal(c.ring.stagedUploadBytes,0);
 c=context();c.gamecubeDecodeBufferBytes=8*1024*1024;vm.runInContext(handler,c);assert.deepEqual(c.submits,['gx-decode-capacity']);assert.equal(c.gamecubeDecodeBuffers.length,2);
 c=context();c.pass={};assert.throws(()=>vm.runInContext(handler,c),/inside render pass/);assert.equal(c.releases.length,0);
 c=context();c.webGpuObjects.textures.clear();assert.throws(()=>vm.runInContext(handler,c),/destination mismatch/);assert.equal(c.releases.length,0);

 const fallbackStart=end+'        case WGPU_CMD_OP_UPLOAD_TEXTURE: {'.length;
 const fallbackEnd=worker.indexOf('          const textureId =',fallbackStart);
 const fallback='(()=>{switch(8){case 8:{'+worker.slice(fallbackStart,fallbackEnd)+'break;}}})()';
 c=context();vm.runInContext(handler,c);vm.runInContext(fallback,c);
 assert.deepEqual(c.submits,['gx-decode-before-upload'],'CPU queue fallback follows submitted compute');
 c=context();vm.runInContext(handler,c);c.pass={};c.markWgpuReplayFatal=(scope)=>{c.wgpuReplayFatal=scope;};
 vm.runInContext(fallback,c);assert.equal(c.wgpuReplayFatal,'texture-decode-order');assert.equal(c.submits.length,0);

 // Exercise the real held-upload scanner with one decode packet. This advances
 // the upload watermark only after an independent snapshot is retained.
 const scanner=worker.slice(worker.indexOf('function stageHeldWgpuUploads('),worker.indexOf('\nfunction publishWgpuReadIndex(',worker.indexOf('function stageHeldWgpuUploads(')));
 const ring={uploadWatermarkEnabled:true,stagedPassStart:0,stagedScanCursor:0,slotsBase:0,capacity:8,uploadBase:128,uploadSize:1024,stagedUploads:new Map(),stagedUploadBytes:0};
 const scannerHeap=new Uint8Array(2048);new Uint32Array(scannerHeap.buffer).set(record);scannerHeap.set(packet,128);
 const stats={};const contextScan=vm.createContext({TEXTURE_DECODE_OP:26,WGPU_CMD_OP_UPLOAD_BUFFER:6,WGPU_CMD_OP_UPLOAD_TEXTURE:8,WGPU_MAX_STAGED_UPLOAD_BYTES:1024,performance,causalMetricsEnabled:false,webGpuCausalStats:new Proxy(stats,{get:(o,k)=>o[k]||0,set:(o,k,v)=>(o[k]=v,true)}),
  currentWgpuUploadReadIndex:()=>0,nextWgpuUploadRead:()=>48,releaseWgpuUploadPayload:()=>48,
  copyWgpuUploadPayload:(h,p,n)=>h.slice(p,p+n),ring,heap:scannerHeap,u32:new Uint32Array(scannerHeap.buffer)});
 vm.runInContext(scanner+'\nstageHeldWgpuUploads(ring,0,1,u32,heap);',contextScan);
 assert.equal(ring.stagedUploadBytes,48);assert.equal(ring.stagedUploads.get(0).kind,'gx-decode');scannerHeap.fill(0,128,176);assert.equal(ring.stagedUploads.get(0).data[0],0);assert.equal(ring.stagedUploads.get(0).data[8],32);
 // The state-load discard branch must retire the same complete packet span.
 const fenceStart=worker.indexOf('      } else if (op === TEXTURE_DECODE_OP) {\n        releaseWgpuUploadPayload');
 const fenceEnd=worker.indexOf('      } else if (op === WGPU_CMD_OP_UPLOAD_TEXTURE)',fenceStart);
 assert(fenceStart>0&&fenceEnd>fenceStart);
 const branch=worker.slice(fenceStart+'      } else if (op === TEXTURE_DECODE_OP) {'.length,fenceEnd);
 const retired=[];vm.runInNewContext(branch,{ring,fenceU32:record,word:0,releaseWgpuUploadPayload:(r,p,n)=>retired.push([p,n])});assert.deepEqual(retired,[[128,48]]);
 console.log('PASS GX typed bindings, source snapshots, per-device pipeline cache, allocation cleanup, validation, real opcode ownership/capacity, held staging and state-load discard');
})().catch(e=>{console.error(e);process.exitCode=1;});
