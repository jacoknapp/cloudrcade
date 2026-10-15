/* Actual overlay modules/CSS with deterministic counters; no GPU/core is loaded.
 * WEBRCADE_TEST_ORIGIN and optional PS2_METRICS_APP select exact/source assets.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true,...(engine===chromium?{args:['--no-sandbox']}:{})});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:390,height:844}});
  await context.route('**/cloud-saves/config.php',route=>route.fulfill({contentType:'application/javascript',body:'window.WrcadCloudConfig={storagePrefix:"ps2_metrics_fixture",enabled:false};'}));
  if(process.env.PS2_METRICS_APP)for(const name of ['perf.mjs','host.mjs','gpu.mjs','disc.mjs','ps2.css'])await context.route('**/'+name,async route=>{const response=await route.fetch();await route.fulfill({response,body:fs.readFileSync(path.join(process.env.PS2_METRICS_APP,name))});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.WEBRCADE_TEST_ORIGIN+'/experimental/ps2/');await page.waitForFunction(()=>window.WrcadPS2);
  const result=await page.evaluate(async()=>{
   localStorage.setItem('ps2_metrics_fixture.ps2.perf.v1','1');
   const {Ps2Performance}=await import('./perf.mjs');let frame=0,video=0,clock=0,count=4,computeMs=20,queries=0;
   const module={getFrames:()=>frame,getVideoFrames:()=>video,getVideoRate:()=>60,HEAPU8:{length:268435456},cloudGpu:{sampleTiming(){queries++;return{supported:true,count,ms:computeMs};}}};
   const readout=new Ps2Performance(module,{cachedBytes:1048576});clearInterval(readout.timer);
   readout.timings.clock=()=>clock;readout.sample(1000);const t=readout.timings;
   for(let i=0;i<30;i++){
    clock=i*33;let start=t.begin();clock+=2;t.record('gpuSubmit',start,t.epoch);
    start=t.begin();clock+=11;t.record('gpuWait',start,t.epoch);t.gpuCall(t.epoch);t.present(t.epoch);
   }
   let start=t.begin();clock+=30;t.record('disc',start,t.epoch);start=t.begin();clock+=6;t.record('host',start,t.epoch);
   frame=30;video=60;count=12;computeMs=52;readout.sample(2000);window.metricsReadout=readout;window.metricsQueries=()=>queries;
   return{text:readout.element.textContent,details:readout.details};
  });
  assert.match(result.text,/Frame 33\.3 ms avg · p95 33\.0 · last 33\.0/);
  assert.match(result.text,/GPU submit CPU 2\.0 · wait 11\.0 ms\/f/);assert.match(result.text,/Disc I\/O 1\.0 · input\/layout 0\.2 ms\/f/);
  assert.match(result.details,/not additive/);assert.match(result.text,/GPU compute 4\.0 ms\/sample \(8 samples\)/);
  assert.match(result.details,/exclude the final presentation blit/);assert.match(result.details,/not per-frame totals/);
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]){
   await page.setViewportSize(viewport);const box=await page.locator('#ps2-performance').boundingBox();assert(box.x>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height,'overlay fits mobile rotation without clipping');
  }
  const before=await page.evaluate(()=>metricsQueries());
  await page.evaluate(()=>{localStorage.setItem('ps2_metrics_fixture.ps2.perf.v1','0');metricsReadout.sample(3000);});assert(await page.locator('#ps2-performance').isHidden());
  assert.equal(await page.evaluate(()=>metricsQueries()),before,'disabled readout does not inspect native GPU counters');
  assert(await page.evaluate(()=>metricsReadout.timings.begin()===null));
  await page.evaluate(()=>{localStorage.setItem('ps2_metrics_fixture.ps2.perf.v1','1');metricsReadout.module.cloudGpu.sampleTiming=()=>({supported:false,count:0,ms:0});metricsReadout.sample(4000);metricsReadout.sample(5000);});
  assert.match(await page.locator('#ps2-performance').textContent(),/timestamps unavailable/);
  await page.evaluate(()=>{metricsReadout.reset(true);metricsReadout.sample(9000);});assert.equal(await page.locator('#ps2-performance').textContent(),'PS2 paused');
  await page.evaluate(()=>metricsReadout.dispose());assert.equal(await page.locator('#ps2-performance').count(),0);assert.deepEqual(errors,[]);
  console.log('PASS',engine.name(),'actual PS2 overlay averages/p95, stage labels, mobile bounds, toggle-off and pause/disposal');
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
