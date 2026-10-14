// Per-tab GameCube interruption evidence across real Chromium/WebKit reloads.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const script=fs.readFileSync(path.resolve(__dirname,'../deploy/webrcade/retro-dolphin/app/recovery.js'),'utf8');
const key='wrcad.gamecube.active.v1';
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,...(engine===chromium?{executablePath:process.env.CHROME,args:['--no-sandbox']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844}});
   await context.route('http://recovery.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body><p>Library fixture</p><script>'+script+'</script></body>'}));
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://recovery.test/play/');
   assert.equal(await page.locator('#gamecube-recovery').count(),0,'other cores and fresh library have no notice');
   async function launch(){
    await page.evaluate(()=>{const frame=document.createElement('iframe');frame.id='webrcade-app-iframe';frame.src='/experimental/gamecube/';document.body.append(frame);});
    const frame=await(await page.locator('iframe').elementHandle()).contentFrame();
    await frame.waitForFunction(()=>!!window.WrcadGameCubeRecovery);
    await frame.evaluate(()=>{WrcadGameCubeRecovery.begin();WrcadGameCubeRecovery.identify('GMSE01','a'.repeat(64));WrcadGameCubeRecovery.phase('playing');});
    return frame;
   }
   let frame=await launch();
   // A sample is intentionally bounded to once per five seconds, not per frame.
   await frame.waitForTimeout(5050);
   await frame.evaluate(()=>WrcadGameCubeRecovery.sample({frame:123,heapBytes:768*1048576,url:'private',gamecubeDiagnostics:{compiled:456,resources:{textures:22}}}));
   const stored=await page.evaluate(key=>sessionStorage.getItem(key),key);
   assert(stored.length<1000);assert(!stored.includes('private'));assert.equal(JSON.parse(stored).sample.frame,123);
   await frame.evaluate(()=>{for(let i=0;i<1000;i++)WrcadGameCubeRecovery.sample({frame:i});});
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),stored,'no per-frame storage churn');
   await page.reload();
   await page.locator('#gamecube-recovery').waitFor();
   await page.getByText('Last session details',{exact:true}).click();
   assert.match(await page.locator('#gamecube-recovery').innerText(),/GMSE01[\s\S]*frame: 123/);
   assert.match(await page.locator('#gamecube-recovery').innerText(),/exact cause is unknown/);
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
   await page.getByRole('button',{name:'Dismiss'}).click();await page.reload();
   assert.equal(await page.locator('#gamecube-recovery').count(),0,'report shown only once');
   frame=await launch();await frame.evaluate(()=>WrcadGameCubeRecovery.clear());
   await page.locator('iframe').evaluate(e=>e.remove());await page.waitForTimeout(30);await page.reload();
   assert.equal(await page.locator('#gamecube-recovery').count(),0,'normal exit followed by reload is quiet');
   frame=await launch();await frame.evaluate(()=>WrcadGameCubeRecovery.phase('saving state'));
   await page.locator('iframe').evaluate(e=>e.remove());await page.locator('#gamecube-recovery').waitFor();
   assert.match(await page.locator('#gamecube-recovery pre').textContent(),/saving state/,'unexpected iframe removal is reported too');
   const other=await context.newPage();await other.goto('http://recovery.test/play/');
   assert.equal(await other.locator('#gamecube-recovery').count(),0,'another tab does not inherit reports');
   await other.evaluate(()=>{sessionStorage.setItem('wrcad.gamecube.active.v1','invalid');});await other.reload();
   assert.equal(await other.locator('#gamecube-recovery').count(),0);
   await context.addInitScript(()=>Object.defineProperty(window,'sessionStorage',{get(){throw Error('unavailable');}}));
   await other.reload();await other.evaluate(()=>{WrcadGameCubeRecovery.begin();WrcadGameCubeRecovery.phase('paused');WrcadGameCubeRecovery.clear();});
   assert.deepEqual(errors,[]);
   console.log('PASS '+engine.name()+': interrupted reload/removal, intentional exit, phase, bounded private storage, unavailable storage');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
