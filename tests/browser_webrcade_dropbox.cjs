/* Browser OAuth/provider UI with fake Dropbox endpoints; no real tokens/accounts. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {chromium, webkit} = require('playwright');
const root = path.join(__dirname,'../deploy/webrcade/touch/cloud');
const origin = 'https://arcade.example.test', prefix = 'dropbox-fixture';
const config = {storagePrefix:prefix,appName:'CloudRcade',enabled:true,autoRedirect:false,accessAllowed:true,server:'https://cloud.example.test',saveFolder:'CloudRcade',
 dropbox:{enabled:true,appKey:'fixture-app',saveFolder:''}};
(async()=>{
 for(const engine of [chromium,webkit]) {
  const browser = await engine.launch({headless:true,...(engine===chromium?{args:['--no-sandbox'],...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})}:{})});
  try {
   const context = await browser.newContext({serviceWorkers:'block'}), errors=[];
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   let exchanges=0, revokes=0, autoReturn=true;
   await context.route('**/*',async route=>{
    const request=route.request(), url=new URL(request.url());
    if(url.origin==='https://www.dropbox.com') {
     assert.equal(url.pathname,'/oauth2/authorize');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
     const back=new URL(url.searchParams.get('redirect_uri'));back.searchParams.set('code','fixture-code');back.searchParams.set('state',url.searchParams.get('state'));
     return route.fulfill({contentType:'text/html',body:autoReturn?'<script>location.replace('+JSON.stringify(back.href)+')</script>':'<p>Waiting for consent</p>'});
    }
    if(url.origin==='https://api.dropboxapi.com') {
     if(url.pathname==='/oauth2/token') {
      exchanges++;const form=new URLSearchParams(request.postData());assert.equal(form.get('client_id'),'fixture-app');assert(form.get('code_verifier'));assert(!form.has('client_secret'));
      return route.fulfill({json:{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:14400,account_id:'dbid:alice'}});
     }
     if(url.pathname==='/2/users/get_current_account')return route.fulfill({json:{account_id:'dbid:alice',name:{display_name:'Alice'}}});
     if(url.pathname==='/2/auth/token/revoke'){revokes++;return route.fulfill({json:null});}
     throw new Error('Unexpected Dropbox route '+url.pathname);
    }
    assert.equal(url.origin,origin,'all external calls intercepted');
    if(url.pathname.startsWith('/play/'))return route.fulfill({contentType:'text/html',body:'<p>Returned to games</p>'});
    if(url.pathname==='/cloud-saves/config.php')return route.fulfill({contentType:'application/javascript',body:'window.WrcadCloudConfig='+JSON.stringify(config)});
    if(url.pathname==='/cloud-saves/api.php') {
     if(url.searchParams.get('action')==='status')return route.fulfill({json:{csrf:'fixture-csrf',config}});
     if(url.searchParams.get('action')==='verify')return route.fulfill({json:{connected:true}});
     throw new Error('Unexpected Nextcloud operation');
    }
    const name=url.pathname==='/cloud-saves/'?'index.html':path.basename(url.pathname);
    if(!['index.html','connect.css','runtime.js','dropbox.js','connect.js'].includes(name))return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(path.join(root,name))});
   });
   await page.goto(origin+'/cloud-saves/?return='+encodeURIComponent(origin+'/play/?feed=fixture'));
   assert.equal(await page.locator('#provider').inputValue(),'nextcloud');
   await page.locator('#provider').selectOption('dropbox');
   await page.getByRole('button',{name:'Link Dropbox',exact:true}).click();
   await page.waitForURL(origin+'/play/?feed=fixture');
   assert.equal(exchanges,1);assert.equal(await page.evaluate(p=>localStorage.getItem(p+'.cloud.provider.v1'),prefix),'dropbox');
   assert.equal(await page.evaluate(p=>JSON.parse(localStorage.getItem(p+'.dropbox.connection.v1')).uid,prefix),'dbid:alice');
   assert.equal(await page.evaluate(p=>sessionStorage.getItem(p+'.dropbox.connection.v1.flow'),prefix),null);
   // Saved connection is verified and selected without another OAuth grant.
   await page.goto(origin+'/cloud-saves/');
   await page.getByRole('button',{name:'Use this storage'}).click();await page.waitForURL(url=>url.pathname==='/play/');assert.equal(exchanges,1);
   // Switch to a separately stored Nextcloud connection; Dropbox remains linked.
   await page.evaluate(p=>localStorage.setItem(p+'.nextcloud.connection.v1',JSON.stringify({uid:'alice',name:'Alice',login:'fixture',password:'fixture',server:'https://cloud.example.test'})),prefix);
   await page.goto(origin+'/cloud-saves/?provider=nextcloud');await page.getByRole('button',{name:'Use this storage'}).click();await page.waitForURL(url=>url.pathname==='/play/');
   assert.equal(await page.evaluate(p=>localStorage.getItem(p+'.cloud.provider.v1'),prefix),'nextcloud');
   // Manage an inactive provider without retargeting ongoing games.
   await page.goto(origin+'/cloud-saves/?provider=dropbox');
   await page.getByRole('button',{name:'Disconnect this browser'}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('saved files remain in Dropbox'));
   assert.equal(revokes,1);assert.equal(await page.evaluate(p=>localStorage.getItem(p+'.dropbox.connection.v1'),prefix),null);
   assert.equal(await page.evaluate(p=>localStorage.getItem(p+'.cloud.provider.v1'),prefix),'nextcloud');
   // Copied/mismatched callback cannot exchange a code or create a credential.
   await page.goto(origin+'/cloud-saves/?provider=dropbox&code=wrong&state=wrong');
   await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('another browser tab'));
   assert.equal(exchanges,1);assert(!page.url().includes('code='));assert.equal(await page.evaluate(p=>localStorage.getItem(p+'.dropbox.connection.v1'),prefix),null);
   assert.deepEqual(errors,[]);await context.close();
   console.log('PASS '+engine.name()+' Dropbox same-tab PKCE return, durable connection, provider selection/reuse, inactive-provider revoke and copied-callback rejection');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
