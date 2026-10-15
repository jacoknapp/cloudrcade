// PS2 GS compute renderer. One bounded native request at a time; no software path.
export class Ps2Gpu {
 constructor(core,onError){this.core=core;this.onError=onError;this.module=null;this.chain=Promise.resolve();this.closed=false;this.error=null;this.buffer=0;this.capacity=0;this.ackWords=null;}
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
 }
 fail(error){if(!(error instanceof Error))error=new Error('PS2 WebGPU operation failed. Restart the game.');if(!this.error&&!this.closed){this.error=error;this.onError(error);}}
 reserve(size){
  if(size>8*1024*1024)throw new Error('PS2 graphics request exceeds its limit.');
  if(size>this.capacity){if(this.buffer)this.module._free(this.buffer);this.capacity=Math.max(size,4*1024*1024);this.buffer=this.module._malloc(this.capacity);if(!this.buffer)throw new Error('PS2 graphics allocation failed.');}
  return this.buffer;
 }
 nativeCall(op,pointer,size,output,ack){
  if(this.closed||!this.core)return; // A terminated GS worker may have a queued proxy call.
  // Copy before the Emscripten proxy returns, including across memory growth.
  const bytes=size?this.core.HEAPU8.slice(pointer,pointer+size):null;
  const finish=value=>{
   // Memory growth replaces the shared buffer; refresh before acknowledging.
   const buffer=this.core.HEAPU8.buffer;
   if(this.ackWords?.buffer!==buffer)this.ackWords=new Int32Array(buffer);
   const words=this.ackWords;Atomics.store(words,ack>>>2,value);Atomics.notify(words,ack>>>2);
  };
  this.chain=this.chain.then(async()=>{
   if(this.closed||this.error)throw this.error||new Error('PS2 graphics has closed.');
   const m=this.module,buffer=this.reserve(Math.max(size,op===7?4*1024*1024:0));
   if(bytes)m.HEAPU8.set(bytes,buffer);
   let result=1;
   switch(op){
    case 1:m._gpu_write(buffer,size/4);break;
    case 2:m._gpu_image(buffer,size);break;
    case 3:result=1+m._gpu_present(buffer);await m.ccall('gpu_wait',null,[],[],{async:true});break;
    case 4:{const length=m._gpu_state_size();if(length>8*1024*1024)throw new Error('Invalid PS2 graphics state size.');const address=await m.ccall('gpu_save','number',[],[],{async:true});this.core.HEAPU8.set(m.HEAPU8.subarray(address,address+length),output);result=length+1;break;}
    case 5:await m.ccall('gpu_load',null,['number','number'],[buffer,size],{async:true});break;
    case 6:await m.ccall('gpu_reset',null,[],[],{async:true});break;
    case 7:await m.ccall('gpu_download',null,['number'],[buffer],{async:true});this.core.HEAPU8.set(m.HEAPU8.subarray(buffer,buffer+4*1024*1024),output);break;
    default:throw new Error('Invalid PS2 graphics command.');
   }
   if(this.error)throw this.error;finish(result);
  }).catch(error=>{this.fail(error);finish(-1);});
 }
 dispose(){
  if(this.closePromise)return this.closePromise;this.closed=true;
  this.closePromise=(async()=>{await this.initializing?.catch(()=>{});await this.chain.catch(()=>{});try{if(this.module){if(this.buffer)this.module._free(this.buffer);this.module._gpu_destroy();}}catch(error){console.warn('PS2 graphics cleanup:',error);}finally{this.module=null;this.core=null;this.ackWords=null;}})();
  return this.closePromise;
 }
}
