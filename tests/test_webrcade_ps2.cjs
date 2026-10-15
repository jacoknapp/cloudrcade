/* PS2 disc protocol, >4GiB offsets, bounded memory and Sony input contracts. */
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const root=path.resolve(__dirname,'../deploy/webrcade/retro-play/app');
(async()=>{
 const {remoteDisc,DiscDevice,CHUNK,LIMIT}=await import(pathToFileURL(path.join(root,'disc.mjs')));
 const {inputState,inputWriter,BUTTONS}=await import(pathToFileURL(path.join(root,'input.mjs')));
 const {validCard}=await import(pathToFileURL(path.join(root,'saves.mjs')));
 global.location={href:'https://arcade.example.test/play/'};
 let mode='good',bodyReads=0,canceled=0,requests=[];const size=5*1024**3+123;
 global.fetch=async(url,options)=>{
  if(options.method==='HEAD')return new Response(null,{headers:{'Content-Length':String(size),'ETag':'"disc-v1"'}});
  requests.push(options.headers.Range);assert.equal(options.headers['If-Range'],'"disc-v1"');
  const [,start,end]=/bytes=(\d+)-(\d+)/.exec(options.headers.Range).map(Number);
  const status=mode==='full'?200:206;
  const bytes=new Uint8Array(end-start+1);for(let i=0;i<bytes.length;i++)bytes[i]=(start+i)%251;
  const response=new Response(new ReadableStream({pull(controller){bodyReads++;controller.enqueue(mode==='short'?bytes.subarray(1):bytes);controller.close();},cancel(){canceled++;}}),{status,headers:{'Content-Range':`bytes ${start}-${end}/${size}`,'ETag':mode==='changed'?'"disc-v2"':'"disc-v1"'}});
  return response;
 };
 const disc=await remoteDisc('/content/ps2/Game.iso');assert.equal(disc.size,size);
 const offset=2**32+CHUNK-16,bytes=await disc.read(offset,64);
 assert.deepEqual([...bytes],Array.from({length:64},(_,index)=>(offset+index)%251));
 const direct=new Uint8Array(96).fill(255),fetched=requests.length;
 assert.equal(disc.copyCached(offset,64,direct,16),64);assert.deepEqual([...direct.subarray(16,80)],[...bytes]);assert.equal(requests.length,fetched,'cross-chunk cached reads need no fetch or asynchronous result buffer');
 direct.fill(255);assert.equal(disc.copyCached(20*CHUNK,64,direct,16),null);assert(direct.every(value=>value===255),'cache miss leaves destination untouched');
 assert.throws(()=>disc.copyCached(-1,4,direct,0),/Invalid/);
 assert.equal((await disc.read(size-3,16)).length,3);assert.equal((await disc.read(size,10)).length,0);
 for(let i=0;i<20;i++)await disc.read(i*CHUNK,64);
 assert(disc.cachedBytes<=CHUNK*LIMIT);assert(disc.transferred<size,'no complete DVD read');
 const module={HEAPU8:new Uint8Array(CHUNK*3)},errors=[];
 const device=new DiscDevice(module,disc,error=>errors.push(error));device.read(0,CHUNK-8,CHUNK+32);
 while(!device.isDone())await new Promise(resolve=>setTimeout(resolve,1));assert.equal(device.result(),CHUNK+32);
 assert.equal(module.HEAPU8[0],(CHUNK-8)%251);assert.deepEqual(errors,[]);
 device.close();assert.equal(disc.cachedBytes,0);await assert.rejects(disc.read(0,1),/closed/);
 assert.throws(()=>disc.copyCached(0,1,direct,0),/closed/);
 // An outstanding asynchronous miss must use a grown heap, and must never
 // overwrite native memory after exit closed the device.
 for(const close of [false,true]){
  let release;const oldHeap=new Uint8Array(64),moving={HEAPU8:oldHeap},lateErrors=[];
  const late=new DiscDevice(moving,{size:64,read:()=>new Promise(resolve=>release=resolve),close(){}},error=>lateErrors.push(error));
  late.read(16,0,4);moving.HEAPU8=new Uint8Array(128);if(close)late.close();release(new Uint8Array([1,2,3,4]));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual([...oldHeap],Array(64).fill(0));assert.equal(late.result(),close?-1:4);
  assert.deepEqual([...moving.HEAPU8.subarray(16,20)],close?[0,0,0,0]:[1,2,3,4]);assert.deepEqual(lateErrors,[]);
 }
 for(const bad of ['full','short','changed']){mode=bad;await assert.rejects(remoteDisc('/content/game.iso'),/ranges|Incomplete|changed/);}
 assert(canceled>=0);assert(bodyReads>0);
 const axes=inputState(new Set(['CROSS','L2','KeyH','KeyI']),null,{isControlDown:cid=>cid===13,getAxisValue:()=>0});
 assert(axes[0]&(1<<BUTTONS.CROSS));assert(axes[0]&(1<<BUTTONS.L2));assert(axes[0]&(1<<BUTTONS.START));assert.deepEqual(axes.slice(1),[255,128,128,1]);
 const pad=inputState(new Set(),{buttons:[{pressed:true}],axes:[-.5,.25,1,-1]});assert(pad[0]&(1<<BUTTONS.CROSS));assert.deepEqual(pad.slice(1),[65,160,255,1]);
 const inputs=[],writeInput=inputWriter((...state)=>inputs.push(state)),released=inputState(new Set());
 for(let frame=0;frame<120;frame++){writeInput(0,[...released]);writeInput(1,[...released]);}
 assert.equal(inputs.length,2,'unchanged controllers do not repeatedly cross the native boundary');
 writeInput(0,pad);writeInput(0,released);writeInput(1,[0,129,128,128,128]);
 assert.equal(inputs.length,5,'press, release and one-step analog changes are forwarded');
 writeInput(1,released,true);writeInput(1,released,true);assert.equal(inputs.length,7,'pause and disconnect can force neutral state');
 for(const name of ['mc0/save/data.bin','mc1/BASLUS/icon.sys'])assert(validCard(name));
 for(const name of ['../secret','mc0/../config','mc0/./file','/mc0/file','mc2/file','mc0//file','mc0/a\0b'])assert(!validCard(name),name);
 global.WrcadCloudConfig={storagePrefix:'metric_test'};const preferences=new Map();global.localStorage={getItem:key=>preferences.get(key)||null};
 const {enabled,perfEnabled}=await import(pathToFileURL(path.join(root,'preferences.mjs')));
 assert.equal(enabled(),false);assert.equal(perfEnabled(),false);preferences.set('metric_test.ps2.enabled.v1','1');assert(enabled());
 global.document={createElement:()=>({setAttribute(){},remove(){},textContent:''}),body:{append(){}}};
 const {Ps2Performance,FrameTimings}=await import(pathToFileURL(path.join(root,'perf.mjs')));
 let clock=0,clockReads=0;const metrics=new FrameTimings(()=>{clockReads++;return clock;});
 assert.equal(metrics.begin(),null);metrics.record('host',null,0);metrics.take();assert.equal(clockReads,0,'disabled timing never reads the clock');
 metrics.setEnabled(true);const epoch=metrics.epoch,start=metrics.begin();clock=2;metrics.record('gpuSubmit',start,epoch);metrics.gpuCall(epoch);metrics.present(epoch);
 clock=18;metrics.present(epoch);clock=50;metrics.present(epoch);
 const measured=metrics.take();assert.equal(measured.gpuSubmit,2);assert.equal(measured.calls,1);assert.equal(measured.frames,3);assert.equal(measured.last,32);assert.equal(measured.p95,32);assert.equal(measured.max,32);
 assert.equal(metrics.take().frames,0,'sampling consumes window totals');
 const stale=metrics.begin();metrics.reset();clock+=1000;metrics.record('disc',stale,epoch);metrics.present(epoch);metrics.gpuCall(epoch);
 assert.equal(metrics.take().disc,0);assert.equal(metrics.take().frames,0,'pause/state resets reject in-flight timings');
 for(let i=1;i<=400;i++){clock+=i;metrics.present(metrics.epoch);}const bounded=metrics.take();assert.equal(metrics.intervals.length,240);assert.equal(bounded.max,400);assert.equal(bounded.p95,388);
 metrics.setEnabled(false);const disabledReads=clockReads;metrics.begin();metrics.present(metrics.epoch);metrics.take();assert.equal(clockReads,disabledReads);
 let rendered=10,video=20;
 const monitor=new Ps2Performance({getFrames:()=>rendered,getVideoFrames:()=>video,getVideoRate:()=>60,HEAPU8:{length:256*1024**2}},{});
 assert(monitor.element.hidden,'readout off by default');monitor.sample(1000);rendered+=30;video+=60;monitor.sample(2000);
 assert(monitor.details.includes('30.0 FPS')&&monitor.details.includes('100% normal speed'),'rendered presents and emulated timing stay separate');
 preferences.set('metric_test.ps2.perf.v1','1');rendered+=30;video+=60;monitor.sample(3000);assert(!monitor.element.hidden);
 assert.equal(monitor.element.textContent,'PS2 measuring…');rendered+=30;video+=60;monitor.sample(4000);
 assert(monitor.element.textContent.includes('Frame')&&monitor.details.includes('not additive'));
 monitor.reset(true);monitor.sample(4000);assert.equal(monitor.element.textContent,'PS2 paused');monitor.dispose();
 const {pictureBounds,viewportKey}=await import(pathToFileURL(path.join(root,'viewport.mjs')));
 const windowOf=(width,height)=>{const value={innerWidth:width,innerHeight:height};value.top=value;return value;};
 for(const [width,height]of [[320,568],[390,844],[768,1024],[844,390]]){
  const parent=windowOf(width,height),scope=windowOf(width,height+60);scope.top=parent;scope.parent=parent;scope.frameElement={clientLeft:0,clientTop:0,getBoundingClientRect:()=>({left:0,top:0})};
  const safe={left:0,top:0,right:width,bottom:height+60},rect=pictureBounds({scope,safe,touch:true,controls:true});
  assert(rect.left>=0&&rect.top>=0&&rect.left+rect.width<=width+.01&&rect.top+rect.height<=height+.01,'picture fits the parent window');
  if(height>width)assert(rect.top+rect.height<=height-(width<600?370:280)-12-20+.01,'picture clears fixed default controls and gap');
  else assert.equal(rect.height,height,'landscape uses the visible window height');
  assert(Math.abs(rect.width/rect.height-4/3)<.00001);
  const before=viewportKey(scope);parent.visualViewport={width,height:height-30};assert.notEqual(viewportKey(scope),before,'parent visible viewport invalidates geometry');
  const after=viewportKey(scope);parent.scrollY=20;assert.notEqual(viewportKey(scope),after,'parent scroll invalidates geometry');
 }
 // GPU requests acknowledge failures and use the current grown shared heap.
 const {Ps2Gpu}=await import(pathToFileURL(path.join(root,'gpu.mjs')));
 const core={HEAPU8:new Uint8Array(new SharedArrayBuffer(1024))},gpuErrors=[];
 const gpu=new Ps2Gpu(core,error=>gpuErrors.push(error.message));
 let batchFlags=1;
 let presented=0;const gpuCalls=[];
 gpu.module={HEAPU8:new Uint8Array(8*1024*1024),_malloc:()=>16,_free(){},_gpu_write(pointer,count){assert.equal(count,3);assert.deepEqual([...this.HEAPU8.subarray(pointer,pointer+12)],Array.from({length:12},(_,i)=>i));},_gpu_batch(){return batchFlags;},_gpu_present(){presented++;return 1;},_gpu_destroy(){gpuCalls.push('destroy');},async ccall(name){gpuCalls.push(name);assert(['gpu_wait','gpu_reset'].includes(name));await new Promise(resolve=>setTimeout(resolve,2));}};
 core.HEAPU8.set(Array.from({length:12},(_,i)=>i),16);
 gpu.nativeCall(1,16,12,0,128);await gpu.chain;assert.equal(Atomics.load(new Int32Array(core.HEAPU8.buffer),32),1);
 core.HEAPU8=new Uint8Array(new SharedArrayBuffer(2048));
 gpu.nativeCall(3,16,32,0,128);await gpu.chain;assert.equal(presented,1);assert.equal(Atomics.load(new Int32Array(core.HEAPU8.buffer),32),2);
 assert.deepEqual(gpuCalls,['gpu_wait'],'each display completes before its native acknowledgement');
 gpu.nativeCall(3,16,32,0,128);await gpu.chain;assert.equal(presented,2);assert.deepEqual(gpuCalls,['gpu_wait','gpu_wait'],'display cadence keeps every-present fences');
 gpu.nativeCall(3,16,32,0,128);await gpu.chain;
 gpu.nativeCall(6,0,0,0,128);await gpu.chain;assert.deepEqual(gpuCalls,['gpu_wait','gpu_wait','gpu_wait','gpu_reset'],'reset follows completed displays');
 gpu.nativeCall(3,16,32,0,128);await gpu.chain;
 // Capacity-only batches do not invent displays; every display batch fences.
 const beforeBatch=gpuCalls.length;
 gpu.nativeCall(8,0,0,0,128);await gpu.chain;
 assert.equal(gpuCalls.length,beforeBatch);assert.equal(Atomics.load(gpu.ackWords,32),1);
 batchFlags=3;gpu.nativeCall(8,0,0,0,128);await gpu.chain;
 assert.equal(gpuCalls.at(-1),'gpu_wait');assert.equal(Atomics.load(gpu.ackWords,32),1);
 batchFlags=7;gpu.nativeCall(8,0,0,0,128);await gpu.chain;
 assert.equal(Atomics.load(gpu.ackWords,32),2);
 gpu.nativeCall(99,0,0,0,128);await gpu.chain;assert.equal(Atomics.load(new Int32Array(core.HEAPU8.buffer),32),-1);assert.match(gpuErrors[0],/Invalid PS2 graphics command/);
 await gpu.dispose();assert.equal(gpu.module,null);assert.doesNotThrow(()=>gpu.nativeCall(1,0,12,0,128));
 assert.equal(gpuCalls.at(-1),'destroy');assert.equal(gpuCalls.filter(name=>name==='gpu_wait').length,6,'all submitted displays drain before failure/disposal');
 // Real adapter accounting separates synchronous submission from async wait.
 const timedCore={HEAPU8:new Uint8Array(new SharedArrayBuffer(1024)),cloudTimings:new FrameTimings(()=>clock)};
 const tracked=timedCore.cloudTimings;tracked.setEnabled(true);
 const timedGpu=new Ps2Gpu(timedCore,error=>{throw error;});
 timedGpu.module={HEAPU8:new Uint8Array(1024),_malloc:()=>16,_free(){},_gpu_destroy(){},_gpu_batch(){clock+=4;return 7;},async ccall(){clock+=12;}};
 timedGpu.nativeCall(8,0,0,0,128);clock+=3;await timedGpu.chain;
 const gpuTiming=tracked.take();assert.equal(gpuTiming.gpuSubmit,4);assert.equal(gpuTiming.gpuWait,12);assert.equal(gpuTiming.bridge,3);assert.equal(gpuTiming.frames,1);assert.equal(gpuTiming.calls,1);
 await timedGpu.dispose();
 const nativeFailure=new Ps2Gpu(core,error=>assert.match(error.message,/WebGPU operation failed/));nativeFailure.fail(17);await nativeFailure.dispose();
 console.log('PASS PS2 strict range reads, >4GiB offsets, LRU budget, cleanup, DualShock input and save path isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});
