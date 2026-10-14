// Actual Chromium/WebKit reload/cold-tab recovery delivers bounded app logs.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const script=fs.readFileSync(path.resolve(__dirname,'../deploy/webrcade/touch/cloud/core-crash.js'),'utf8');
const key='wrcad.core.active.v1';
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,...(engine===chromium?{executablePath:process.env.CHROME,args:['--no-sandbox']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844}}),reports=[],errors=[];let offline=false;
   context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
   await context.route('http://recovery.test/**',r=>{
    if(new URL(r.request().url()).pathname==='/cloud-saves/core-crash-log.php'){
     assert.equal(r.request().method(),'POST');const value=r.request().postDataJSON();
     if(offline)return r.abort();reports.push(value);return r.fulfill({status:204,body:''});
    }
    return r.fulfill({contentType:'text/html',body:'<!doctype html><html'+(new URL(r.request().url()).pathname.startsWith('/experimental/gamecube/')?' data-cloudrcade-core="gamecube"':'')+'><body><p>Library fixture</p><script>'+script+';window.WrcadGameCubeRecovery=window.WrcadCoreCrash;</script></body>'});
   });
   const waitReports=async n=>{const deadline=Date.now()+5000;while(reports.length<n){assert(Date.now()<deadline,'crash report not delivered');await new Promise(r=>setTimeout(r,25));}};
   const page=await context.newPage();await page.goto('http://recovery.test/play/');assert.equal(reports.length,0);
   async function launch(){
    await page.evaluate(()=>{const f=document.createElement('iframe');f.id='webrcade-app-iframe';f.src='/experimental/gamecube/';document.body.append(f);});
    const f=await(await page.locator('iframe').elementHandle()).contentFrame();await f.waitForFunction(()=>!!window.WrcadGameCubeRecovery);
    await f.evaluate(()=>{WrcadGameCubeRecovery.begin();WrcadGameCubeRecovery.identify('GMSE01','a'.repeat(64),'b'.repeat(64));WrcadGameCubeRecovery.phase('playing');});return f;
   }
   let frame=await launch();await frame.waitForTimeout(5050);
   await frame.evaluate(()=>WrcadGameCubeRecovery.sample({frame:123,heapBytes:768*1048576,url:'private',gamecubeDiagnostics:{compiled:456,resources:{textures:22},gpuQueue:{pending:2,completed:55,lastCompletionMs:20}}}));
   const stored=await page.evaluate(key=>sessionStorage.getItem(key),key);assert(stored.length<1000);assert(!stored.includes('private'));assert.equal(JSON.parse(stored).sample.frame,123);
   await frame.evaluate(()=>{for(let i=0;i<1000;i++)WrcadGameCubeRecovery.sample({frame:i});});
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),stored,'no per-frame storage writes');assert.equal(reports.length,0,'no normal gameplay log uploads');
   await page.reload();await waitReports(1);assert.equal(reports[0].reason,'interrupted');assert.equal(reports[0].sample.frame,123);assert.equal(reports[0].runtime,'b'.repeat(12));assert.equal(reports[0].sample.gpuPending,2);assert(!JSON.stringify(reports[0]).includes('private'));
   assert.equal(await page.locator('#gamecube-recovery').count(),0,'no recovery popup');
   await page.waitForFunction(key=>!localStorage.getItem(key+'.reports'),key);await page.reload();await page.waitForTimeout(500);assert.equal(reports.length,1,'successful report is consumed once');
   frame=await launch();await frame.evaluate(()=>WrcadGameCubeRecovery.clear());await page.locator('iframe').evaluate(e=>e.remove());await page.reload();await page.waitForTimeout(500);assert.equal(reports.length,1,'normal exit stays quiet');
   frame=await launch();await frame.evaluate(()=>WrcadGameCubeRecovery.phase('saving state'));await page.locator('iframe').evaluate(e=>e.remove());await waitReports(2);assert.equal(reports[1].phase,'saving state');
   await page.waitForFunction(key=>!localStorage.getItem(key+'.reports'),key);
   frame=await launch();const other=await context.newPage();await other.goto('http://recovery.test/play/');await other.waitForTimeout(600);assert.equal(reports.length,2,'live owner prevents a false cold-tab report');
   await page.close();await other.reload();await waitReports(3);assert.equal(reports[2].phase,'playing');assert.equal(await other.evaluate(key=>sessionStorage.getItem(key),key),null,'fresh tab recovered durable journal');
   await other.waitForFunction(key=>!localStorage.getItem(key+'.reports'),key);
   offline=true;await other.evaluate(()=>{WrcadGameCubeRecovery.begin();WrcadGameCubeRecovery.fail(Error('WebGPU device-lost: private/account/path'));});
   await other.waitForFunction(key=>JSON.parse(localStorage.getItem(key+'.reports'))?.length===1,key);
   assert.equal(reports.length,3);await other.close();offline=false;
   const retry=await context.newPage();await retry.goto('http://recovery.test/play/');await waitReports(4);
   assert.equal(reports[3].reason,'gpu-device-lost');assert(!JSON.stringify(reports[3]).includes('private'));await retry.waitForFunction(key=>!localStorage.getItem(key+'.reports'),key);
   await retry.evaluate(key=>{sessionStorage.setItem(key,'invalid');localStorage.setItem(key+'.reports','invalid');},key);await retry.reload();await retry.waitForTimeout(500);assert.equal(reports.length,4);
   await context.addInitScript(()=>{for(const key of ['sessionStorage','localStorage'])Object.defineProperty(window,key,{get(){throw Error('unavailable');}});});
   await retry.reload();await retry.evaluate(()=>{WrcadGameCubeRecovery.begin();WrcadGameCubeRecovery.fail(Error('GameCube worker failed'));});await waitReports(5);assert.equal(reports[4].reason,'worker-failure');
   // Standard SDK constructor assignment hooks handled aborts for every core.
   for(const system of ['retro-ppsspp','retro-azahar','retro-snes9x','nes','psx']){
    const core=await context.newPage();await core.goto('http://recovery.test/play/app/'+system+'/');
    await core.evaluate(()=>{window.app={exit(error){this.received=error;return Promise.resolve(42);},setModeToLoaded(){}};app.setModeToLoaded();});
    const count=reports.length;
    assert.equal(await core.evaluate(()=>app.exit('PSP core error: private/account/rom-url')),42);
    await waitReports(count+1);assert.equal(reports.at(-1).system,system);assert.equal(reports.at(-1).reason,'core-abort');assert(!JSON.stringify(reports.at(-1)).includes('private'));
    await core.evaluate(()=>{window.app={exit(){return 'normal';}};});
    assert.equal(await core.evaluate(()=>app.exit()),'normal');await core.waitForTimeout(100);assert.equal(reports.length,count+1,'normal SDK exit is quiet');await core.close();
   }
   // An uncaught worker exception is reported even when SDK code misses it.
   const core=await context.newPage();await core.goto('http://recovery.test/play/app/retro-snes9x/');
   const before=reports.length;await core.evaluate(()=>{window.app={exit(){}};new Worker(URL.createObjectURL(new Blob(['throw Error("private worker crash")'],{type:'text/javascript'})));});
   await waitReports(before+1);assert.equal(reports.at(-1).reason,'worker-failure');assert.equal(reports.at(-1).system,'retro-snes9x');
   await core.evaluate(()=>app.exit());await core.close();
   assert.deepEqual(errors.filter(e=>!/private worker crash/.test(e)),[]);console.log('PASS '+engine.name()+': automatic app crash logs, no popup, bounded/private snapshots, normal exits, cold-tab recovery, live-owner guard, offline retry, unavailable storage');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
