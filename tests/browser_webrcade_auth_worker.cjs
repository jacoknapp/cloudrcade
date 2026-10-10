/* Check real worker installation during a pending Authentik redirect.
 * NODE_PATH=<Playwright modules> WEBRCADE_TEST_ORIGIN=https://arcade.example.com
 * node tests/browser_webrcade_auth_worker.cjs
 * Uses disposable profiles and pending cookies only; no account login or codes.
 * EXPECT_COOKIE_LOSS=1 reproduces the former worker's protected install fetches.
 */
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://arcade.example.com';
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch(engine===webkit?{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH}:{});
  try{
   const context=await browser.newContext(),page=await context.newPage();
   await context.route('**/__cloudrcade_worker_probe__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Disposable worker probe</title>'}));
   await page.goto(origin+'/__cloudrcade_worker_probe__');
   const start=await context.request.get(origin+'/outpost.goauthentik.io/start?rd='+encodeURIComponent(origin+'/play/'),{maxRedirects:0});
   assert.equal(start.status(),302);
   const pending=(await context.cookies(origin)).filter(c=>c.name.startsWith('authentik_proxy_'));
   assert(pending.length,'outpost creates a pending cookie');
   const state=await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.register('/touch-controls/offline-worker.js?cache=disposable-auth-probe-'+Date.now()+'&feed=%2Fcontent%2Ffeeds%2Fcombined.json',{scope:'/',updateViaCache:'none'});
    const worker=registration.installing||registration.waiting||registration.active;
    return await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error('Worker installation timed out')),20000);
     function changed(){if(['activated','redundant'].includes(worker.state)){clearTimeout(timer);resolve(worker.state)}}
     worker.addEventListener('statechange',changed);changed();
    });
   });
   const current=(await context.cookies(origin)).filter(c=>c.name.startsWith('authentik_proxy_'));
   const preserved=pending.every(c=>current.some(n=>n.name===c.name&&n.value===c.value));
   if(process.env.EXPECT_COOKIE_LOSS==='1'){
    assert.equal(preserved,false,'former install prefetch disrupts the pending session');
    console.log(engine.name()+': reproduced pending-cookie loss during worker installation');
   }else{
    assert.equal(state,'activated','worker installs without an authenticated library');
    assert(preserved,'worker installation preserves pending sign-in cookie');
    console.log('PASS '+engine.name()+' actual worker installation preserves pending sign-in cookie');
   }
   await page.evaluate(async()=>{for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();for(const key of await caches.keys())if(key.startsWith('disposable-auth-probe-'))await caches.delete(key)});
   await context.close();
  }finally{await browser.close()}
 }
})().catch(error=>{console.error(error.message);process.exitCode=1});
