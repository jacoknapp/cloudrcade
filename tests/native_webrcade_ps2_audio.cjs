/* Execute pinned native OpenAL C++ with a controlled device, then replay its API
 * calls through the actual packaged Emscripten AL implementation. No ROM/GPU.
 * PS2_NATIVE_SOURCE=/owned/Play PS2_PLAY_JS=/package/app/core/Play.js node this-file
 * PS2_AUDIO_EXPECT_BASELINE=1 requires the old failure, for the negative control.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const source=process.env.PS2_NATIVE_SOURCE,play=process.env.PS2_PLAY_JS;
assert(source&&play,'Set PS2_NATIVE_SOURCE and PS2_PLAY_JS to the corresponding pinned source and built artifact');
const baseline=process.env.PS2_AUDIO_EXPECT_BASELINE==='1';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloudrcade-ps2-audio-test-'));
const js=fs.readFileSync(play,'utf8');
const alStart=js.indexOf('var AL='),alEnd=js.indexOf('function _alBufferData',alStart);
assert(alStart>=0&&alEnd>alStart,'Expected actual Emscripten AL runtime');
function functionSource(name){
 const start=js.indexOf(`function ${name}(`);assert(start>=0,name);
 let at=js.indexOf('{',start),depth=0,quote=null;
 for(;at<js.length;at++){
  const c=js[at];if(quote){if(c==='\\')at++;else if(c===quote)quote=null;continue;}
  if(c==='"'||c==="'"){quote=c;continue;}
  if(c==='{')depth++;else if(c==='}'&&!--depth)return js.slice(start,at+1);
 }
 throw Error(`Unterminated ${name}`);
}
function runtime(){
 const starts=[];
 const ac={currentTime:0,state:'running',
  createGain:()=>({connect(){},disconnect(){},gain:{value:1}}),
  createPanner:()=>({connect(){},disconnect(){},setPosition(){},setOrientation(){}}),
  createBuffer(channels,length,rate){const data=Array.from({length:channels},()=>new Float32Array(length));return {duration:length/rate,getChannelData:i=>data[i]};},
  createBufferSource(){return {playbackRate:{value:1},connect(){},disconnect(){},start(t,offset){starts.push({marker:Math.round(this.buffer.getChannelData(0)[0]*32768),t,offset})},stop(){}}}
 };
 const ctx={listener:{position:[0,0,0],velocity:[0,0,0],direction:[0,0,0],up:[0,0,0]},speedOfSound:343.3,dopplerFactor:1,sourceDistanceModel:false,distanceModel:53250,audioCtx:ac,gain:ac.createGain(),sources:{},err:0};
 const memory=new ArrayBuffer(65536),heap=new Int32Array(memory);
 const env={MainLoop:{timingMode:0},document:{visibilityState:'visible'},ENVIRONMENT_IS_PTHREAD:false,HEAP32:heap,HEAP16:new Int16Array(memory),growMemViews(){}};
 vm.createContext(env);vm.runInContext(js.slice(alStart,alEnd)+['_alGenSources','_alBufferData','_alSourceQueueBuffers','_alSourceUnqueueBuffers','_alGetSourcei','_alSourcePlay','_alSourceStop','_alSourcei'].map(functionSource).join('\n'),env);
 env.AL.currentCtx=ctx;env._alGenSources(1,4);const id=heap[1],src=ctx.sources[id];
 function tick(t){ac.currentTime=t;env.AL.scheduleContextAudio(ctx);}
 function event(op,a,b){
  if(op==='data'){
   if(!env.AL.buffers[a])env.AL.buffers[a]={id:a,refCount:0};
   env.HEAP16.fill(b,512,512+9000);env._alBufferData(a,4355,1024,18000,44100);
  }else if(op==='queue'){heap[2]=a;env._alSourceQueueBuffers(id,1,8);}
  else if(op==='unqueue'){env._alSourceUnqueueBuffers(id,1,8);assert.equal(heap[2],a,'native frees precisely the actual AL processed buffer');}
  else if(op==='state'||op==='processed'||op==='queued'){env._alGetSourcei(id,op==='state'?4112:op==='queued'?4117:4118,12);assert.equal(heap[3],a,`native observed ${op} matches shipped AL`);}
  else if(op==='play')env._alSourcePlay(id);
  else if(op==='stop')env._alSourceStop(id);
  else if(op==='clear')env._alSourcei(id,4105,0);
  else if(op==='stall'){ac.currentTime+=3;}
  else if(op==='drain'){const until=ac.currentTime+3;while(ac.currentTime<until)tick(ac.currentTime+.025);assert.equal(src.state,4116);}
  else throw Error(op);
  assert.equal(ctx.err,0,`AL error after ${op}`);
 }
 return{event,starts,src,ac,tick,env,heap,id};
}
try{
 fs.mkdirSync(path.join(dir,'sound/SH_OpenAL'),{recursive:true});fs.mkdirSync(path.join(dir,'openal'));
 for(const ext of ['h','cpp'])fs.copyFileSync(path.join(source,'Source/sound/SH_OpenAL',`SH_OpenAL.${ext}`),path.join(dir,'sound/SH_OpenAL',`SH_OpenAL.${ext}`));
 fs.copyFileSync(path.join(__dirname,'fixtures/ps2_openal.h'),path.join(dir,'fixture.h'));
 fs.copyFileSync(path.join(__dirname,'fixtures/ps2_openal.cpp'),path.join(dir,'test.cpp'));
 for(const name of ['sound/SoundHandler.h','openal/Device.h','openal/Context.h','openal/Source.h','openal/Buffer.h'])fs.writeFileSync(path.join(dir,name),'#include "fixture.h"\n');
 fs.writeFileSync(path.join(dir,'alloca_def.h'),'#include <alloca.h>\n');
 const exe=path.join(dir,'test');
 execFileSync('g++',['-std=c++17','-O2','-Wall','-Wextra','-Werror','-I'+dir,path.join(dir,'sound/SH_OpenAL/SH_OpenAL.cpp'),path.join(dir,'test.cpp'),'-o',exe],{stdio:'inherit'});
 const trace=execFileSync(exe,baseline?['baseline']:[],{encoding:'utf8'});
 const r=runtime();for(const line of trace.trim().split('\n')){const[op,a,b]=line.split(' ');r.event(op,+a,+b);}
 const heard=r.starts.map(x=>x.marker),expected=[...Array.from({length:20},(_,i)=>i+1),41,42,51,52,61,62,81,105];
 if(baseline){assert.deepEqual(heard.slice(0,21),[...expected.slice(0,10),...expected.slice(0,11)]);console.log('PASS negative control: actual pinned native Write + shipped AL replays ten heard chunks (1.020408 s) on restart');}
 else {assert.deepEqual(heard,expected);assert.equal(r.src.bufQueue.length,1);assert.equal(r.src.bufQueue[0].id,0);console.log('PASS actual native Write + shipped AL: producer/scheduler/bufferData stalls retain fresh PCM; capacity/free pool/reset pass');}
 // Continuous production, including processed buffers still retained, must not
 // lose or repeat PCM. AudioContext suspension freezes its clock and the queue.
 const c=runtime();c.event('data',100,100);c.event('queue',100);c.event('play');
 c.tick(.05);c.event('data',101,101);c.event('queue',101);
 c.ac.state='suspended';for(let i=0;i<10;i++)c.tick(.05);c.ac.state='running';
 c.event('data',102,102);c.event('queue',102);c.event('drain');
 assert.deepEqual(c.starts.map(x=>x.marker),[100,101,102]);
 console.log('PASS shipped AL continuous playback and suspended-clock resume preserve PCM ordering');
 // Explicit limit: while AL remains PLAYING, its catch-up path can skip a
 // prefix of fresh PCM. Capped stopped-source recovery must not claim to fix it.
 const gap=runtime();gap.event('data',200,200);gap.event('queue',200);gap.event('play');
 gap.ac.currentTime=.15;gap.event('data',201,201);gap.event('queue',201);
 gap.event('state',4114);gap.event('processed',1);
 assert.equal(gap.starts.at(-1).marker,201);
 assert(Math.abs(gap.starts.at(-1).offset-(.15-4500/44100))<1e-9);
 console.log('KNOWN LIMIT shipped AL partial timeline gap while PLAYING skips fresh prefix',gap.starts.at(-1).offset);

}finally{fs.rmSync(dir,{recursive:true,force:true});}
