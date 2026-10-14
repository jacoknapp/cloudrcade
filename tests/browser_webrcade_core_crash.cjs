// Actual packaged standard SDK cores: logger installs before bootstrap and preserves exits.
const assert=require('node:assert/strict');const {chromium}=require('playwright');
const origin=process.env.WEBRCADE_GAMECUBE_ORIGIN;
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const system of ['nes','retro-ppsspp','retro-azahar']){
   const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),reports=[];
   await context.addInitScript(()=>{let config;Object.defineProperty(window,'WrcadCloudConfig',{get:()=>config,set:v=>{config={...v,enabled:false,autoRedirect:false,storagePrefix:'shadowcrash_standard_fixture'};}});});
   await context.route('**/cloud-saves/core-crash-log.php',r=>{reports.push(r.request().postDataJSON());return r.fulfill({status:204,body:''});});
   const page=await context.newPage();await page.goto(origin+'/play/app/'+system+'/');
   await page.waitForFunction(()=>window.WrcadCoreCrash&&typeof window.app?.exit==='function');
   assert(await page.evaluate(()=>app.exit.toString().includes('WrcadCoreCrash')),'actual SDK exit hook missing: '+system);
   await page.evaluate(()=>{WrcadCoreCrash.begin();app.exit('Synthetic core error: private fixture path');});
   await page.waitForFunction(()=>!localStorage.getItem('wrcad.core.active.v1.reports'));
   assert(reports.some(r=>r.system===system&&r.reason==='core-abort'),'handled failure missing: '+system);
   assert(!JSON.stringify(reports).includes('private fixture path'));
   const count=reports.length;await page.evaluate(()=>{WrcadCoreCrash.begin();return app.exit();});await page.waitForTimeout(200);
   assert.equal(reports.length,count);assert.equal(await page.evaluate(()=>sessionStorage.getItem('wrcad.core.active.v1')),null);
   console.log('PASS actual '+system+' packaged SDK handled-error hook and quiet normal exit');await context.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
