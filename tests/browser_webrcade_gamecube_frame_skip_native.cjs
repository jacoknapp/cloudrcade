// Real product worker/renderer, isolated local saves, explicit read-only ROM.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const origin=process.env.WEBRCADE_GAMECUBE_ORIGIN,system=process.env.SYSTEM||'gamecube',rom=process.env.GAMECUBE_TEST_ROM;
if(!origin||!rom)throw Error('Supply WEBRCADE_GAMECUBE_ORIGIN and GAMECUBE_TEST_ROM');
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--ignore-gpu-blocklist','--disable-vulkan-surface']});
 try{
  const c=await b.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',hasTouch:true,isMobile:true,viewport:{width:390,height:844}}),p=await c.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await c.route('**/cloud-saves/config.php*',r=>r.fulfill({contentType:'text/javascript',body:'window.WrcadCloudConfig={enabled:false,storagePrefix:"frame-skip-native"};'}));
  await c.addInitScript(system=>{
   localStorage.setItem('frame-skip-native.'+system+'.enabled.v1','1');
   const gpu=navigator.gpu;if(gpu){const request=gpu.requestAdapter.bind(gpu);gpu.requestAdapter=async o=>(await request(o))||request(o);}
  },system);
  await p.route('**/session.mjs',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('this.scope = scope;','this.scope = scope; globalThis.__s=this;')});});
  const props=Buffer.from(encodeURIComponent(JSON.stringify({title:'Frame skip qualification',rom:new URL(rom,origin).href}))).toString('base64');
  await p.goto(origin+'/experimental/'+system+'/?props='+encodeURIComponent(props));
  await p.waitForFunction(()=>globalThis.__s?.booted,null,{timeout:180000});
  const adapter=await p.evaluate(async()=>{const a=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});return {vendor:a.info.vendor,fallback:a.info.isFallbackAdapter};});
  assert.equal(adapter.fallback,false);
  await p.waitForTimeout(Number(process.env.WARM||30)*1000);
  const sample=()=>p.evaluate(()=>__s.adapter.request('runFrame'));
  await p.locator('.kt-tab').click();
  const select=p.getByRole('combobox',{name:'Frame skip'});assert.equal(await select.inputValue(),'1');
  const results=[];
  for(const divisor of [2,3,4,1]){
   if(!await select.isVisible()) await p.locator('.kt-tab').click();
   await select.selectOption(String(divisor));await p.waitForFunction(()=>!document.querySelector('.gc-frame-skip select').disabled);
   await p.waitForTimeout(1000);
   const a=await sample();await p.waitForTimeout(Number(process.env.SAMPLE||12)*1000);const z=await sample();
   const old=a.gamecubeDiagnostics.frameSkip,now=z.gamecubeDiagnostics.frameSkip;
   const frames=now.frames-old.frames,skipped=now.skipped-old.skipped,shown=z.gamecubeDiagnostics.render.frames-a.gamecubeDiagnostics.render.frames;
   console.log('CADENCE',JSON.stringify({system,divisor,frames,skipped,shown,before:old.native,after:now.native}));
   if(process.env.OUT_DIR)await p.screenshot({path:path.join(process.env.OUT_DIR,system+'-'+divisor+'-cadence.png')});
   assert.equal(now.divisor,divisor);assert(frames>5,'native work progresses');
   assert(Math.abs(skipped-frames*(divisor-1)/divisor)<=2,'expected complete-frame skip cadence');
   assert(Math.abs(shown-(frames-skipped))<=1,'rendered FPS excludes omitted display passes');
   assert(z.coreTicks>a.coreTicks,'emulation time advances');
   assert.equal(z.heapBytes,768*1024*1024,'fixed native memory budget');
   const na=old.native,nz=now.native;
   assert(na&&nz,'qualified native frame-skip counters are required');
   assert(Math.abs((nz.frames-na.frames)-frames)<=3,'every native image publishes a completion marker');
   assert(Math.abs((nz.skipped-na.skipped)-skipped)<=3,'omitted native images publish skipped completion markers');
   const omitted=nz.skippedBatches-na.skippedBatches,drawn=nz.drawnBatches-na.drawnBatches;
   assert(drawn>0,'retained frames still prepare native draw batches');
   if(divisor>1) {
    assert(omitted>drawn/2,'skip omits native texture/pipeline/upload/draw preparation');
    assert(nz.skippedVertices>na.skippedVertices,'native vertex conversion is omitted');
   } else {
    assert.equal(omitted,0,'Off performs all native graphics work');
    assert.equal(nz.skippedVertices-na.skippedVertices,0);
   }
   assert.equal(z.gamecubeDiagnostics.skippedDraws,0,'no accidental rejected draws');
   assert.equal(z.gamecubeDiagnostics.missingPipelines,0);assert.equal(z.gamecubeDiagnostics.rendererError,null);
   const pcm=await p.evaluate(async()=>{__s.adapter.setAudioMuted(false);const r=await __s.adapter.mixAudio(4096);return {available:r.available,frames:r.frames,nonzero:r.samples?.some(v=>v!==0),stats:r.stats};});
   assert(pcm.available&&pcm.frames>0,'audio mixer keeps producing PCM');
   const result={system,divisor,frames,skipped,shown,omitted,drawn,noPassMarkers:nz.skippedNoPass-na.skippedNoPass,pcm,adapter};results.push(result);console.log('RESULT',JSON.stringify(result));
   if(process.env.ROUNDTRIP==='1' && divisor===4){
    const before=await sample();
    await p.evaluate(system=>window[system==='wii'?'WrcadWii':'WrcadGameCube'].saveState(1),system);
    await p.evaluate(system=>window[system==='wii'?'WrcadWii':'WrcadGameCube'].loadState(1),system);
    await p.waitForTimeout(8000);const restored=await sample();
    assert(restored.coreTicks>before.coreTicks,'CPU resumes after a skipped-frame save');
    assert(restored.gamecubeDiagnostics.render.frames>before.gamecubeDiagnostics.render.frames,'GPU resumes after a skipped-frame save');
    assert(restored.gamecubeDiagnostics.render.ageMs<2000);
    assert.equal(restored.gamecubeDiagnostics.rendererError,null);
    const restoredPcm=await p.evaluate(async()=>{__s.adapter.setAudioMuted(false);const r=await __s.adapter.mixAudio(4096);return {available:r.available,frames:r.frames,nonzero:r.samples?.some(v=>v!==0)};});
    assert(restoredPcm.available&&restoredPcm.frames>0,'PCM resumes after a skipped-frame save');
    console.log('STATE AUDIO',system,restoredPcm);
    console.log('STATE ROUNDTRIP PASS',system,'4×',restored.gamecubeDiagnostics.frameSkip.native);
   }
   const out=process.env.OUT_DIR;if(out){fs.mkdirSync(out,{recursive:true});await p.locator('.kt-close').click();await p.screenshot({path:path.join(out,system+'-'+divisor+'.png')});await p.locator('.kt-tab').click();}
  }
  assert.deepEqual(errors,[]);
  if(process.env.OUT)fs.writeFileSync(process.env.OUT,JSON.stringify(results,null,2)+'\n');
  await c.close();console.log('PASS',system,'real GPU frame skip 2×/3×/4×/Off, frame progress, PCM and no renderer failures');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
