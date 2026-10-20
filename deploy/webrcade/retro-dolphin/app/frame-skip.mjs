// Skip only the final display pass. Offscreen GX work and audio always run.
export function frameSkipDivisor(value) {
  return [1,2,3,4].includes(Number(value)) ? Number(value) : 1;
}

export class FrameSkip {
  constructor() {
    this.divisor=1;this.requested=1;this.phase=0;this.decision=null;
    this.frames=0;this.skipped=0;
  }
  set(value) {
    this.requested=frameSkipDivisor(value);
    // A setting changed during a display pass takes effect at its boundary.
    if(this.decision===null){this.divisor=this.requested;this.phase=0;}
    return this.requested;
  }
  skip() {
    if(this.decision===null)this.decision=this.phase!==0;
    return this.decision;
  }
  complete() {
    const skipped=this.skip();this.frames++;if(skipped)this.skipped++;
    this.phase=(this.phase+1)%this.divisor;this.decision=null;
    if(this.divisor!==this.requested){this.divisor=this.requested;this.phase=0;}
    return skipped;
  }
  snapshot(){return {divisor:this.divisor,requested:this.requested,frames:this.frames,skipped:this.skipped};}
}

export function createFrameSkipControl(target,{onChange=()=>{}}={}) {
  const system=target.document.documentElement.dataset.cloudrcadeCore;
  const key=(target.WrcadCloudConfig?.storagePrefix||'webrcade')+'.'+system+'.frameSkip.v1';
  let value=1;try{value=frameSkipDivisor(target.localStorage.getItem(key));}catch{}
  const panel=target.document.createElement('label');panel.className='gc-frame-skip';
  panel.style.cssText='display:grid;gap:6px;margin:12px 0;font:inherit';
  panel.innerHTML='Frame skip <select aria-label="Frame skip"><option value="1">Off</option><option value="2">2×</option><option value="3">3×</option><option value="4">4×</option></select><small>Show every second, third or fourth frame. Audio continues.</small>';
  const select=panel.querySelector('select');select.value=String(value);
  select.style.cssText='width:100%;min-height:40px;font:inherit;color:inherit;background:#172033;border:1px solid #becff059;border-radius:6px;padding:6px';
  const mount=()=>{
    const drawer=target.document.getElementById('kt-drawer');
    if(drawer){drawer.insertBefore(panel,drawer.querySelector('.kt-edit'));observer.disconnect();}
  };
  const observer=new target.MutationObserver(mount);
  observer.observe(target.document.body,{childList:true,subtree:true});mount();
  select.onchange=async()=>{
    const previous=value,next=frameSkipDivisor(select.value);select.disabled=true;
    try{await onChange(next);value=next;try{target.localStorage.setItem(key,String(value));}catch{}}
    catch{select.value=String(previous);}
    finally{select.disabled=false;}
  };
  return {get value(){return value;}};
}
