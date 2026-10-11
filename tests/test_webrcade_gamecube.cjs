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
  const calls = {load:0, terminated:0, rejected:0, started:0, paused:0, mounted:null, input:null};
  return {calls, loaded:false, worker:{terminate() { calls.terminated++; }},
    async load() { calls.load++; this.loaded = true; }, setAudioMuted(value) { assert.equal(value,true); },
    async mountGame(file) { calls.mounted = file; return {fullCore:true, coreBoot:{accepted:true}}; },
    start() { calls.started++; }, pause() { calls.paused++; },
    setInputState(state) { calls.input = state; }, pollFrame() {},
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
  assert.deepEqual(await inspectDisc(disc()), {gameId:'TEST01',size:2 ** 31});
  await assert.rejects(inspectDisc(disc({magic:0})), /no GameCube/);
  await assert.rejects(inspectDisc(disc({wii:true})), /Wii/);
  await assert.rejects(inspectDisc(disc({name:'fixture.rvz'})), /ISO or GCM/);

  const adapter = fake();
  const session = new GameCubeSession({...options, createAdapter:async config => {
    assert.equal(config.videoBackend,'WebGPU-Real'); assert.equal(config.presenterBackend,'webgpu');
    assert.equal(typeof config.transferCanvas,'function'); return adapter;
  }});
  await Promise.all([session.initialize(), session.initialize()]);
  assert.equal(adapter.calls.load,1,'parallel initialization shares one worker');
  const original = disc(); await session.boot(original);
  assert.equal(adapter.calls.mounted, original,'original File/Blob is mounted, without a full read');
  await assert.rejects(session.boot(disc()), /Close this session/);
  const state = padState(new Set(['A','STICK_UP','C_RIGHT','D_LEFT','L']));
  session.setInput(state); assert.equal(adapter.calls.input,state);
  session.pause(); assert.equal(adapter.calls.input.mask,0,'pause releases stuck buttons');
  session.setInput(state); assert.equal(adapter.calls.input.mask,0,'paused input is ignored');
  session.resume(); assert.equal(adapter.calls.started,2);
  session.dispose(); session.dispose();
  assert.equal(adapter.calls.terminated,1); assert.equal(adapter.calls.rejected,1);
  assert.equal(session.adapter,null); assert.equal(adapter.frameData,null);
  await assert.rejects(session.initialize(), /closed/);

  const refused = fake(); refused.mountGame = async () => ({fullCore:true,coreBoot:{accepted:false}});
  await assert.rejects(new GameCubeSession({...options,createAdapter:async()=>refused}).boot(disc()), /did not boot/);
  assert.equal(refused.calls.started,0); assert.equal(refused.calls.terminated,1);
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
    headers:{'Content-Range':`bytes 0-31/${STREAM_THRESHOLD+1}`}});};
  const remote=await remoteDisc('https://games.example/fixture.iso',{fetcher});
  assert.equal(remote.remote,true); assert.equal(remote.size,STREAM_THRESHOLD+1);
  assert.deepEqual(requests,['bytes=0-31'],'large URL images never fetch the full disc');
  const streamed = fake(); let remoteRequest;
  streamed.request=async(type,payload)=>{
    assert.equal(type,'mountUrl');remoteRequest=payload;return {fullCore:true,coreBoot:{accepted:true}};
  };
  streamed.applyMetadata=()=>{};streamed.applyFrame=()=>{};
  const remoteSession=new GameCubeSession({...options,createAdapter:async()=>streamed});
  await remoteSession.boot(remote);
  assert.deepEqual(remoteRequest,{url:remote.url,name:remote.name,size:remote.size});
  assert.equal(streamed.calls.mounted,null,'large URL games do not enter the local File loader');
  remoteSession.dispose();
  await assert.rejects(remoteDisc('https://games.example/fixture.iso',{fetcher:async()=>new Response(header)}), /exact HTTP/);
  let boundaryRequests=0;
  await assert.rejects(remoteDisc('https://games.example/fixture.iso',{fetcher:async()=>{
    if (++boundaryRequests === 2) throw new Error('bounded small-file path');
    return new Response(header,{status:206,headers:{'Content-Range':`bytes 0-31/${STREAM_THRESHOLD}`}});
  }}), /bounded small-file path/);
  await assert.rejects(remoteDisc('file:///fixture.iso'), /HTTP/);

  const lazy = fs.readFileSync(path.resolve(root,'../../retro-azahar/app/src/emulator/lazyrom.js'),'utf8');
  const lazyUrl = 'data:text/javascript,'+encodeURIComponent(lazy);
  const streamCode = fs.readFileSync(path.join(root,'remote-disc.mjs'),'utf8').replace("'./lazyrom.mjs'",JSON.stringify(lazyUrl));
  const {RemoteDisc,CHUNK_SIZE,MAX_CHUNKS} = await import('data:text/javascript,'+encodeURIComponent(streamCode));
  assert.equal(CHUNK_SIZE,2*1024*1024); assert.equal(MAX_CHUNKS,8);
  const size = 24*1024*1024;
  global.XMLHttpRequest=class {
    open(method,url,async){assert.equal(async,false);assert.equal(method,'GET');}
    setRequestHeader(name,value){assert.equal(name,'Range');this.range=value;}
    send(){const [,first,last]=/bytes=(\d+)-(\d+)/.exec(this.range).map(Number);
      this.status=206;this.response=new Uint8Array(last-first+1).fill(first/CHUNK_SIZE).buffer;
      this.contentRange=`bytes ${first}-${last}/${size}`;}
    getResponseHeader(){return this.contentRange;}
  };
  try {
    const stream=new RemoteDisc('https://games.example/fixture.iso',size);
    const buffer=new Uint8Array(4);
    for(let index=0;index<12;index++) {
      assert.equal(stream.read(buffer,0,4,index*CHUNK_SIZE),4); assert.equal(buffer[0],index);
      assert(stream.stats().cachedBytes<=16*1024*1024);
    }
    assert.equal(stream.stats().cachedChunks,8); assert.equal(stream.stats().requests,12);
    const before=stream.stats().requests; stream.read(buffer,0,4,11*CHUNK_SIZE);
    assert.equal(stream.stats().requests,before,'cached reads issue no HTTP request');
    assert.equal(stream.read(buffer,0,4,size),0,'EOF never requests beyond the disc');
    stream.chunks.clear(); assert.equal(stream.stats().cachedBytes,0);
    const xhr=global.XMLHttpRequest;
    global.XMLHttpRequest=class extends xhr {send(){super.send();this.status=200;}};
    assert.throws(()=>stream.fetchRange(0,31),/invalid HTTP/,'full-file responses cannot replace ranges');
    global.XMLHttpRequest=class extends xhr {send(){super.send();this.contentRange='bytes 32-63/123';}};
    assert.throws(()=>stream.fetchRange(0,31),/invalid HTTP/,'mismatching ranges cannot corrupt the disc');
    global.XMLHttpRequest=class extends xhr {send(){super.send();this.response=new ArrayBuffer(1);}};
    assert.throws(()=>stream.fetchRange(0,31),/Short read/);
  } finally { delete global.XMLHttpRequest; }
  console.log('PASS experimental GameCube device-GPU requirement, >50MB streaming with existing 16MiB buffer, input, timeout and worker cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
