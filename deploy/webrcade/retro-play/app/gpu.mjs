// PS2 GS compute renderer. One bounded native request at a time; no software path.
export class Ps2Gpu {
 constructor(core,onError){this.core=core;this.onError=onError;this.module=null;this.chain=Promise.resolve();this.closed=false;this.error=null;this.buffer=0;this.capacity=0;this.ackWords=null;this.pending=0;this.timingEnabled=false;this.timingEpoch=null;}
 async initialize(canvas){this.initializing=this.open(canvas);return this.initializing;}
 async open(canvas){
  if(!navigator.gpu)throw new Error('PlayStation 2 requires device WebGPU.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter)throw new Error('No WebGPU adapter is available for PlayStation 2.');
  const info=adapter.info||await adapter.requestAdapterInfo?.()||{};
  if(adapter.isFallbackAdapter||info.isFallbackAdapter||/swiftshader|llvmpipe|lavapipe|software|microsoft basic render/i.test([info.vendor,info.device,info.description,info.architecture].join(' ')))throw new Error('PlayStation 2 requires a hardware WebGPU adapter.');
  this.adapter={vendor:info.vendor||'',device:info.device||'',description:info.description||'',fallback:false};
  if(this.closed)throw new Error('PS2 graphics was closed.');
  const {default:Gpu}=await import('./core/Gpu.js');
  const module=await Gpu({canvas,locateFile:name=>new URL('./core/'+name,import.meta.url).href,
   print:message=>console.log(message),printErr:message=>console.error(message),
   onGpuError:message=>this.fail(new Error(message)),onAbort:message=>this.fail(new Error('PS2 WebGPU: '+message))});
  this.module=module;
  if(this.closed)throw new Error('PS2 graphics was closed.');
  if(!await module.ccall('gpu_init','number',[],[],{async:true}))throw new Error('PS2 WebGPU initialization failed.');
  if(this.closed)throw new Error('PS2 graphics was closed.');
  if(this.error)throw this.error;
  this.module._gpu_set_timing(this.timingEnabled?1:0);
 }
 fail(error){if(!(error instanceof Error))error=new Error('PS2 WebGPU operation failed. Restart the game.');if(!this.error&&!this.closed){this.error=error;this.onError(error);}}
 setTimingEnabled(enabled,epoch){
  enabled=!!enabled&&!this.closed;
  if(enabled===this.timingEnabled&&epoch===this.timingEpoch)return;
  this.timingEnabled=enabled;this.timingEpoch=epoch;
  if(this.module&&!this.closed)this.module._gpu_set_timing(enabled?1:0);
 }
 sampleTiming(){
  const m=this.module;if(this.closed||!m?._gpu_has_timestamps)return null;
  return {supported:!!m._gpu_has_timestamps(),count:m._gpu_compute_samples(),ms:m._gpu_compute_ms()};
 }
 reserve(size){
  if(size>8*1024*1024)throw new Error('PS2 graphics request exceeds its limit.');
  if(size>this.capacity){if(this.buffer)this.module._free(this.buffer);this.capacity=Math.max(size,4*1024*1024);this.buffer=this.module._malloc(this.capacity);if(!this.buffer)throw new Error('PS2 graphics allocation failed.');}
  return this.buffer;
 }
 nativeCall(op,pointer,size,output,ack){
  if(this.closed||!this.core)return; // A terminated GS worker may have a queued proxy call.
  const timing=this.core.cloudTimings,epoch=timing?.epoch;
  const copyStart=timing?.begin()??null;
  // Finish the input copy before the native proxy returns. An idle GPU buffer
  // can own it directly; overlapping requests retain independent snapshots.
  // This also preserves payloads if the native caller later times out/exits.
  let bytes=null,staged=null,copyError=null;
  try{
   if(size&&!this.pending&&!this.error){
    staged=this.reserve(size);
    this.module.HEAPU8.set(this.core.HEAPU8.subarray(pointer,pointer+size),staged);
   }else if(size)bytes=this.core.HEAPU8.slice(pointer,pointer+size);
  }catch(error){copyError=error;}
  this.pending++;
  if(copyStart!==null)timing.record('gpuSubmit',copyStart,epoch);
  const queued=timing?.begin()??null;
  const finish=value=>{
   // Memory growth replaces the shared buffer; refresh before acknowledging.
   const buffer=this.core.HEAPU8.buffer;
   if(this.ackWords?.buffer!==buffer)this.ackWords=new Int32Array(buffer);
   const words=this.ackWords;Atomics.store(words,ack>>>2,value);Atomics.notify(words,ack>>>2);
  };
  this.chain=this.chain.then(async()=>{
   if(copyError)throw copyError;
   if(this.closed||this.error)throw this.error||new Error('PS2 graphics has closed.');
   if(queued!==null){timing.record('bridge',queued,epoch);timing.gpuCall(epoch);}
   const submitStart=timing?.begin()??null;
   const m=this.module,buffer=staged??this.reserve(Math.max(size,op===7?4*1024*1024:0));
   if(bytes)m.HEAPU8.set(bytes,buffer);
   let result=1,display=false;
   switch(op){
    case 1:m._gpu_write(buffer,size/4);break;
    case 2:m._gpu_image(buffer,size);break;
    case 3:result=1+m._gpu_present(buffer);display=true;break;
    case 4:{const length=m._gpu_state_size();if(length>8*1024*1024)throw new Error('Invalid PS2 graphics state size.');const address=await m.ccall('gpu_save','number',[],[],{async:true});this.core.HEAPU8.set(m.HEAPU8.subarray(address,address+length),output);result=length+1;break;}
    case 5:await m.ccall('gpu_load',null,['number','number'],[buffer,size],{async:true});break;
    case 6:await m.ccall('gpu_reset',null,[],[],{async:true});break;
    case 8:{
     const flags=m._gpu_batch(buffer,size);
     result=1+((flags&4)?1:0);
     display=!!(flags&2);
     break;
    }
    case 7:await m.ccall('gpu_download',null,['number'],[buffer],{async:true});this.core.HEAPU8.set(m.HEAPU8.subarray(buffer,buffer+4*1024*1024),output);break;
    case 9:{
     if(size!==8)throw new Error('Invalid PS2 snapshot range descriptor.');
     const descriptor=new DataView(m.HEAPU8.buffer,buffer,8),offset=descriptor.getUint32(0,true),length=descriptor.getUint32(4,true);
     if(!length||(offset|length)%4||offset>=4*1024*1024||length>4*1024*1024-offset)throw new Error('Invalid PS2 snapshot range.');
     const target=this.reserve(offset+length);
     await m.ccall('gpu_download_snapshot_range',null,['number','number','number'],[target,offset,length],{async:true});
     this.core.HEAPU8.set(m.HEAPU8.subarray(target+offset,target+offset+length),output);
     break;
    }
    case 10:if(size!==4*1024*1024)throw new Error('Invalid PS2 snapshot seed.');m._gpu_seed_download_snapshot(buffer,size);break;
    default:throw new Error('Invalid PS2 graphics command.');
   }
   if(submitStart!==null){
    if(op===1||op===2||op===3||op===8)timing.record('gpuSubmit',submitStart,epoch);
    else if(op===7||op===9)timing.record('gpuWait',submitStart,epoch);
   }
   if(display){
    const waitStart=timing?.begin()??null;
    await m.ccall('gpu_wait',null,[],[],{async:true});
    if(waitStart!==null)timing.record('gpuWait',waitStart,epoch);
   }
   if(this.error)throw this.error;
   if(display&&result===2)timing?.present(epoch);
   finish(result);
  }).catch(error=>{this.fail(error);finish(-1);}).finally(()=>{this.pending--;});
 }
 dispose(){
  if(this.closePromise)return this.closePromise;this.setTimingEnabled(false);this.closed=true;
  this.closePromise=(async()=>{await this.initializing?.catch(()=>{});await this.chain.catch(()=>{});try{if(this.module){if(this.buffer)this.module._free(this.buffer);this.module._gpu_destroy();}}catch(error){console.warn('PS2 graphics cleanup:',error);}finally{this.module=null;this.core=null;this.ackWords=null;}})();
  return this.closePromise;
 }
}
