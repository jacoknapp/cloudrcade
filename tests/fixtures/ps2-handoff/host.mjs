import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {Ps2Gpu:Baseline}=await import(pathToFileURL(process.argv[2]));
import {Ps2Gpu as Candidate} from '../../../deploy/webrcade/retro-play/app/gpu.mjs';
import {HandoffTrace} from '../../../deploy/webrcade/retro-play/app/handoff.mjs';
import {Ps2Performance} from '../../../deploy/webrcade/retro-play/app/perf.mjs';
async function exercise(Type,diagnostic){
 const core={HEAPU8:new Uint8Array(new SharedArrayBuffer(5*1024*1024))};
 const calls=[],errors=[];let release,flag=0,waitPending=false;
 const module={HEAPU8:new Uint8Array(12*1024*1024),_malloc:()=>16,_free:()=>{},
  _gpu_write:(p,n)=>calls.push(['write',n]),_gpu_image:(p,n)=>calls.push(['image',n]),
  _gpu_set_timing:()=>{},
  _gpu_present:()=>{calls.push(['present']);return 1;},
  _gpu_batch:()=>{calls.push(['batch',flag]);return flag;},_gpu_state_size:()=>8,
  _gpu_seed_download_snapshot:(p,n)=>calls.push(['seed',n]),
  ccall:async(name,type,types,args)=>{calls.push([name,...args]);
   if(name==='gpu_wait'){waitPending=true;await new Promise(r=>release=r);waitPending=false;}
   if(name==='gpu_save'){module.HEAPU8.set([1,2,3,4,5,6,7,8],128);return 128;}
   if(name==='gpu_download')module.HEAPU8.fill(87,args[0],args[0]+4*1024*1024);
   if(name==='gpu_download_snapshot_range')module.HEAPU8.fill(43,args[0]+args[1],args[0]+args[1]+args[2]);
  }};
 const gpu=new Type(core,e=>errors.push(e));gpu.module=module;
 if(diagnostic){gpu.setTimingEnabled(true,1);gpu.handoff.now=()=>100+rid;}
 else assert(gpu.handoff==null);
 const ack=4,words=new Int32Array(core.HEAPU8.buffer),results=[];
 let rid=100;
 async function call(op,size=0,display=false){
  Atomics.store(words,ack/4,0);gpu.nativeCall(op,1024,size,2048,ack,++rid,9,3);
  if(display){for(let i=0;i<20&&!waitPending;++i)await Promise.resolve();assert(waitPending);assert.equal(Atomics.load(words,ack/4),0);release();}
  await gpu.chain;results.push(Atomics.load(words,ack/4));assert.equal(gpu.pending,0);
 }
 await call(1,16);await call(2,16);await call(3,104,true);await call(4);
 assert.deepEqual([...core.HEAPU8.slice(2048,2056)],[1,2,3,4,5,6,7,8]);
 await call(5,16);await call(6);await call(7);assert.equal(core.HEAPU8[2048],87);
 flag=0;await call(8,16);flag=6;await call(8,16,true);
 const descriptor=new DataView(core.HEAPU8.buffer,1024,8);descriptor.setUint32(0,8,true);descriptor.setUint32(4,16,true);
 await call(9,8);assert.equal(core.HEAPU8[2048],43);await call(10,4*1024*1024);
 assert.equal(errors.length,0);
 const trace=gpu.handoff?.snapshot();
 if(trace){assert.equal(trace.dropped,0);assert.equal(trace.events.filter(e=>e.stage==='ack_publish').length,11);
  const one=trace.events.filter(e=>e.request===103);const stages=one.map(e=>e.stage);
  assert(stages.indexOf('gpu_wait_end')<stages.indexOf('ack_publish'));
  assert(trace.events.every(e=>!Object.keys(e).some(k=>/pointer|ack$|output|payload|buffer|^op$|size|result/.test(k))));
  const copy=gpu.handoff.snapshot();copy.events[0].stage='changed';assert.notEqual(gpu.handoff.snapshot().events[0].stage,'changed');
 }
 return {calls,results};
}
assert.deepEqual(await exercise(Candidate,true),await exercise(Baseline,false));
const originalPerformance=globalThis.performance;globalThis.performance={get timeOrigin(){throw Error('disabled clock');},now(){throw Error('disabled clock');}};
try{assert.deepEqual(await exercise(Candidate,false),await exercise(Baseline,false));}finally{globalThis.performance=originalPerformance;}
const bounded=new HandoffTrace(()=>123);bounded.capacity=2;bounded.setEnabled(true,1);
for(let i=0;i<7;++i)bounded.mark('fixture',i,0,3,1);
assert.equal(bounded.snapshot().dropped,5);bounded.setEnabled(false,2);bounded.mark('off',1,0,3,2);assert.equal(bounded.snapshot().dropped,5);
bounded.setEnabled(true,3);bounded.mark('stale',1,0,3,1);assert.equal(bounded.snapshot().dropped,5);bounded.mark('new',1,0,5,3);assert.equal(bounded.snapshot().dropped,6);
const fault=new HandoffTrace(()=>{throw Error('fixture clock failure');});fault.setEnabled(true,1);assert.doesNotThrow(()=>fault.mark('ack_publish',1,0,3,1));assert.equal(fault.snapshot().failed,true);
let preference=false,snapshots=0,removed=false;const cpuFlags=[],gpuFlags=[];
globalThis.localStorage={getItem:()=>preference?'1':null};
globalThis.document={createElement:()=>({setAttribute(){},remove(){removed=true;}}),body:{append(){}}};
const api={setNativeTimingEnabled:value=>cpuFlags.push(value),nativeHandoffSnapshot:()=>{snapshots++;return {events:[]};},cloudGpu:{setTimingEnabled:value=>gpuFlags.push(value),handoffSnapshot:()=>({events:[]})}};
const readout=new Ps2Performance(api,{});clearInterval(readout.timer);
assert.equal(snapshots,0);assert.deepEqual(api.handoffSnapshot(),{native:{events:[]},host:{events:[]}});
preference=true;readout.reset();assert.equal(cpuFlags.at(-1),true);assert.equal(gpuFlags.at(-1),true);
readout.reset(true);assert.equal(cpuFlags.at(-1),false);assert.equal(gpuFlags.at(-1),false);
assert.equal(snapshots,1);readout.dispose();assert.equal(api.handoffSnapshot,undefined);assert(removed);
delete globalThis.document;delete globalThis.localStorage;
console.log(JSON.stringify({operations:11,command_result_state_readback_parity:true,display_ack_after_completion:true,disabled_clock_calls:0,bounded_host_drop_count:6,stale_epoch_rejected:true,snapshot_copy:true,diagnostic_failure_caught:true}));
