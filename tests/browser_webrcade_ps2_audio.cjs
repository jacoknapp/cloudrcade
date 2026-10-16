/* Actual VM/AudioContext underrun regression. Own local homebrew only by default.
 * Requires device WebGPU, WEBRCADE_TEST_ORIGIN, and PS2_TEST_LOCAL_FILE
 * or PS2_AUDIO_ROM_URL (read-only streamed game; no operator saves).
 * PS2_AUDIO_REQUIRE_NONZERO=1 waits for real nonzero native PCM before trials.
 * PS2_AUDIO_CORE optionally overlays ONLY source candidate Play.js/Play.wasm.
 * PS2_AUDIO_EXPECT_BASELINE=1 requires observed replay (negative control).
 * Pauses only the VM to model producer starvation while the audio clock runs;
 * this deliberately differs from the normal user pause, which suspends audio.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN,rom=process.env.PS2_TEST_LOCAL_FILE,romUrl=process.env.PS2_AUDIO_ROM_URL;
assert(origin&&(rom||romUrl),'Set WEBRCADE_TEST_ORIGIN and PS2_TEST_LOCAL_FILE or PS2_AUDIO_ROM_URL');
const baseline=process.env.PS2_AUDIO_EXPECT_BASELINE==='1',trials=Number(process.env.PS2_AUDIO_TRIALS||16);
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ps2-audio-replay-'));
 const context=await chromium.launchPersistentContext(profile,{headless:true,ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:844,height:390},args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface','--ignore-gpu-blocklist']});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE_ERROR',e.message);});page.on('console',m=>{if(m.type()==='error')console.error('BROWSER_ERROR',m.text());});
 try{
  if(process.env.PS2_AUDIO_CORE){
   const core=process.env.PS2_AUDIO_CORE;
   for(const name of ['Play.js','Play.wasm']){
    const bytes=fs.readFileSync(path.join(core,name));console.log('SOURCE_OVERLAY',name,crypto.createHash('sha256').update(bytes).digest('hex'));
    await page.route(`**/core/${name}`,async route=>route.fulfill({response:await route.fetch(),status:200,contentType:name.endsWith('.js')?'application/javascript':'application/wasm',body:bytes}));
   }
  }
  await context.addInitScript(()=>{
   let config;Object.defineProperty(window,'WrcadCloudConfig',{configurable:true,get:()=>config,set:v=>{config={...v,enabled:false,accessAllowed:false,autoRedirect:false,storagePrefix:'ps2-audio-replay',dropbox:{enabled:false}};}});
   localStorage.setItem('ps2-audio-replay.ps2.enabled.v1','1');
   const ids=new WeakMap(),counts=new WeakMap();let next=0;
   window.audioReplayFixture={starts:[],duplicates:[],nonzero:0};
   const original=AudioBufferSourceNode.prototype.start;
   AudioBufferSourceNode.prototype.start=function(...args){
    const b=this.buffer;if(b){
     if(!ids.has(b))ids.set(b,++next);
     const count=(counts.get(b)||0)+1;counts.set(b,count);
     const data=b.getChannelData(0);let nonzero=false;for(let i=0;i<data.length;i++)if(data[i]!==0){nonzero=true;break;}
     const event={id:ids.get(b),count,now:this.context.currentTime,scheduled:args[0]||0,duration:b.duration,nonzero};
     audioReplayFixture.starts.push(event);if(count>1)audioReplayFixture.duplicates.push(event);if(nonzero)audioReplayFixture.nonzero++;
    }
    return original.apply(this,args);
   };
  });
  let url=origin+'/experimental/ps2/?ctx=standalone';
  if(romUrl){const props={title:'PS2 audio qualification',type:'play-ps2',rom:new URL(romUrl,origin).href,uid:'ps2-audio-qualification'};url+='&props='+encodeURIComponent(Buffer.from(encodeURIComponent(JSON.stringify(props))).toString('base64'));}
  await page.goto(url);
  if(process.env.PS2_AUDIO_WASM_SHA){const served=await page.evaluate(async()=>{const bytes=await(await fetch('./core/Play.wasm')).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');});assert.equal(served,process.env.PS2_AUDIO_WASM_SHA);console.log('SERVED_WASM',served);}
  if(!romUrl)await page.locator('#file').setInputFiles(rom);
  await page.waitForFunction(()=>WrcadPS2?.ready,null,{timeout:romUrl?120000:60000});console.log('NATIVE_READY');
  await page.waitForFunction(()=>audioReplayFixture.starts.length>=12&&WrcadPS2.module.getFrames()>50,null,{timeout:60000});console.log('NATIVE_PCM_ACTIVE');
  assert.equal(await page.evaluate(()=>WrcadPS2.module.cloudGpu.adapter.fallback),false);
  if(process.env.PS2_AUDIO_REQUIRE_NONZERO){await page.waitForFunction(()=>audioReplayFixture.nonzero>0,null,{timeout:120000});console.log('NATIVE_NONZERO_PCM');}
  const results=[];
  async function vmCall(method){await page.evaluate(method=>WrcadPS2.module[method](),method);await page.waitForFunction(()=>WrcadPS2.module.operationStatus()!==0,null,{timeout:20000});assert.equal(await page.evaluate(()=>WrcadPS2.module.operationStatus()),1);}
  for(let trial=0;trial<trials;trial++){
   // Observe a new native buffer and request the stall in the same browser task
   // loop; an external Playwright round trip can consume the whole102ms chunk.
   let paused;
   for(let attempt=0;attempt<10;attempt++){
    paused=await page.evaluate(async()=>{
     const delay=()=>new Promise(resolve=>setTimeout(resolve,2)),initial=audioReplayFixture.starts.length,end=performance.now()+10000;
     while(audioReplayFixture.starts.length<=initial){if(performance.now()>end)throw Error('No new native PCM');await delay();}
     WrcadPS2.module.pauseVm();while(WrcadPS2.module.operationStatus()===0){if(performance.now()>end)throw Error('Native pause timeout');await delay();}
     if(WrcadPS2.module.operationStatus()!==1)throw Error('Native pause failed');
     const time=WrcadPS2.module.cloudAudio().currentTime;
     return {frames:WrcadPS2.module.getFrames(),video:WrcadPS2.module.getVideoFrames(),time,state:WrcadPS2.module.cloudAudio().state,starts:audioReplayFixture.starts.length,duplicates:audioReplayFixture.duplicates.length,last:audioReplayFixture.starts.at(-1),active:audioReplayFixture.starts.filter(x=>x.scheduled+x.duration>time).length,queuedSpan:Math.max(...audioReplayFixture.starts.map(x=>x.scheduled+x.duration))-time};
    });
    if(paused.active>=1&&paused.queuedSpan>0)break;
    console.log('SETUP_RETRY',JSON.stringify({trial,attempt,active:paused.active}));await vmCall('resumeVm');
   }
   assert(paused.active>=1,'trial begins with a scheduled native PCM buffer still active');assert(paused.queuedSpan>0);
   assert.equal(paused.state,'running');assert(paused.last.duration>0&&paused.last.duration<.5);
   // MAX_BUFFERS25 *4500/44100 <2.552 seconds. Let every queued chunk finish.
   await page.waitForTimeout(2850);
   const drained=await page.evaluate(()=>({frames:WrcadPS2.module.getFrames(),video:WrcadPS2.module.getVideoFrames(),time:WrcadPS2.module.cloudAudio().currentTime,state:WrcadPS2.module.cloudAudio().state,starts:audioReplayFixture.starts.length}));
   assert.equal(drained.video,paused.video,'native VM VBlank stays frozen; pending GS presentation may finish');assert.equal(drained.state,'running');assert(drained.time-paused.time>2.6);
   await vmCall('resumeVm');
   await page.waitForFunction(n=>audioReplayFixture.starts.length>n,drained.starts,{timeout:15000});
   await page.waitForTimeout(180);
   const after=await page.evaluate(()=>({frames:WrcadPS2.module.getFrames(),video:WrcadPS2.module.getVideoFrames(),time:WrcadPS2.module.cloudAudio().currentTime,starts:audioReplayFixture.starts.length,duplicates:audioReplayFixture.duplicates.length,last:audioReplayFixture.starts.at(-1)}));
   assert(after.video>paused.video);assert(after.frames>paused.frames);assert(after.starts>drained.starts);
   const result={trial,nativeVideoWhilePaused:drained.video-paused.video,renderedWhilePaused:drained.frames-paused.frames,activeBuffers:paused.active,queuedSpan:paused.queuedSpan,startsBefore:paused.starts,scheduledWhileDraining:drained.starts-paused.starts,newStarts:after.starts-drained.starts,repeated:after.duplicates-paused.duplicates,lastBufferAge:paused.time-paused.last.now,lastBufferDuration:paused.last.duration};
   results.push(result);console.log('UNDERRUN',JSON.stringify(result));
  }
  // Normal user pause/resume must freeze/resume the AudioContext, and disposing
  // must close it without leaving running native workers.
  await page.evaluate(()=>WrcadPS2.pause());await page.waitForFunction(()=>WrcadPS2.module.cloudAudio().state==='suspended');
  const frozen=await page.evaluate(()=>WrcadPS2.module.cloudAudio().currentTime);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>WrcadPS2.module.cloudAudio().currentTime),frozen);
  await page.evaluate(()=>WrcadPS2.resume());await page.waitForFunction(()=>WrcadPS2.module.cloudAudio().state==='running');
  const summary=await page.evaluate(()=>({starts:audioReplayFixture.starts.length,unique:new Set(audioReplayFixture.starts.map(x=>x.id)).size,duplicates:audioReplayFixture.duplicates,nonzero:audioReplayFixture.nonzero,frames:WrcadPS2.module.getFrames()}));
  if(baseline)assert(summary.duplicates.length>0,'baseline must reproduce real native AudioBuffer replay');
  else assert.equal(summary.duplicates.length,0,'every native PCM AudioBuffer starts only once after underrun');
  if(process.env.PS2_AUDIO_REQUIRE_NONZERO)assert(summary.nonzero>0,'real game gate must contain nonzero PCM');
  if(process.env.PS2_TEST_SCREENSHOT)await page.screenshot({path:process.env.PS2_TEST_SCREENSHOT});
  await page.evaluate(async()=>{window.testModule=WrcadPS2.module;window.testAudio=testModule.cloudAudio();await WrcadPS2.exit({leave:false});});
  assert.equal(await page.evaluate(()=>testAudio.state),'closed');assert.equal(await page.evaluate(()=>testModule.PThread.runningWorkers.length+testModule.PThread.unusedWorkers.length),0);
  assert.deepEqual(errors,[]);console.log('PASS',JSON.stringify({baseline,artificialProducerStall:true,trials,summary}));
 }catch(error){console.error('NATIVE_DIAGNOSTIC',await page.evaluate(()=>({ready:window.WrcadPS2?.ready,frames:window.WrcadPS2?.module?.getFrames(),starts:window.audioReplayFixture?.starts.length,audio:window.WrcadPS2?.module?.cloudAudio()?.state,failure:document.getElementById('failure-detail')?.textContent,isolated:crossOriginIsolated})).catch(()=>null));throw error;}finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
