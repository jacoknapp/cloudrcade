import {perfEnabled} from './preferences.mjs';

// Opt-in wall-clock measurements. Workers, I/O and the GPU can overlap;
// these service times must never be subtracted from frame time to invent CPU time.
export class FrameTimings {
 constructor(clock=()=>performance.now()){this.clock=clock;this.enabled=false;this.epoch=0;this.clear();}
 clear(){this.sums={gpuSubmit:0,gpuWait:0,bridge:0,disc:0,host:0};this.calls=0;this.count=0;this.frames=0;this.maximum=0;}
 reset(){this.epoch++;this.lastPresent=null;this.last=null;this.clear();}
 setEnabled(enabled){if(this.enabled===enabled)return false;this.enabled=enabled;this.reset();return true;}
 begin(){return this.enabled?this.clock():null;}
 record(kind,start,epoch){if(start!==null&&this.enabled&&epoch===this.epoch)this.sums[kind]+=Math.max(0,this.clock()-start);}
 gpuCall(epoch){if(this.enabled&&epoch===this.epoch)this.calls++;}
 present(epoch){
  if(!this.enabled||epoch!==this.epoch)return;
  const now=this.clock();this.frames++;
  if(this.lastPresent!==null){
   this.last=Math.max(0,now-this.lastPresent);this.maximum=Math.max(this.maximum,this.last);
   this.intervals||=new Float64Array(240);this.intervals[this.count%240]=this.last;this.count++;
  }
  this.lastPresent=now;
 }
 take(){
  const intervals=this.count?Array.from(this.intervals.subarray(0,Math.min(this.count,240))).sort((a,b)=>a-b):[];
  const result={...this.sums,calls:this.calls,frames:this.frames,last:this.last,max:intervals.length?this.maximum:null,p95:intervals.length?intervals[Math.ceil(intervals.length*.95)-1]:null};
  this.clear();return result;
 }
}

export class Ps2Performance {
 constructor(module,disc){
  this.module=module;this.disc=disc;this.previous=null;this.details='Waiting for a performance sample.';
  this.timings=new FrameTimings();module.cloudTimings=this.timings;
  this.element=document.createElement('output');this.element.id='ps2-performance';this.element.setAttribute('aria-label','PS2 performance readout');this.element.hidden=!perfEnabled();document.body.append(this.element);
  this.reset();this.timer=setInterval(()=>this.sample(),1000);
 }
 reset(paused=false){this.element.hidden=!perfEnabled();this.paused=paused;this.previous=null;this.timings.setEnabled(!paused&&perfEnabled());this.timings.reset();this.element.textContent=paused?'PS2 paused':'PS2 measuring…';}
 sample(now=performance.now()){
  if(this.paused)return;
  const enabled=perfEnabled();if(this.timings.setEnabled(enabled)){this.previous=null;this.element.textContent='PS2 measuring…';}
  this.element.hidden=!enabled;
  const frame=this.module.getFrames(),video=this.module.getVideoFrames(),target=this.module.getVideoRate(),heap=this.module.HEAPU8.length+(this.module.cloudGpu?.module?.HEAPU8.length||0);
  const previous=this.previous;this.previous={now,frame,video};const measured=this.timings.take();
  if(!previous||now<=previous.now||frame<previous.frame||video<previous.video){this.timings.reset();return;}
  const seconds=(now-previous.now)/1000,rendered=(frame-previous.frame)/seconds,timing=(video-previous.video)/seconds;
  const speed=target>0?timing/target*100:0,ms=value=>value===null||!Number.isFinite(value)?'—':value.toFixed(1);
  const perFrame=value=>measured.frames?ms(value/measured.frames):'—',average=rendered>0?1000/rendered:null;
  const stages=`GPU submit CPU ${perFrame(measured.gpuSubmit)} · wait ${perFrame(measured.gpuWait)} ms/f\nDisc I/O ${perFrame(measured.disc)} · input/layout ${perFrame(measured.host)} ms/f\nBridge queue ${perFrame(measured.bridge)} ms/f · ${perFrame(measured.calls)} calls/f`;
  this.details=`Rendered: ${rendered.toFixed(1)} FPS\nEmulation: ${speed.toFixed(0)}% normal speed (${target} Hz video timing)\nFrame interval: ${ms(average)} ms average, ${ms(measured.last)} ms last, ${ms(measured.p95)} ms p95, ${measured.frames?ms(measured.max):'—'} ms max\n${enabled?stages:'Detailed timing is off.'}\nVideo tick: ${ms(timing>0?1000/timing:null)} ms (normal ${ms(target>0?1000/target:null)} ms)\nCPU + graphics WASM heaps: ${(heap/1048576).toFixed(0)} MiB\nDisc cache: ${((this.disc.cachedBytes||0)/1048576).toFixed(1)} / 16 MiB\nTiming uses one-second windows. Stages overlap across workers and are not additive. GPU submit CPU includes bridge copies and command encoding; GPU wait is wall time awaiting queue completion/readback, not GPU execution time. Disc I/O includes cache copies and network waits. Native emulation CPU time and GPU execution time are not measured. Frame intervals are observed GPU-presentation completions; p95 uses at most 240 recent intervals per window. Browser/GPU memory is not measured.`;
  this.element.textContent=`PS2 · ${rendered.toFixed(1)} FPS · ${speed.toFixed(0)}% · ${(heap/1048576).toFixed(0)} MiB\nFrame ${ms(average)} ms avg · p95 ${ms(measured.p95)} · last ${ms(measured.last)}\n${stages}\nVideo ${ms(timing>0?1000/timing:null)} / ${ms(target>0?1000/target:null)} ms\n1s averages · stages overlap\nNative CPU / GPU execution: unmeasured`;
 }
 dispose(){clearInterval(this.timer);this.timings.setEnabled(false);if(this.module.cloudTimings===this.timings)delete this.module.cloudTimings;this.element.remove();}
}
