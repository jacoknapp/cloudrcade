// Rendered submissions, video callbacks and emulated time remain independent.
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
(async () => {
  const {GameCubePerf, perfEnabled, PERF_KEY} = await import(pathToFileURL(path.resolve(__dirname,
    '../deploy/webrcade/retro-dolphin/app/perf.mjs')));
  assert.equal(PERF_KEY,'webrcade.gamecube.perf.v1','matches the settings fallback namespace');
  assert.equal(perfEnabled({getItem:key=>{assert.equal(key,PERF_KEY);return null;}}),false);
  assert(perfEnabled({getItem:()=> '1'}));
  assert.equal(perfEnabled({getItem:()=> '0'}),false);
  assert.equal(perfEnabled({getItem:()=>{throw new Error('storage blocked');}}),false);
  const {nativeTimingDelta,nativeTimingDetails}=await import(pathToFileURL(path.resolve(__dirname,
    '../deploy/webrcade/retro-dolphin/app/native-timings.mjs')));
  const initial={v:1,enabled:true,epoch:1,slices:10,totalUs:100000,advanceInclUs:20000,
    executeInclUs:80000,compileSubsetUs:30000,throttleBlockedSubsetUs:10000,dvdBlockedSubsetUs:1000};
  const later={...initial,slices:30,totalUs:500000,advanceInclUs:100000,executeInclUs:400000,
    compileSubsetUs:70000,throttleBlockedSubsetUs:30000,dvdBlockedSubsetUs:11000};
  assert.equal(nativeTimingDelta(later,initial).compileSubsetUs,40000);
  const phases=nativeTimingDetails(later,initial,20);
  assert.match(phases.line,/execute 16.0 · compile 2.0 ms\/f/);
  assert.match(phases.lines.join('\n'),/inclusive/);
  assert.match(phases.lines.join('\n'),/subsets; do not add/);
  for(const changed of [{...later,enabled:false},{...later,epoch:2},{...later,slices:0},
    {...later,totalUs:NaN},{...later,totalUs:Number.MAX_SAFE_INTEGER+1}])
    assert.equal(nativeTimingDelta(changed,initial),null,'off, changed epoch, reset and invalid counters never invent rates');
  assert.equal(nativeTimingDetails(later,initial,0).line,'','no completed frames means no per-frame estimate');
  assert.equal(nativeTimingDetails(initial,initial,1).line,'','no completed native slices means no estimate');
  globalThis.WrcadCloudConfig={storagePrefix:'monitor-fixture'};
  const configured=await import(pathToFileURL(path.resolve(__dirname,
    '../deploy/webrcade/retro-dolphin/app/perf.mjs'))+'?namespace');
  assert.equal(configured.PERF_KEY,'monitor-fixture.gamecube.perf.v1');
  assert(configured.perfEnabled({getItem:key=>key==='monitor-fixture.gamecube.perf.v1'?'1':null}),
    'the game honors the checkbox preference in the configured namespace');
  delete globalThis.WrcadCloudConfig;
  const element = {}, perf = new GameCubePerf(element);
  const frame = (ms,count,ticks,generation=0)=>({capturedAtMs:ms,frame:count,coreTicks:ticks,
    coreTicksPerSecond:486000000,loadedCheckpointGeneration:generation,width:640,height:528,heapBytes:1.5*1024**3,gamecubeDiagnostics:{render:{frames:count,epoch:generation,samples:30,p95Ms:33.4,maxMs:34,ageMs:4}}});
  perf.sample(frame(1000,30,486000000));
  perf.sample(frame(2000,60,972000000));
  assert.equal(element.textContent,'GameCube 30.0 rendered fps  100% speed\nWebGPU · 640×528 · 1536 MiB');
  perf.sample(frame(3000,75,1215000000));
  assert.match(element.textContent,/15.0 rendered fps  50% speed/);
  perf.reset(true);perf.sample(frame(15000,80,1250000000));
  assert.equal(element.textContent,'GameCube paused');
  perf.reset();perf.sample(frame(16000,80,1250000000));
  assert.equal(element.textContent,'GameCube measuring…','resume excludes the paused time');
  perf.sample(frame(17000,110,1736000000));assert.match(element.textContent,/100% speed/);
  perf.sample(frame(18000,60,972000000,1));
  assert.equal(element.textContent,'GameCube measuring…','a loaded state starts a fresh sample');
  perf.sample(frame(19000,90,1458000000,1));assert.match(element.textContent,/30.0 rendered fps  100% speed/);
  perf.sample(frame(19500,100,1500000000,1));assert.match(element.textContent,/100% speed/,'subsecond replies do not flicker');
  perf.sample(frame(20000,10,100,1));assert.equal(element.textContent,'GameCube measuring…','counter resets never display negative rates');
  perf.sample({...frame(21000,40,486000100,1),width:160,height:112,renderWidth:640,renderHeight:480});
  assert.match(element.textContent,/WebGPU · 640×480/,'monitor reports the real GPU canvas, not its unused CPU image');
  assert.match(perf.details,/Core allocation: 1536 MiB/);
  assert.match(perf.details,/GPU execution time: unavailable/,'no invented GPU timing');
  assert.match(perf.details,/Presentation ceiling: 60/);
  const measured=frame(22000,70,972000100,1);measured.gamecubeDiagnostics={render:measured.gamecubeDiagnostics.render,stream:{waitMs:120,waitMaxMs:75,cachedChunks:8,cachedBytes:16*1024**2,pending:2,hits:4,misses:2,prefetchHits:3,bytesFetched:4*1024**2,requests:2,prefetchErrors:0},replay:{totalMs:80,maxMs:12},backlog:100,jit:'on',compiled:12,uploads:{transport:'queue',stagingBytes:0,scratchBytes:4*1024**2,pendingRemaps:0},rendererError:{kind:'validation',message:'test GPU fault'}};
  perf.sample(measured);assert.match(perf.details,/Disc cache: 8\/8 chunks/);assert.match(perf.details,/3 read-ahead hits/);
  assert.match(perf.details,/GPU uploads: queue · 0.0 MiB staging · 4.0 MiB host scratch · 0 remaps pending/);
  assert.match(perf.details,/test GPU fault/);
  const details=perf.details;perf.reset(true);assert.equal(perf.details,details,'menu retains last active sample');
  perf.setHeapSample({inUseBytes:512*1048576,reusableBytes:128*1048576,extentBytes:660*1048576,reservedBytes:768*1048576,queryMs:12});
  assert.match(perf.details,/512.0 MiB in use/);assert.match(perf.details,/sampled while paused/);
  assert.match(perf.details,/Heap inspection: 12.0 ms while paused/);
  const heapOnce=perf.details;perf.setHeapSample({inUseBytes:500*1048576,reusableBytes:140*1048576,extentBytes:660*1048576,reservedBytes:768*1048576,queryMs:10});
  assert.equal((perf.details.match(/Native malloc:/g)||[]).length,1);assert.equal((perf.details.match(/Heap inspection:/g)||[]).length,1);
  assert(perf.details.includes(details.split('\n')[0]),'fresh pause memory preserves the last active FPS window');
  // Sunshine can have 60 video callbacks and 30 actual rendered frames each
  // second. p95-derived presentationFps must not replace that average.
  const honest=new GameCubePerf({});honest.setGameId('GMSE01');
  const a=frame(1000,60,486000000),b=frame(2000,120,972000000);
  a.gamecubeDiagnostics.render.frames=30;b.gamecubeDiagnostics.render.frames=60;
  b.presentationFps=12;
  honest.sample(a);honest.sample(b);
  assert.match(honest.element.textContent,/30.0 rendered fps  100% speed/);
  assert.match(honest.element.textContent,/Target 30 fps/);
  assert.match(honest.details,/Video callbacks: 60.0\/s/);
  assert.match(honest.details,/p95 33.4 ms/);
  const stall=frame(3000,180,1458000000);stall.gamecubeDiagnostics.render={...b.gamecubeDiagnostics.render,ageMs:1004};
  honest.sample(stall);assert.match(honest.element.textContent,/0.0 rendered fps  100% speed/,'GPU stall cannot look like 60 fps');
  const resumed=frame(4000,240,1944000000);resumed.gamecubeDiagnostics.render={frames:61,epoch:9};
  honest.sample(resumed);assert.equal(honest.element.textContent,'GameCube measuring…','new render epoch excludes pause/load gaps');
  const noStats=frame(5000,300,2430000000);delete noStats.gamecubeDiagnostics.render;
  honest.sample(noStats);const again=frame(6000,360,2916000000);delete again.gamecubeDiagnostics.render;honest.sample(again);
  assert.match(honest.element.textContent,/unavailable rendered fps/,'missing GPU measurement never uses callbacks as gameplay FPS');
  honest.setGameId('GMSP01');assert.equal(honest.targetFps,25);
  honest.setGameId('OTHER1');assert.equal(honest.targetFps,null,'unknown games do not get a guessed 30 fps target');
  const skipping=new GameCubePerf({});skipping.setGameId('GMSE01');
  const sa=frame(1000,60,486000000),sb=frame(2000,120,972000000);
  sa.gamecubeDiagnostics.render.frames=15;sb.gamecubeDiagnostics.render.frames=30;
  sa.gamecubeDiagnostics.frameSkip={divisor:2,skipped:15};sb.gamecubeDiagnostics.frameSkip={divisor:2,skipped:30};
  skipping.sample(sa);skipping.sample(sb);
  assert.match(skipping.element.textContent,/15.0 rendered fps  100% speed/);
  assert.match(skipping.element.textContent,/Target 15 fps.*2× frame skip/);
  assert.match(skipping.details,/Target: 15 rendered fps/,'omitted graphics do not lower the measured emulation speed');
  const {RenderStats}=await import(pathToFileURL(path.resolve(__dirname,'../deploy/webrcade/retro-dolphin/app/render-stats.mjs')));
  const stats=new RenderStats();assert.equal(stats.snapshot(0).ageMs,null);
  for(let i=0;i<1000;i++)stats.presented(i*1000/30);
  let snap=stats.snapshot(999*1000/30);assert.equal(snap.frames,1000);assert.equal(stats.size,256);assert.equal(snap.samples,30);
  assert(Math.abs(snap.p95Ms-1000/30)<.001);
  snap=stats.snapshot(999*1000/30+2000);assert.equal(snap.samples,0);assert.equal(snap.p95Ms,null);assert.equal(snap.ageMs,2000);
  const epoch=snap.epoch;stats.reset();stats.presented(100000);snap=stats.snapshot(100000);
  assert.equal(snap.frames,1001);assert.equal(snap.epoch,epoch+1);assert.equal(snap.samples,0,'paused interval excluded');
  console.log('PASS GameCube native fps/speed, switch, paused time and loaded-state resets');
})().catch(error=>{console.error(error);process.exitCode=1;});
