// Native counters distinguish a 30 fps game at full speed from slow emulation.
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
(async () => {
  const {GameCubePerf, perfEnabled, PERF_KEY} = await import(pathToFileURL(path.resolve(__dirname,
    '../deploy/webrcade/retro-dolphin/app/perf.mjs')));
  assert(perfEnabled({getItem:key=>{assert.equal(key,PERF_KEY);return null;}}));
  assert.equal(perfEnabled({getItem:()=> '0'}),false);
  assert(perfEnabled({getItem:()=>{throw new Error('storage blocked');}}));
  const element = {}, perf = new GameCubePerf(element);
  const frame = (ms,count,ticks,generation=0)=>({capturedAtMs:ms,frame:count,coreTicks:ticks,
    coreTicksPerSecond:486000000,loadedCheckpointGeneration:generation,width:640,height:528,heapBytes:1.5*1024**3});
  perf.sample(frame(1000,30,486000000));
  perf.sample(frame(2000,60,972000000));
  assert.equal(element.textContent,'GameCube 30.0 core fps  100% speed\nWebGPU · 640×528 · 1536 MiB');
  perf.sample(frame(3000,75,1215000000));
  assert.match(element.textContent,/15.0 core fps  50% speed/);
  perf.reset(true);perf.sample(frame(15000,80,1250000000));
  assert.equal(element.textContent,'GameCube paused');
  perf.reset();perf.sample(frame(16000,80,1250000000));
  assert.equal(element.textContent,'GameCube measuring…','resume excludes the paused time');
  perf.sample(frame(17000,110,1736000000));assert.match(element.textContent,/100% speed/);
  perf.sample(frame(18000,60,972000000,1));
  assert.equal(element.textContent,'GameCube measuring…','a loaded state starts a fresh sample');
  perf.sample(frame(19000,90,1458000000,1));assert.match(element.textContent,/30.0 core fps  100% speed/);
  perf.sample(frame(19500,100,1500000000,1));assert.match(element.textContent,/100% speed/,'subsecond replies do not flicker');
  perf.sample(frame(20000,10,100,1));assert.equal(element.textContent,'GameCube measuring…','counter resets never display negative rates');
  console.log('PASS GameCube native fps/speed, switch, paused time and loaded-state resets');
})().catch(error=>{console.error(error);process.exitCode=1;});
