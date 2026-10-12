/* Synthetic GameCube adapter contracts: no runtime, ROMs, keys or accounts. */
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../deploy/webrcade/retro-dolphin/app');

function disc({magic = 0xc2339f3d, wii = false, name = 'fixture.iso'} = {}) {
  const header = Buffer.alloc(32);
  header.write('TEST01'); header.writeUInt32BE(magic, 28);
  if (wii) header.writeUInt32BE(0x5d1c9ea3, 24);
  return {name, size: 2 ** 31, slice(start,end) {
    assert.equal(start,0); assert.equal(end,32,'only the header is read');
    return new Blob([header]);
  }, arrayBuffer() { throw new Error('Whole-disc allocation is forbidden'); }};
}
function fake() {
  const calls = {load:0, terminated:0, rejected:0, started:0, paused:0, mounted:null, input:null, inputCalls:0};
  return {calls, loaded:false, worker:{terminate() { calls.terminated++; }},
    async load() { calls.load++; this.loaded = true; }, setAudioMuted(value) { assert.equal(value,true); },
    async mountGame(file) { calls.mounted = file; return {fullCore:true, coreBoot:{accepted:true}}; },
    start() { calls.started++; }, pause() { calls.paused++; },
    async request(type) { assert(['start','pause'].includes(type)); if(type==='start')calls.started++;else calls.paused++;return {}; }, applyFrame() {},
    setInputState(state) { calls.input = {...state}; calls.inputCalls++; }, pollFrame() {},
    rejectAll() { calls.rejected++; }, frameData:new Uint8Array(4)};
}
(async () => {
  const {requireCapabilities, requireHardwareGpu, inspectDisc, GameCubeSession} = await import(pathToFileURL(path.join(root,'session.mjs')));
  const {padState, BUTTONS} = await import(pathToFileURL(path.join(root,'input.mjs')));
  const scope = {isSecureContext:true, crossOriginIsolated:true, SharedArrayBuffer, Worker:function(){},
    navigator:{gpu:{requestAdapter:async()=>({info:{isFallbackAdapter:false,description:'device GPU'}})}}};
  const canvas = {transferControlToOffscreen(){return {};}};
  const options = {scope,canvas};
  requireCapabilities(scope);
  for (const key of Object.keys(scope)) assert.throws(() => requireCapabilities({...scope,[key]:false}), /requires/);
  await requireHardwareGpu(scope);
  for (const info of [{isFallbackAdapter:true},{description:'SwiftShader'}]) {
    await assert.rejects(requireHardwareGpu({navigator:{gpu:{requestAdapter:async()=>({info})}}}), /device GPU/);
  }
  await assert.rejects(requireHardwareGpu({navigator:{gpu:{requestAdapter:async()=>null}}}), /device GPU/);
  await assert.rejects(requireHardwareGpu({navigator:{gpu:{requestAdapter:async()=>({
    requestAdapterInfo:async()=>({description:'llvmpipe'})})}}}),/device GPU/);
  assert.deepEqual(await inspectDisc(disc()), {gameId:'TEST01',size:2 ** 31});
  await assert.rejects(inspectDisc(disc({magic:0})), /no GameCube/);
  await assert.rejects(inspectDisc(disc({wii:true})), /Wii/);
  await assert.rejects(inspectDisc(disc({name:'fixture.rvz'})), /ISO or GCM/);

  const adapter = fake();
  const session = new GameCubeSession({...options, createAdapter:async config => {
    assert.equal(config.videoBackend,'WebGPU-Real'); assert.equal(config.presenterBackend,'webgpu');
    assert.equal(config.presentationScale,0.25,'only the unused CPU notification image is reduced');
    assert.equal(typeof config.transferCanvas,'function'); return adapter;
  }});
  await Promise.all([session.initialize(), session.initialize()]);
  assert.equal(adapter.calls.load,1,'parallel initialization shares one worker');
  const original = disc(); await session.boot(original);
  assert.equal(adapter.calls.mounted, original,'original File/Blob is mounted, without a full read');
  await assert.rejects(session.boot(disc()), /Close this session/);
  const state = padState(new Set(['A','STICK_UP','C_RIGHT','D_LEFT','L']));
  session.setInput(state); assert.deepEqual(adapter.calls.input,state);
  session.setInput({...state}); assert.equal(adapter.calls.inputCalls,1,'unchanged input never reaches the adapter');
  const reused={...state}; session.setInput(reused); reused.mask=0; session.setInput(reused);
  assert.equal(adapter.calls.inputCalls,2,'reusing a mutable input buffer still delivers changes');
  session.setInput(state);
  await session.pause(); assert.equal(adapter.calls.input.mask,0,'pause releases stuck buttons');
  session.setInput(state); assert.equal(adapter.calls.input.mask,0,'paused input is ignored');
  await session.resume(); assert.equal(adapter.calls.started,2);
  await session.pause();
  let acknowledgeStart;
  const requested=[];
  adapter.request=async type=>{requested.push(type);if(type==='start')await new Promise(resolve=>acknowledgeStart=resolve);return {};};
  const returning=session.resume();
  await new Promise(resolve=>setImmediate(resolve));
  const manualPause=session.pause();
  acknowledgeStart();await returning;await manualPause;
  assert.deepEqual(requested,['start','pause'],'manual pause is sent after an in-flight return');
  assert.equal(session.paused,true,'late return acknowledgement cannot undo manual pause');
  session.dispose(); session.dispose();
  assert.equal(adapter.calls.terminated,1); assert.equal(adapter.calls.rejected,1);
  assert.equal(session.adapter,null); assert.equal(adapter.frameData,null);
  await assert.rejects(session.initialize(), /closed/);

  const refused = fake(); refused.mountGame = async () => ({fullCore:true,coreBoot:{accepted:false}});
  await assert.rejects(new GameCubeSession({...options,createAdapter:async()=>refused}).boot(disc()), /did not boot/);
  assert.equal(refused.calls.started,0); assert.equal(refused.calls.terminated,1);
  const failedStart=fake(); failedStart.request=async()=>{throw new Error('presentation start failed');};
  await assert.rejects(new GameCubeSession({...options,createAdapter:async()=>failedStart}).boot(disc()),/presentation start failed/);
  assert.equal(failedStart.calls.terminated,1,'a rejected start never becomes a running session');
  const hung = fake(); hung.load = () => new Promise(()=>{});
  await assert.rejects(new GameCubeSession({...options,createAdapter:async()=>hung,timeoutMs:10}).initialize(), /timed out/);
  assert.equal(hung.calls.terminated,1,'a hung core cannot leave its worker behind');
  const closedDuringLoad = fake(); let finish;
  closedDuringLoad.load = () => new Promise(resolve=>{finish=resolve;});
  const cancelled = new GameCubeSession({...options,createAdapter:async()=>closedDuringLoad});
  const initializing = cancelled.initialize();
  await new Promise(resolve=>setImmediate(resolve)); cancelled.dispose(); finish();
  await assert.rejects(initializing,/closed/); assert.equal(closedDuringLoad.calls.terminated,1);
  const lateAdapter=fake(); let finishFactory;
  const timedFactory=new GameCubeSession({...options,timeoutMs:10,
    createAdapter:()=>new Promise(resolve=>{finishFactory=resolve;})});
  await assert.rejects(timedFactory.initialize(),/timed out/);
  finishFactory(lateAdapter); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(lateAdapter.calls.load,0); assert.equal(lateAdapter.calls.terminated,1,
    'an adapter delivered after timeout cannot leave a worker behind');

  const {JitLivenessGuard}=await import(pathToFileURL(path.join(root,'jit-guard.mjs')));
  const guard=new JitLivenessGuard();
  for(let i=0;i<100;i++)assert.equal(guard.stalled(i,i*1000),false,
    'a slow but progressing scene keeps JIT acceleration');
  assert.equal(guard.stalled(99,103999),false);
  assert.equal(guard.stalled(99,104000),true,'five seconds without progress trips the fuse');
  guard.reset();assert.equal(guard.stalled(99,200000),false,'pause/load resets the liveness window');
  assert.equal(guard.stalled(99,190000),false,'clock rollback resets the window');
  assert.equal(guard.stalled(NaN,200000),false);

  const {releaseGpuResource}=await import(pathToFileURL(path.join(root,'gpu-resources.mjs')));
  const events=[],texture={tex:{destroy(){events.push('destroy');}}};
  const maps={textures:new Map([[7,texture]]),buffers:new Map(),
    bindGroups:new Map([[8,{}]]),bindGroupSamplingMasks:new Map([[8,1]])};
  assert.equal(releaseGpuResource(maps,2,7,{flush:()=>false}),false);
  assert.equal(maps.textures.get(7),texture,'failed submission retains the live resource');
  assert.deepEqual(events,[]);
  assert.equal(releaseGpuResource(maps,2,7,{flush(){events.push('submit');return true;},
    invalidate(){events.push('invalidate');}}),true);
  assert.deepEqual(events,['submit','invalidate','destroy']);assert.equal(maps.textures.size,0);
  releaseGpuResource(maps,3,8,{flush(){throw new Error('bind group deletion needs no submit');}});
  assert.equal(maps.bindGroups.size,0);assert.equal(maps.bindGroupSamplingMasks.size,0);
  assert.equal(releaseGpuResource(maps,2,7,{flush(){throw new Error('already released');}}),true);

  const stalledAdapter=fake(),faults=[];
  const stalledSession=new GameCubeSession({...options,timeoutMs:10,createAdapter:async()=>stalledAdapter,
    onFatal:error=>faults.push(error.message)});
  await stalledSession.boot(disc());
  let polls=0;stalledAdapter.request=()=>{polls++;return new Promise(()=>{});};
  stalledSession.poll();stalledSession.poll();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(polls,1,'only one frame poll can be in flight');
  assert.equal(stalledSession.closed,true);assert.equal(stalledAdapter.calls.terminated,1);
  assert.deepEqual(faults,['GameCube core timed out.']);
  stalledSession.fail(new Error('late error'));assert.equal(faults.length,1,'a failure reports once');

  const gpuAdapter=fake(),gpuFaults=[];
  const gpuSession=new GameCubeSession({...options,createAdapter:async()=>gpuAdapter,
    onFatal:error=>gpuFaults.push(error.message)});
  await gpuSession.boot(disc());
  gpuAdapter.applyFrame({runtimeFailure:'WebGPU device-lost: test loss'});
  assert.equal(gpuSession.closed,true);assert.equal(gpuAdapter.calls.terminated,1);
  assert.deepEqual(gpuFaults,['WebGPU device-lost: test loss']);

  const failedWorker=fake(),workerFaults=[];
  failedWorker.worker=Object.assign(new EventTarget(),{terminate(){failedWorker.calls.terminated++;}});
  const workerSession=new GameCubeSession({...options,createAdapter:async()=>failedWorker,
    onFatal:error=>workerFaults.push(error.message)});
  await workerSession.boot(disc());
  failedWorker.worker.dispatchEvent(Object.assign(new Event('error'),{message:'WASM runtime trap'}));
  assert.equal(workerSession.closed,true);assert.equal(failedWorker.calls.terminated,1);
  assert.deepEqual(workerFaults,['WASM runtime trap']);

  const frozenAdapter=fake(),frozenFaults=[];
  const frozenSession=new GameCubeSession({...options,timeoutMs:10,createAdapter:async()=>frozenAdapter,
    onFatal:error=>frozenFaults.push(error.message)});
  await frozenSession.boot(disc());
  frozenAdapter.applyFrame({frame:100});
  frozenSession.progressAt=performance.now()-11;
  frozenAdapter.applyFrame({frame:100});
  assert.equal(frozenSession.closed,true);
  assert.deepEqual(frozenFaults,['GameCube stopped producing frames.'],
    'responsive worker with a frozen native CPU also reports failure');

  const abortedAdapter=fake(),abortFaults=[];
  abortedAdapter.worker=Object.assign(new EventTarget(),{terminate(){abortedAdapter.calls.terminated++;}});
  const abortedSession=new GameCubeSession({...options,createAdapter:async()=>abortedAdapter,
    onFatal:error=>abortFaults.push(error.message)});
  await abortedSession.boot(disc());
  abortedAdapter.worker.dispatchEvent(Object.assign(new Event('message'),
    {data:{type:'gamecube-fatal',message:'GameCube core aborted: OOM'}}));
  assert.equal(abortedSession.closed,true);assert.deepEqual(abortFaults,['GameCube core aborted: OOM']);

  assert.equal(state.stickY,224); assert.equal(state.cStickX,224);
  assert.equal(state.mask, BUTTONS.A|BUTTONS.D_LEFT|BUTTONS.L);
  assert.equal(state.triggerLeft,255); assert.equal(state.analogA,255);
  const neutral = padState(); assert.equal(neutral.stickX,128); assert.equal(neutral.cStickY,128);
  const buttons = Array.from({length:16},()=>({pressed:false,value:0}));
  buttons[7].value=.6; buttons[8].pressed=true;
  const pad = padState(new Set(),{mapping:'standard',axes:[.1,-1,1,0],buttons});
  assert.equal(pad.stickX,128,'deadzone rejects drift'); assert.equal(pad.stickY,224);
  assert.equal(pad.cStickX,224); assert.equal(pad.triggerRight,153);
  assert.equal(pad.mask,BUTTONS.R|BUTTONS.Z);
  assert.equal(padState(new Set(['STICK_LEFT','STICK_RIGHT'])).stickX,128);
  assert.deepEqual(padState(new Set(),{mapping:'',axes:[1,1,1,1],buttons}),neutral);

  const {remoteDisc,STREAM_THRESHOLD} = await import(pathToFileURL(path.join(root,'transport.mjs')));
  const header = Buffer.alloc(32); header.write('TEST01'); header.writeUInt32BE(0xc2339f3d,28);
  const requests=[];
  const fetcher=async(url,init)=>{requests.push(init.headers.Range);return new Response(header,{status:206,
    headers:{'Content-Range':`bytes 0-31/${STREAM_THRESHOLD+1}`,ETag:'"disc-v1"'}});};
  const remote=await remoteDisc('https://games.example/fixture.iso',{fetcher});
  assert.equal(remote.remote,true); assert.equal(remote.size,STREAM_THRESHOLD+1);
  assert.deepEqual(requests,['bytes=0-31'],'large URL images never fetch the full disc');
  const streamed = fake(); let remoteRequest;
  streamed.request=async(type,payload)=>{
    if(type === 'start') {streamed.calls.started++;return {};}
    assert.equal(type,'mountUrl');remoteRequest=payload;return {fullCore:true,coreBoot:{accepted:true}};
  };
  streamed.applyMetadata=()=>{};streamed.applyFrame=()=>{};
  const remoteSession=new GameCubeSession({...options,createAdapter:async()=>streamed});
  await remoteSession.boot(remote);
  assert.deepEqual(remoteRequest,{url:remote.url,name:remote.name,size:remote.size,validator:remote.validator});
  assert.equal(streamed.calls.mounted,null,'large URL games do not enter the local File loader');
  remoteSession.dispose();
  await assert.rejects(remoteDisc('https://games.example/fixture.iso',{fetcher:async()=>new Response(header)}), /exact HTTP/);
  let boundaryRequests=0;
  await assert.rejects(remoteDisc('https://games.example/fixture.iso',{fetcher:async()=>{
    if (++boundaryRequests === 2) throw new Error('bounded small-file path');
    return new Response(header,{status:206,headers:{'Content-Range':`bytes 0-31/${STREAM_THRESHOLD}`}});
  }}), /bounded small-file path/);
  await assert.rejects(remoteDisc('file:///fixture.iso'), /HTTP/);

  const {fetchDiscRange,discValidator} = await import(pathToFileURL(path.join(root,'range-fetch.mjs')));
  assert.equal(discValidator(new Headers({ETag:'W/"weak"'})),null);
  assert.deepEqual(discValidator(new Headers({'Last-Modified':'Sun, 11 Oct 2026 12:00:00 GMT'})),
    {header:'Last-Modified',value:'Sun, 11 Oct 2026 12:00:00 GMT'});
  await assert.rejects(remoteDisc('https://games.example/fixture.iso',{fetcher:async()=>new Response(header,
    {status:206,headers:{'Content-Range':`bytes 0-31/${STREAM_THRESHOLD+1}`}})}),/strong ETag/);
  const hang=(_url,{signal})=>new Promise((_,reject)=>{
    if(signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  });
  await assert.rejects(remoteDisc('https://games.example/fixture.iso',{fetcher:hang,timeoutMs:10}),/timed out/);
  const abort=new AbortController();
  const selecting=remoteDisc('https://games.example/fixture.iso',{fetcher:hang,signal:abort.signal});
  abort.abort(new Error('selection cancelled'));
  await assert.rejects(selecting,/selection cancelled/);
  const request={url:remote.url,size:remote.size,first:0,last:31,validator:remote.validator};
  const target=new Uint8Array(32);
  assert.equal(await fetchDiscRange(request,target,{fetcher:async(url,init)=>{
    assert.equal(init.headers['If-Range'],'"disc-v1"');
    return new Response(header,{status:206,headers:{'Content-Range':`bytes 0-31/${remote.size}`,ETag:'"disc-v1"'}});
  }}),32);
  assert.deepEqual(Buffer.from(target),header);
  for(const headers of [{ETag:'"disc-v2"','Content-Range':`bytes 0-31/${remote.size}`},
    {ETag:'"disc-v1"','Content-Range':'bytes 32-63/123'}]) {
    await assert.rejects(fetchDiscRange(request,target,{fetcher:async()=>new Response(header,{status:206,headers})}),/changed or returned/);
  }
  let bodyReads=0,bodyCancelled=false;
  await assert.rejects(fetchDiscRange(request,target,{fetcher:async()=>({status:200,headers:new Headers(),
    body:{getReader(){bodyReads++;throw new Error('whole-disc read');},async cancel(){bodyCancelled=true;}}})}),/invalid HTTP/);
  assert.equal(bodyReads,0,'a full-file response is rejected before reading its body'); assert(bodyCancelled);
  for(const length of [1,33]) await assert.rejects(fetchDiscRange(request,target,{fetcher:async()=>new Response(
    new Uint8Array(length),{status:206,headers:{ETag:'"disc-v1"','Content-Range':`bytes 0-31/${remote.size}`}})}),/Short read|exceeded/);

  const lazy = fs.readFileSync(path.resolve(root,'../../retro-azahar/app/src/emulator/lazyrom.js'),'utf8');
  const lazyUrl = 'data:text/javascript,'+encodeURIComponent(lazy);
  const streamCode = fs.readFileSync(path.join(root,'remote-disc.mjs'),'utf8').replace("'./lazyrom.mjs'",JSON.stringify(lazyUrl))
    .replace("'./range-reader.mjs'",JSON.stringify(pathToFileURL(path.join(root,'range-reader.mjs')).href));
  const {RemoteDisc,CHUNK_SIZE,MAX_CHUNKS} = await import('data:text/javascript,'+encodeURIComponent(streamCode));
  assert.equal(CHUNK_SIZE,2*1024*1024); assert.equal(MAX_CHUNKS,8);
  const size = 24*1024*1024;
  const reader={read({first,last}){return new Uint8Array(last-first+1).fill(first/CHUNK_SIZE);},close(){this.closed=true;}};
  const stream=new RemoteDisc('https://games.example/fixture.iso',size,remote.validator,reader);
  const buffer=new Uint8Array(4);
  for(let index=0;index<12;index++) {
    assert.equal(stream.read(buffer,0,4,index*CHUNK_SIZE),4); assert.equal(buffer[0],index);
    assert(stream.stats().cachedBytes<=16*1024*1024);
  }
  assert.equal(stream.stats().cachedChunks,8); assert.equal(stream.stats().requests,12);
  const before=stream.stats().requests; stream.read(buffer,0,4,11*CHUNK_SIZE);
  assert.equal(stream.stats().requests,before,'cached reads issue no network request');
  assert.equal(stream.read(buffer,0,4,size),0,'EOF never requests beyond the disc');
  stream.close(); assert.equal(stream.stats().cachedBytes,0); assert(reader.closed);
  const recycled={}; assert.equal(padState(new Set(['A']),null,recycled),recycled);
  assert.equal(recycled.mask,BUTTONS.A); padState(new Set(),null,recycled);
  assert.deepEqual(recycled,neutral,'every reused field resets after release or gamepad disconnect');
  const {GameCubeSaves} = await import(pathToFileURL(path.join(root,'saves.mjs')));
  const saves=new GameCubeSaves('fixture',{}), persisted=[];
  saves.cardPath='gamecube/TEST01/cards';
  saves.manager={async save(name,files){persisted.push({name,files});return true;}};
  await saves.cards({async request(type){assert.equal(type,'exportCards');return {files:[]};}});
  assert.deepEqual(persisted,[{name:saves.cardPath,files:[]}],
    'deleting the last card save persists an empty card instead of resurrecting the previous backup');
  let writes=0,dirty=true,synced=false;
  saves.manager={async checkFilesChanged(){const changed=dirty;dirty=false;return changed;},async save(){writes++;return synced;}};
  const cards={async request(){return {files:[]};}};
  await saves.cards(cards);assert.equal(writes,1);assert.match(saves.syncStatus,/cloud upload needs attention/);
  await saves.cards(cards);assert.equal(writes,2,'unchanged cards still retry a failed cloud sync');
  synced=true;await saves.cards(cards);await saves.cards(cards);
  assert.equal(writes,3,'unchanged, synced cards skip repeated storage writes');
  assert.match(saves.syncStatus,/cloud sync is off/);
  dirty=true;saves.manager.isCloudEnabled=async()=>true;await saves.cards(cards);assert.match(saves.syncStatus,/uploaded to cloud/);

  dirty=true;saves.manager.save=async()=>{writes++;throw new Error('Synthetic write failure');};
  await assert.rejects(saves.cards(cards),/Synthetic write failure/);
  saves.manager.save=async()=>{writes++;return true;};await saves.cards(cards);
  assert.equal(writes,6,'a thrown write is retried even after its hashes were recorded');
  saves.statePrefix='gamecube/TEST01/states/fixture-binary/';
  const records=new Map();saves.manager={async save(name,files){records.set(name,files);return true;},async load(name){return records.get(name);}};
  await saves.saveState({async saveStateFile(){return {saved:true,bytes:new Uint8Array([1,2,3])};}},2);
  records.set(saves.statePrefix+1,[{name:'state',content:new Uint8Array([4,5])}]);
  records.set(saves.statePrefix+3,[{name:'state',content:new Uint8Array([6])},{name:'meta.json',content:new Uint8Array([0])}]);
  const slots=await saves.stateSlots();assert.equal(slots.length,9);
  assert(slots[1]&&!slots[1].time,'legacy states stay selectable');assert(slots[2].time>0);
  assert(slots[3]&&!slots[3].time,'invalid optional metadata does not hide a state');assert.equal(slots[4],undefined);
  let loaded;
  await saves.loadState({async request(type,payload){assert.equal(type,'loadStateFile');loaded=payload.bytes;return {loaded:true};}},1);
  assert.deepEqual([...loaded],[4,5]);
  await saves.deleteState(2);assert.deepEqual(records.get(saves.statePrefix+2),[],'deletion clears the account-scoped local/cloud record');
  assert.equal((await saves.stateSlots())[2],undefined);assert((await saves.stateSlots())[1]);
  await assert.rejects(saves.loadState({},2),/no state/);
  await assert.rejects(saves.deleteState(9),/Invalid save slot/);
  console.log('PASS experimental GameCube device-GPU requirement, >50MB streaming with existing 16MiB buffer, input, timeout and worker cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
