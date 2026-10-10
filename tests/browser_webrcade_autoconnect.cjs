// Real pinned library/emulator with isolated browser storage and fake cloud transport.
// Requires Playwright and an SSH TLS tunnel; no real accounts or cloud saves.
// STAGE_PLAYER/STAGE_NES select staged assets; LIVE=1 tests served scripts.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {chromium} = require('playwright');
const root = path.join(__dirname, '../deploy/webrcade');
const origin = process.env.WEBRCADE_TEST_ORIGIN || 'https://arcade.example.test';
const cloud = process.env.WEBRCADE_TEST_NEXTCLOUD || 'https://cloud.example.test';
const prefix = process.env.WEBRCADE_TEST_PREFIX || 'wrcad', key = prefix + '.nextcloud.connection.v1';
const defaults={appName:process.env.WEBRCADE_TEST_APP_NAME || 'CloudRcade',storagePrefix:prefix,saveFolder:process.env.WEBRCADE_TEST_SAVE_FOLDER || 'CloudRcade',feedUrl:origin+'/content/feeds/combined.json',enable3DS:true,enabled:true,autoRedirect:true,accessAllowed:true,server:cloud,legacyServer:cloud,handoff:true,message:'No access has been enabled for Nextcloud. Please enable your own cloud instance.'};
const findLibrary = `() => {const root=document.getElementById('root')?._reactRootContainer?._internalRoot?.current;
function find(n){if(!n)return null;if(n.stateNode?.browseScreenRef)return n.stateNode;return find(n.child)||find(n.sibling)}return find(root)}`;
(async () => {
 const browser = await chromium.launch({headless:true,args:['--no-sandbox','--ignore-certificate-errors',
  '--host-resolver-rules=MAP '+new URL(origin).hostname+':443 127.0.0.1:'+(process.env.WEBRCADE_TEST_PORT || '18446')]});
 try {
  async function fixture({seed=false, expired=false, unavailable=false, paused=false, attempted=false,config=defaults,denied=false}={}) {
   const ctx=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
   const actions=[], errors=[];let nativeApproved=false;
   if(process.env.WEBRCADE_TEST_FEED_FILE){
    const feed=JSON.parse(fs.readFileSync(process.env.WEBRCADE_TEST_FEED_FILE));feed.categories=feed.categories.map(c=>({...c,items:c.items.filter(i=>i.type!=='3ds')})).filter(c=>c.items.length);
    await ctx.route('**/content/feeds/combined.json',r=>r.fulfill({json:JSON.parse(JSON.stringify(feed).replaceAll('https://arcade.example.test',origin))}));
   }
   await ctx.setExtraHTTPHeaders({'X-Authentik-Groups':'Nextcloud'});
   if(config!==defaults)await ctx.route('**/cloud-saves/config.php',r=>r.fulfill({contentType:'application/javascript',body:'window.WrcadCloudConfig='+JSON.stringify(config)+';'}));
   await ctx.addInitScript(({seed,paused,attempted,key,server})=>{
    if(localStorage.getItem('auto-test-seeded'))return;
    localStorage.setItem('auto-test-seeded','true');
    if(seed)localStorage.setItem(key,JSON.stringify({server,uid:'fixture',login:'fixture',password:'fake',name:'Fixture'}));
    if(paused)localStorage.setItem(key+'.paused','true');
    if(attempted)sessionStorage.setItem(key+'.attempt','true');
   },{seed,paused,attempted,key,server:cloud});
   await ctx.route('**/cloud-saves/api.php?**',async r=>{
    const action=new URL(r.request().url()).searchParams.get('action');actions.push(action);
    if(unavailable)return r.abort();
    if(action==='status')return r.fulfill({json:{csrf:'fixture',config}});
    if(action==='verify')return r.fulfill({status:expired?401:200,json:expired?{error:'Expired'}:{connected:true}});
    if(action==='login'&&denied)return r.fulfill({status:403,json:{code:'access_denied',error:config.message}});
    if(action==='login')return r.fulfill({json:{start:config.handoff?cloud+'/apps/retroarcade_login/start':null,
      flow:cloud+'/login/v2/flow/fake',login:cloud+'/fake',directLogin:cloud+'/fake'}});
    if(action==='poll'&&!config.handoff&&!nativeApproved)return r.fulfill({status:202,json:{connected:false}});
    if(action==='poll'){expired=false;return r.fulfill({json:{connected:true,connection:{server:config.server,uid:'fixture',login:'fixture',password:'fake',name:'Fixture'},receipt:'fixture'}});}
    if(action==='file')return r.fulfill({status:r.request().method()==='PUT'?200:404,json:{error:'Missing'},headers:{ETag:'"fixture"'}});
    if(['ack','unlink','cancel'].includes(action))return r.fulfill({json:{}});
    throw new Error('Unexpected fake API action '+action);
   });
   await ctx.route(cloud+'/apps/retroarcade_login/start',async r=>{
    assert.equal(r.request().method(),'POST');assert(r.request().postData().includes('flow='));
    await r.fulfill({status:303,headers:{Location:origin+'/cloud-saves/?resume=1'},body:''});
   });
   await ctx.route(cloud+'/fake',r=>r.fulfill({contentType:'text/html',body:'<button onclick="fetch(\'/approve-fixture\')">Grant access</button>'}));
   await ctx.route(cloud+'/approve-fixture',r=>{nativeApproved=true;return r.fulfill({body:'approved'});});
   if(!process.env.LIVE){
    for(const name of ['bridge.js','connect.js'])await ctx.route('**/cloud-saves/'+name+'*',r=>r.fulfill({
      contentType:'application/javascript',body:fs.readFileSync(path.join(root,'touch/cloud',name))}));
    await ctx.route('**/play/static/js/main.*.chunk.js*',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.STAGE_PLAYER)}));
    await ctx.route('**/play/app/retro-fceumm/*',r=>{
     const u=new URL(r.request().url());
     if(u.pathname==='/play/app/retro-fceumm/')return r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(process.env.STAGE_NES,'index.html'))});
     return r.continue();
    });
    await ctx.route('**/arcade-bundles/retro-fceumm/cloud-main.js*',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(process.env.STAGE_NES,'cloud-main.js'))}));
   }
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   if(process.env.DEBUG_AUTO){page.on('framenavigated',f=>{if(f===page.mainFrame())console.log('NAV',f.url())});page.on('pageerror',e=>console.log('JS',e.message));}
   return {ctx,page,actions,errors};
  }
  async function library(f) {
   await f.page.goto(origin+'/play/',{waitUntil:'domcontentloaded'});
   await f.page.waitForFunction('('+findLibrary+')()?.state.feed?.getUniqueCategories().length > 1');
   const ok=f.page.getByRole('button',{name:'OK',exact:true});
   if(await ok.count())await ok.first().click();
  }
  async function cloudTab(f){
   await f.page.evaluate('('+findLibrary+')().ctx.showSettingsEditor(true)');
   await f.page.evaluate(()=>{const root=document.getElementById('root')._reactRootContainer._internalRoot.current;
    function find(n){if(!n)return null;if(n.stateNode?.switchTab&&n.stateNode.props.tabs)return n.stateNode;return find(n.child)||find(n.sibling)}
    find(root).setState({tabIndex:2});});
  }
  for(const config of [{...defaults,enabled:false,autoRedirect:false},{...defaults,accessAllowed:false}]){
   const f=await fixture({config});await library(f);assert(!f.actions.includes('login'));
   if(config.enabled)await f.page.locator('#wrcad-nextcloud-notice').filter({hasText:config.message}).waitFor();
   await f.page.goto(origin+'/cloud-saves/?auto=1&return='+encodeURIComponent(origin+'/play/?preserve=1'),{waitUntil:'domcontentloaded'});
   await f.page.waitForURL('**/play/?preserve=1');await f.page.locator('#wrcad-nextcloud-notice').filter({hasText:config.message}).waitFor();
   assert(!f.actions.includes('login'));assert.deepEqual(f.errors,[]);await f.ctx.close();
  }
  const denied=await fixture({denied:true});await library(denied);await denied.page.locator('#wrcad-nextcloud-notice').filter({hasText:defaults.message}).waitFor();
  assert(denied.actions.includes('login')&&!denied.actions.includes('poll'));assert.deepEqual(denied.errors,[]);await denied.ctx.close();
  const manual=await fixture({config:{...defaults,autoRedirect:false}});await library(manual);assert(!manual.actions.includes('login'));
  await cloudTab(manual);await manual.page.getByText('Link',{exact:true}).click();
  await manual.page.waitForURL('**/play/');await manual.page.waitForFunction('('+findLibrary+')()?.state.feed?.getUniqueCategories().length > 1');
  assert(manual.actions.includes('login')&&manual.actions.includes('poll'));assert.deepEqual(manual.errors,[]);await manual.ctx.close();
  console.log('PASS disabled/denied return with requested message and preserved URL, manual Link with auto login off');
  const native=await fixture({config:{...defaults,autoRedirect:false,handoff:false}});await library(native);await cloudTab(native);
  const popupOpened=native.ctx.waitForEvent('page');await native.page.getByText('Link',{exact:true}).click();const approval=await popupOpened;
  await approval.getByRole('button',{name:'Grant access'}).click();await native.page.waitForURL('**/play/');
  assert(native.actions.includes('poll')&&native.actions.includes('ack'));assert.deepEqual(native.errors,[]);await native.ctx.close();
  console.log('PASS portable native authorization without the optional handoff resumes the game after approval');
  const fresh=await fixture();await library(fresh);
  assert(fresh.actions.includes('login')&&fresh.actions.includes('poll')&&fresh.actions.includes('ack'));
  assert.equal(await fresh.page.evaluate(k=>localStorage.getItem(k+'.enable'),key),null);
  assert.equal(await fresh.page.evaluate(k=>sessionStorage.getItem(k+'.attempt'),key),null);
  await cloudTab(fresh);
  await fresh.page.getByText('Nextcloud',{exact:true}).waitFor();
  assert(await fresh.page.getByText('Connected as Fixture · automatic saves',{exact:true}).isVisible());
  assert.equal(await fresh.page.getByText('Enabled',{exact:true}).count(),0);
  assert.equal(await fresh.page.getByText('Other cloud storage',{exact:true}).count(),0);
  await fresh.page.getByText('Manage',{exact:true}).click();
  await fresh.page.waitForURL('**/cloud-saves/**');
  await fresh.page.locator('#disconnect').click();
  await fresh.page.getByText('Disconnected. Your saved files remain in Nextcloud.',{exact:true}).waitFor();
  const logins=fresh.actions.filter(a=>a==='login').length;
  await library(fresh);assert.equal(fresh.actions.filter(a=>a==='login').length,logins);
  assert.equal(await fresh.page.evaluate(k=>localStorage.getItem(k+'.paused'),key),'true');
  assert.deepEqual(fresh.errors,[]);await fresh.ctx.close();
  console.log('PASS fresh automatic same-tab connection, independent UI, unavailable provider hidden, explicit disconnect respected');
  for(const options of [{unavailable:true},{paused:true},{attempted:true}]){
   const f=await fixture(options);await library(f);assert(!f.actions.includes('login'));assert.deepEqual(f.errors,[]);await f.ctx.close();
  }
  console.log('PASS unavailable/offline startup and interrupted sign-in preserve local library without redirect loops');
  const expired=await fixture({seed:true,expired:true});await library(expired);
  assert(expired.actions.includes('verify')&&expired.actions.includes('login'));assert.deepEqual(expired.errors,[]);await expired.ctx.close();
  console.log('PASS expired browser credential reconnects automatically');
  const saved=await fixture({seed:true});await library(saved);
  assert(saved.actions.includes('verify'));assert(!saved.actions.includes('login'));
  const feed=await saved.page.evaluate(async()=>(await fetch('/content/feeds/combined.json')).json());
  const item=feed.categories.flatMap(c=>c.items).find(i=>i.type==='nes');
  const props={...feed.props,...item.props,type:'nes',title:item.title};
  const encoded=encodeURIComponent(Buffer.from(encodeURIComponent(JSON.stringify(props))).toString('base64'));
  await saved.page.goto(origin+'/play/app/retro-fceumm/?ctx=standalone&props='+encoded,{waitUntil:'domcontentloaded'});
  await saved.page.waitForFunction('window.app?.emulator?.started && !app.isShowOverlay()', null, {timeout:60000});
  const result=await saved.page.evaluate(async()=>{
   const m=app.emulator.saveManager;app.emulator.pause(true);
   // The generated bundle's registered settings must keep the native switch off.

   const enabled=await m.isCloudEnabled();
   const saved=await m.save('/automatic-nextcloud-test',[{name:'sav',content:new Uint8Array([17,29])}]);
   await m.saveState('/automatic-nextcloud-test/',1,new Uint8Array([5,6]),null,null,'data:image/png;base64,fixture');
   const local=await m.loadLocal('/automatic-nextcloud-test');
   return {enabled,saved,local:Array.from(local.find(f=>f.name==='sav').content)};
  });
  assert.deepEqual(result,{enabled:true,saved:true,local:[17,29]});
  assert(saved.actions.filter(a=>a==='file').length>=3);
  assert.deepEqual(saved.errors,[]);await saved.ctx.close();
  console.log('PASS saved login reused, real native ZIP/game save and state slot upload with native cloud switch disabled');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
