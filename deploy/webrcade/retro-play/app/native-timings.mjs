// Sparse native wall timings. Never extrapolate samples to utilization or FPS.
const baselines = new WeakMap();
export function setNativeTimingEnabled(module, enabled, reset=false) {
 if(reset && enabled) module.setNativeTimingEnabled?.(false);
 module.setNativeTimingEnabled?.(enabled);
 baselines.delete(module);
}
const fmt = value => Number.isFinite(value) ? value.toFixed(2) : '—';
const validDelta = (now, before, name) => {
 const value = now?.[name] - before?.[name];
 return Number.isFinite(value) && value >= 0 ? value : null;
};
export function sampleNativeTiming(module) {
 if(!module.nativeCpuTiming) return {line:'Native timing unavailable',details:'This core has no native timing counters.'};
 const cpu=module.nativeCpuTiming(), movie=module.nativeMovieTiming?.();
 const old=baselines.get(module);baselines.set(module,{cpu,movie});
 if(!cpu.enabled || !old || cpu.epoch!==old.cpu.epoch)
  return {line:'Native timing: collecting samples',details:'Native timing window starts with the next sample.'};
 const categories=[];
 for(const current of cpu.categories) {
  const previous=old.cpu.categories.find(item=>item.name===current.name);
  const calls=validDelta(current,previous,'calls'),samples=validDelta(current,previous,'samples'),us=validDelta(current,previous,'microseconds');
  if(calls===null||samples===null||us===null)continue;
  const sparse=['EE','IOP','VU','SPU'].includes(current.name);
  categories.push({name:current.name,text:sparse?`${current.name} ${samples?fmt(us/1000/samples):'—'} ms/sample (${samples}/${calls} calls)`:`${current.name} ${fmt(us/1000)} ms (${samples} completed)`});
 }
 const movieLines=[];
 if(movie && old.movie && movie.epoch===old.movie.epoch && movie.epoch===cpu.epoch) {
  const delta=name=>validDelta(movie,old.movie,name);
  for(const [title,prefix] of [['IDCT','idct'],['CSC','csc']]) {
   const count=delta(`${prefix}Samples`),us=delta(`${prefix}Microseconds`);
   if(count!==null&&us!==null)movieLines.push(`${title} ${count?fmt(us/1000/count):'—'} ms/sample (${count})`);
  }
  movieLines.push(`Movie blocks coded ${delta('codedBlocks')??'—'}, uncoded ${delta('uncodedBlocks')??'—'}; IDCT zero/DC/AC ${delta('zeroBlocks')??'—'}/${delta('dcOnlyBlocks')??'—'}/${delta('acBlocks')??'—'}`);
 }
 const line=categories.filter(item=>['EE','Compile','GSSync'].includes(item.name)).map(item=>item.text).join(' · ');
 const details=[...categories.map(item=>item.text),...movieLines,
  'Native timings are host wall time, not CPU utilization. EE/IOP/VU/SPU use sparse execution-slice samples; measured nested scopes are excluded on the same thread. Compile and blocked boundaries time every completed call. GSWait is graphics-worker bridge acknowledgement; GSSync is caller-side synchronous GS mailbox wait; these overlap across workers. DiscWait includes bridge/copy/network/polling. Movie samples are inclusive and overlap execution. Counters are asynchronous; samples can cross readout windows. No extrapolation to per-frame CPU time.'].join('\n');
 return {line,details};
}
