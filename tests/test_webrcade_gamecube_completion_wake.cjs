// Actual patched replay scheduler + fake clock + real completion microtasks.
// No browser, native build, ROM, or GPU is needed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const adapter=path.join(root,'deploy/webrcade/retro-dolphin');
const patched=execFileSync('python3',['-c',`
import importlib.util, pathlib, sys
spec=importlib.util.spec_from_file_location('runtime_patch',sys.argv[1])
patch=importlib.util.module_from_spec(spec);spec.loader.exec_module(patch)
print(patch.patch_replay_pump(pathlib.Path(sys.argv[2]).read_text()))
`,path.join(adapter,'patch-runtime.py'),path.join(__dirname,'fixtures/gamecube-replay-pump.js')],{encoding:'utf8'});
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
(async()=>{
 const {GpuFrameQueue}=await import(pathToFileURL(path.join(adapter,'app/gpu-frame-queue.mjs')));
 const {FrameLimit}=await import(pathToFileURL(path.join(adapter,'app/frame-limit.mjs')));
 function fixture({records=3,full=true,cap=false,mapped=false}={}){
  let now=0,id=0,maximumTimers=0;
  const timers=new Map(),pending=[],consumed=[],errors=[];
  const frames=new GpuFrameQueue({now:()=>now,onError:error=>{
   errors.push(error.message);context.wgpuReplayFatal=error;
   vm.runInContext('cancelWgpuReplayPump()',context);
  }});
  const limit=new FrameLimit(60);if(cap)limit.presented(0);
  const gpu={onSubmittedWorkDone:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))};
  if(full){frames.submitted(gpu);frames.submitted(gpu);}
  const timing={completionWakes:0,completionUsefulDrains:0,completionNoWorkWakes:0,completionToDrainTotalMs:0,completionToDrainMaxMs:0};
  const context=vm.createContext({
   performance:{now:()=>now},Atomics,gamecubeGpuFrames:frames,gamecubeFrameLimit:limit,gamecubeReplayTiming:timing,
   wgpuReplayPumpEnabled:true,wgpuReplayPumpTimer:null,wgpuReplayPumpDueAt:0,wgpuReplayPumpScheduledAt:0,
   wgpuReplayYieldPending:false,wgpuMappedCapacityBlocked:mapped,wgpuReplayFatal:null,
   causalMetricsEnabled:false,wgpuReplayBudgetMs:0,webGpuCmdRing:{headerI32:new Int32Array(new SharedArrayBuffer(4)),read:0},
   webGpuCausalStats:{replayPumpDrainCount:0,replayPumpEmptyPollCount:0,replayPumpScheduleCount:0,replayPumpBacklogScheduleCount:0,replayPumpIdleScheduleCount:0},
   currentWgpuReadIndex:ring=>ring.read,
   setTimeout:(callback,delay)=>{timers.set(++id,{callback,at:now+delay});maximumTimers=Math.max(maximumTimers,timers.size);return id;},
   clearTimeout:id=>timers.delete(id),
   drainWebGpuCmdRing:()=>{
    if(frames.blocked()||context.wgpuMappedCapacityBlocked||limit.remaining(now)>0)return;
    const ring=context.webGpuCmdRing;
    if(ring.read!==ring.headerI32[0]){
     consumed.push({record:ring.read++,at:now});frames.submitted(gpu);limit.presented(now);
    }
   },
  });
  context.webGpuCmdRing.headerI32[0]=records;
  vm.runInContext(patched,context);
  function tick(ms){
   const end=now+ms;let loops=0;
   while(true){
    const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
    if(!next||next[1].at>end)break;
    assert(++loops<1000,'no spinning pump');now=next[1].at;timers.delete(next[0]);next[1].callback();
   }
   now=end;
  }
  return {context,frames,limit,pending,consumed,errors,timers,timing,tick,
   run:code=>vm.runInContext(code,context),now:()=>now,due:()=>[...timers.values()].map(x=>x.at),maximumTimers:()=>maximumTimers};
 }
 // Backlog behind a full queue waits for a completion, not the next 4ms poll.
 {
  const f=fixture();f.run('startWgpuReplayPump()');f.tick(0);assert.deepEqual(f.due(),[4]);
  f.tick(1);f.pending[0].resolve();f.pending[1].resolve();await flush();
  assert.deepEqual(f.due(),[1]);assert.equal(f.timing.completionWakes,1,'same-turn completions coalesce');
  assert.equal(f.consumed.length,0,'completion does not drain inline');f.tick(0);
  assert.deepEqual(f.consumed,[{record:0,at:1}]);assert.equal(f.timing.completionUsefulDrains,1);
  assert.equal(f.maximumTimers(),1);assert.equal(f.frames.snapshot().maximum,2);
  assert.equal(f.context.webGpuCmdRing.read,1,'ordered ring owns unread work');
 }
 // Completion respects the absolute 60Hz deadline (including timer rounding).
 {
  const f=fixture({cap:true});f.run('startWgpuReplayPump()');f.tick(0);f.tick(5);
  f.pending[0].resolve();await flush();assert.deepEqual(f.due(),[17]);
  f.tick(11);assert.equal(f.consumed.length,0);f.tick(1);
  assert.deepEqual(f.consumed,[{record:0,at:17}]);assert.equal(f.timing.completionToDrainTotalMs,12);
  assert.equal(f.timing.completionToDrainMaxMs,12);assert.equal(f.maximumTimers(),1);
 }
 // Repeated completion bursts never create extra pumps, catch-up credits,
 // reordered records, or more than two outstanding frame tokens.
 {
  const f=fixture({records:24});f.run('startWgpuReplayPump()');f.tick(0);
  for(let i=0;i<24;i++){
   f.pending.forEach(token=>token.resolve());await flush();f.tick(17);
  }
  assert.equal(f.consumed.length,24);
  for(let i=0;i<24;i++){
   assert.equal(f.consumed[i].record,i);
   if(i)assert(f.consumed[i].at-f.consumed[i-1].at>=1000/60);
  }
  assert.equal(f.frames.snapshot().maximum,2);assert.equal(f.maximumTimers(),1);
 }
 // Full queue without unread ring work never arms a wake. New producer work
 // and ordinary completions use the existing bounded fallback, as before.
 {
  const f=fixture({records:0});f.run('startWgpuReplayPump()');f.tick(0);f.tick(1);
  f.context.webGpuCmdRing.headerI32[0]=1;f.pending[0].resolve();await flush();
  assert.deepEqual(f.due(),[4]);assert.equal(f.timing.completionWakes,0);f.tick(3);
  assert.equal(f.consumed.length,1);
 }
 // Mapped buffer capacity has its own lifetime. A GPU completion cannot turn
 // that blocked retry into an immediate drain or a zero-delay polling loop.
 {
  const f=fixture({mapped:true});f.run('startWgpuReplayPump()');f.tick(0);f.tick(1);
  f.pending[0].resolve();await flush();assert.deepEqual(f.due(),[4]);
  assert.equal(f.timing.completionWakes,0);f.context.wgpuMappedCapacityBlocked=false;
  f.tick(3);assert.equal(f.consumed.length,1);assert.equal(f.maximumTimers(),1);
 }
 // A ring emptied by another permitted drain after completion is observable as
 // a no-work wake, without consuming or inventing a frame.
 {
  const f=fixture();f.run('startWgpuReplayPump()');f.tick(0);f.tick(1);
  f.pending[0].resolve();await flush();f.context.webGpuCmdRing.read=3;f.tick(0);
  assert.equal(f.timing.completionNoWorkWakes,1);assert.equal(f.timing.completionUsefulDrains,0);
  assert.equal(f.consumed.length,0);assert.deepEqual(f.due(),[5]);
 }
 // Exit invalidates even an already captured callback. Restart still has one
 // pump; old completions cannot resurrect a cancelled pump.
 {
  const f=fixture();f.run('startWgpuReplayPump()');f.tick(0);
  const old=[...f.timers.values()][0].callback;f.run('cancelWgpuReplayPump()');
  f.pending[0].resolve();await flush();assert.equal(f.timers.size,0);old();assert.equal(f.timers.size,0);
  f.run('startWgpuReplayPump();startWgpuReplayPump()');assert.equal(f.timers.size,1);old();assert.equal(f.timers.size,1);
  assert.equal(f.maximumTimers(),1);
 }
 // Rejection goes through fatal shutdown and never creates a success wake.
 {
  const f=fixture();f.run('startWgpuReplayPump()');f.tick(0);
  f.pending[0].reject(Error('device lost'));await flush();
  assert.deepEqual(f.errors,['device lost']);assert.equal(f.timers.size,0);
  f.pending[1].resolve();await flush();assert.equal(f.timers.size,0);assert.equal(f.timing.completionWakes,0);
 }
 // A drain can itself synchronously fail/detach. Its callback must not
 // recreate a timer after emergency cancellation or dereference a lost ring.
 {
  const f=fixture();f.run('startWgpuReplayPump()');f.tick(0);
  f.pending[0].resolve();await flush();
  f.context.drainWebGpuCmdRing=()=>{
   f.run('cancelWgpuReplayPump()');f.context.wgpuReplayFatal=Error('submit failure');f.context.webGpuCmdRing=null;
  };
  f.tick(0);assert.equal(f.timers.size,0);assert.equal(f.consumed.length,0);
 }
 // Device reset epochs reject stale success/error promises and their waiters;
 // current queue submissions still retire and wake normally.
 {
  const f=fixture();let wakes=0;f.frames.waitForCapacity(()=>wakes++);f.frames.reset();
  f.pending[0].reject(Error('old device'));f.pending[1].resolve();await flush();
  assert.deepEqual(f.errors,[]);assert.equal(wakes,0);assert.equal(f.frames.snapshot().pending,0);
  f.frames.waitForCapacity(()=>wakes++);assert.equal(wakes,1,'capacity freed before subscribe cannot lose wake');
  const tokens=[];const gpu={onSubmittedWorkDone:()=>new Promise(resolve=>tokens.push(resolve))};
  f.frames.submitted(gpu);f.frames.submitted(gpu);f.frames.waitForCapacity(()=>wakes++);
  tokens[0]();await flush();assert.equal(wakes,2);assert.equal(f.frames.snapshot().pending,1);
  f.frames.waitForCapacity(()=>wakes++);assert.equal(wakes,3);tokens[1]();await flush();assert.equal(wakes,3);
 }
 // Synchronous queue API failures also cancel an armed waiter.
 {
  const pending=[],errors=[];let wakes=0;
  const q=new GpuFrameQueue({onError:e=>errors.push(e.message)});
  const gpu={onSubmittedWorkDone:()=>new Promise(r=>pending.push(r))};q.submitted(gpu);q.submitted(gpu);
  q.waitForCapacity(()=>wakes++);q.submitted({onSubmittedWorkDone(){throw Error('sync failure');}});
  pending.forEach(resolve=>resolve());await flush();assert.deepEqual(errors,['sync failure']);assert.equal(wakes,0);
 }
 console.log('PASS completion-only GameCube wake: coalescing, deadline, ring order, mapped capacity, no-work attribution, lost wake, exit and device generations');
})().catch(error=>{console.error(error);process.exitCode=1;});
