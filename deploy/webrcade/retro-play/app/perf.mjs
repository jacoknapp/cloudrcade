import {perfEnabled} from './preferences.mjs';
export class Ps2Performance {
 constructor(module,disc){
  this.module=module;this.disc=disc;this.previous=null;this.details='Waiting for a performance sample.';
  this.element=document.createElement('output');this.element.id='ps2-performance';this.element.setAttribute('aria-label','PS2 performance readout');this.element.hidden=!perfEnabled();document.body.append(this.element);
  this.timer=setInterval(()=>this.sample(),1000);
 }
 reset(paused=false){this.paused=paused;this.previous=null;this.element.textContent=paused?'PS2 paused':'PS2 measuring…';}
 sample(now=performance.now()){
  if(this.paused)return;
  const frame=this.module.getFrames(),video=this.module.getVideoFrames(),target=this.module.getVideoRate(),heap=this.module.HEAPU8.length;
  const previous=this.previous;this.previous={now,frame,video};
  if(!previous||now<=previous.now||frame<previous.frame||video<previous.video)return;
  const seconds=(now-previous.now)/1000,rendered=(frame-previous.frame)/seconds,timing=(video-previous.video)/seconds;
  const speed=target>0?timing/target*100:0;
  this.details=`Rendered: ${rendered.toFixed(1)} FPS\nEmulation: ${speed.toFixed(0)}% normal speed (${target} Hz video timing)\nWASM heap: ${(heap/1048576).toFixed(0)} MiB\nDisc cache: ${((this.disc.cachedBytes||0)/1048576).toFixed(1)} / 16 MiB\nBrowser/GPU memory and GPU execution time are not measured.`;
  this.element.textContent=`PS2 · ${rendered.toFixed(1)} FPS · ${speed.toFixed(0)}% · ${(heap/1048576).toFixed(0)} MiB`;
  this.element.hidden=!perfEnabled();
 }
 dispose(){clearInterval(this.timer);this.element.remove();}
}
