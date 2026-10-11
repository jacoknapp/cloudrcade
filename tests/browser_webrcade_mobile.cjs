/* Real library/mobile core lifecycle regression; own ROMs required.
 * NODE_PATH=<Playwright modules> WEBRCADE_TEST_ORIGIN=https://arcade.example.test
 * WEBRCADE_TEST_PORT=<TLS tunnel port> node tests/browser_webrcade_mobile.cjs
 * STAGE_PLAYER=<patched player> intercepts only new library assets during staging.
 * STAGE_VIEWPORT=1 stages current viewport/controller adapters and initial metadata.
 * WEBRCADE_TEST_OUTPUT=<existing directory> saves viewport screenshots.
 * Cloud transport is disabled in a disposable profile; no operator saves/accounts.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {chromium,webkit,devices} = require('playwright');
const safari = process.env.WEBRCADE_TEST_BROWSER === 'webkit';
const root = path.join(__dirname, '../deploy/webrcade/touch');
const origin = process.env.WEBRCADE_TEST_ORIGIN || 'https://arcade.example.test';
const port = process.env.WEBRCADE_TEST_PORT || '18477';
const findLibrary = () => {function find(n){if(!n)return null;if(n.stateNode?.browseScreenRef)return n.stateNode;return find(n.child)||find(n.sibling)}return find(document.getElementById('root')._reactRootContainer._internalRoot.current)};
(async () => {
 const browser = safari ? await webkit.launch({executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH}) : await chromium.launch({executablePath:process.env.CHROME,args:['--no-sandbox','--ignore-certificate-errors','--use-angle=swiftshader','--enable-unsafe-swiftshader',
  '--host-resolver-rules=MAP '+new URL(origin).hostname+':443 127.0.0.1:'+port]});
 try {
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,ignoreHTTPSErrors:true,serviceWorkers:'block',...(safari?{userAgent:devices['iPhone 13'].userAgent}:{permissions:['screen-wake-lock']})});
  let releaseInitialFeed;
  const initialFeedGate=new Promise(resolve=>{releaseInitialFeed=resolve});
  let runtimeConfig;
  await context.route('**/cloud-saves/api.php?**',route=>{const action=new URL(route.request().url()).searchParams.get('action');
   return route.fulfill({status:action==='status'?200:404,json:action==='status'?{csrf:'fixture',config:runtimeConfig}:{error:'Missing fixture'}});});
  await context.route('**/cloud-saves/config.php',async route=>{
   const response = await route.fetch({url:'https://127.0.0.1:'+port+'/cloud-saves/config.php'});
   const config=JSON.parse((await response.text()).replace(/^window.WrcadCloudConfig\s*=\s*/, '').replace(/;\s*$/, ''));
   config.enabled=true;config.autoRedirect=false;config.accessAllowed=true;config.feedUrl=origin+'/content/feeds/combined.json';runtimeConfig=config;
   await route.fulfill({response,body:'window.WrcadCloudConfig='+JSON.stringify(config)+';'});
  });
  await context.route('**/content/feeds/combined.json',async route=>{await initialFeedGate;const response=await route.fetch({url:'https://127.0.0.1:'+port+'/content/feeds/combined.json'});
   const feed=JSON.parse(await response.text());
   function rewrite(value){if(typeof value==='string' && /^https?:\/\//.test(value)){const url=new URL(value);if(url.pathname.startsWith('/content/'))return origin+url.pathname+url.search;}
    if(Array.isArray(value))return value.map(rewrite);if(value&&typeof value==='object')for(const key of Object.keys(value))value[key]=rewrite(value[key]);return value;}
   await route.fulfill({response,json:rewrite(feed)});});
  if(process.env.STAGE_PLAYER){
   await context.route('**/play/',async route=>{
    const response=await route.fetch({url:'https://127.0.0.1:'+port+'/play/'});
    let html=await response.text();html=html.replace('<head>','<head><link rel="stylesheet" href="/touch-controls/mobile.css"><script src="/touch-controls/mobile.js"></script>');
    await route.fulfill({response,body:html});
   });
   await context.route('**/play/static/js/main.*.chunk.js*',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.STAGE_PLAYER)}));
  }
  if(process.env.STAGE_PLAYER || process.env.STAGE_VIEWPORT){
   for(const file of ['mobile.js','mobile.css','brand.js','controller.js','controller.css','viewport.css'])await context.route('**/touch-controls/'+file+'*',route=>route.fulfill({contentType:file.endsWith('css')?'text/css':'application/javascript',body:fs.readFileSync(path.join(root,'assets',file))}));
  }
  if(process.env.STAGE_VIEWPORT)await context.route('**/play/**',async route=>{
   if(route.request().resourceType()!=='document')return route.fallback();
   const response=await route.fetch();
   let html=(await response.text()).replace('apple-mobile-web-app-status-bar-style" content="black-translucent"','apple-mobile-web-app-status-bar-style" content="black"');
   html=html.replace('<head>', '<head><link rel="stylesheet" href="/touch-controls/viewport.css">');
   html=html.replace(/(<meta\b[^>]*name="viewport"[^>]*content=")([^"]*)(")/,(_,a,b,c)=>a+b.replace(/,?\s*viewport-fit\s*=\s*\w+/g,'')+', viewport-fit=cover'+c);
   await route.fulfill({response,body:html});
  });
  const page=await context.newPage(),errors=[],coreRequests=[];
  page.on('pageerror',e=>{errors.push(e.message);console.log('JS',e.message)});
  page.on('request',r=>{if(/\.wasm(?:\?|$)/.test(r.url()))coreRequests.push(r.url())});
  await page.goto(origin+'/play/',{waitUntil:'domcontentloaded'});
  const capture=async name=>{if(process.env.WEBRCADE_TEST_OUTPUT)await page.screenshot({path:path.join(process.env.WEBRCADE_TEST_OUTPUT,name+'.png')})};
  async function stableSettingsNavigation(scope,width,height,name){
   await page.setViewportSize({width,height});await page.waitForTimeout(150);
   const dialog=scope.locator('._QxYEW');
   const geometry=()=>dialog.evaluate(el=>[el,el.querySelector('._1OdS7'),...el.querySelectorAll('._2k8Sx button'),el.querySelector('._E4PtH')]
    .map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
   const baseline=await geometry();let pages=0;
   for(;pages<20;pages++){
    await page.waitForTimeout(150);
    const current=await geometry();
    assert(current.every((rect,i)=>Object.keys(rect).every(key=>Math.abs(rect[key]-baseline[i][key])<1)),name+' settings navigation and actions stay fixed across pages');
    assert(current[0].x>=0 && current[0].y>=0 && current[0].x+current[0].width<=width && current[0].y+current[0].height<=height,name+' settings fit the viewport');
    const content=dialog.locator('._3aKyj');
    assert(await content.locator('._3Y0YY,._19qVy').evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth+1)),name+' settings help wraps without clipped text');
    if(await content.evaluate(el=>el.scrollHeight>el.clientHeight)){
     await content.evaluate(el=>{el.scrollTop=el.scrollHeight});
     assert(await content.evaluate(el=>el.scrollTop>0),name+' long settings content scrolls');
     const scrolled=await geometry();assert.deepEqual(scrolled,current,name+' scrolling leaves navigation and actions in place');
     await capture('mobile-settings-scroll-'+name);
     await content.evaluate(el=>{el.scrollTop=0});
    }
    const next=scope.locator('._2k8Sx button').last();if(await next.isDisabled())break;
    await next.click();
   }
   assert(pages>0 && pages<20,name+' checked every available settings page');
   for(let i=0;i<pages;i++){await scope.locator('._2k8Sx button').first().click();await page.waitForTimeout(150);}
  }
  const loading=page.locator('#loadingScreen');
  await loading.waitFor();await page.waitForTimeout(2500);
  for(const [width,height,name] of [[390,844,'phone'],[844,390,'landscape'],[320,568,'small-phone'],[768,1024,'tablet']]){
   await page.setViewportSize({width,height});await page.waitForTimeout(150);
   const layout=await loading.evaluate(el=>({bounds:el.getBoundingClientRect().toJSON(),logo:el.querySelector('.logoLarge').getBoundingClientRect().toJSON(),opacity:+getComputedStyle(el).opacity}));
   for(const rect of [layout.bounds,layout.logo])assert(rect.x>=0 && rect.y>=0 && rect.right<=width && rect.bottom<=height,'loading screen fits '+name);
   assert(layout.opacity>=.95,'loading screen stays visible after its animation');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'loading does not overflow the viewport');
   assert(await loading.locator('.loading-text').isVisible(),'loading status remains visible');
   await capture('mobile-loading-'+name);
  }
  await page.setViewportSize({width:390,height:844});
  const logoText=loading.locator('.logoLarge-left-text'),name=await logoText.innerText();
  await logoText.evaluate(el=>{el.textContent='A longer configured arcade name'});
  assert(await logoText.evaluate(el=>el.scrollWidth<=el.clientWidth),'configured branding wraps within the loading screen');
  await logoText.evaluate((el,name)=>{el.textContent=name},name);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await loading.evaluate(el=>getComputedStyle(el).animationName),'none','loading respects reduced motion');
  await page.emulateMedia({reducedMotion:'no-preference'});
  releaseInitialFeed();
  await page.waitForSelector('.cr-mobile-card');
  await loading.waitFor({state:'detached'});
  console.log('PASS mobile loading logo/status fit portrait, landscape, small phones/tablets, remain visible through slow loading and release on readiness');
  await page.evaluate('('+findLibrary.toString()+')().ctx.showReleaseNotes(false)');
  async function fits(width,height,name){
   await page.setViewportSize({width,height});await page.waitForTimeout(150);
   const bounds=await page.locator('.cr-mobile-library .webrcade-outer').boundingBox();
   assert(Math.abs(bounds.width-width)<2 && Math.abs(bounds.height-height)<2, 'mobile fills available viewport: '+JSON.stringify({bounds,expected:{width,height},viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight,visual:{width:visualViewport?.width,height:visualViewport?.height,scale:visualViewport?.scale},measured:document.documentElement.style.cssText}))}));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal page overflow');
   await capture(name);
  }
  await fits(390,844,'mobile-phone');
  assert.equal(await page.locator('.cr-mobile-cards').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),3,'phone grid fits three compact cards');
  const chromeHeight=await page.locator('.cr-mobile-library').evaluate(el=>['.header-nav','.cr-mobile-toolbar'].reduce((height,selector)=>height+el.querySelector(selector).getBoundingClientRect().height,0));
  assert(chromeHeight<=150,'phone navigation leaves space for games: '+chromeHeight);
  await page.waitForTimeout(500);assert((await page.locator('meta[name="viewport"]').getAttribute('content')).includes('viewport-fit=cover'),'safe-area viewport survives iOS native setup');
  await fits(844,390,'mobile-landscape');await fits(768,1024,'mobile-tablet');await fits(390,844,'mobile-phone');
  assert.equal(coreRequests.length,0,'library does not preload emulator cores');
  const feedsControl=page.locator('.header-nav-right .cr-mobile-feeds-button');
  assert(await feedsControl.isVisible(),'Feeds is separate from the category selector');
  const feedsTarget=await feedsControl.boundingBox();assert(feedsTarget.width>=44 && feedsTarget.height>=44,'Feeds has a full mobile touch target');
  assert.equal(await page.locator('.cr-mobile-breadcrumb').getByRole('button',{name:'Feeds',exact:true}).count(),0,'category navigation has no mixed-in feed control');
  await page.getByRole('button',{name:'Feeds',exact:true}).click();
  assert.equal(await feedsControl.getAttribute('aria-current'),'page','Feeds indicates its selected view');
  assert.equal(await page.locator('.cr-mobile-toolbar h1').innerText(),'Feeds');
  await capture('mobile-feed-selector');
  await page.locator('.cr-mobile-card').filter({hasText:'Add'}).click();
  await page.getByRole('dialog').waitFor();await capture('mobile-feed-details');
  assert(await page.getByRole('dialog').getByRole('button').filter({hasText:/^\s*URL\s*$/}).isVisible());
  assert(await page.getByRole('dialog').getByRole('button').filter({hasText:/^\s*FILE\s*$/}).isVisible());
  await page.getByRole('button',{name:'Close details'}).click();
  await page.getByRole('button',{name:'‹ Systems'}).click();
  await page.locator('.header-nav-right button').last().click();
  await page.getByText('Display Settings',{exact:true}).waitFor();
  await page.waitForFunction(()=>{const el=document.querySelector('._1OdS7');return el && +getComputedStyle(el).opacity > .95});
  await stableSettingsNavigation(page,390,844,'phone');
  await stableSettingsNavigation(page,320,568,'small-phone');
  await stableSettingsNavigation(page,844,390,'landscape');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
  const panel=await page.locator('._QxYEW').boundingBox();assert(panel.x>=0 && panel.x+panel.width<=390,'native settings fit phone');
  const targets=await page.locator('._QxYEW button,._35dTO,._2G8jD').evaluateAll(els=>els.filter(el=>el.offsetHeight).map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
  assert(targets.every(t=>t.width>=44 && t.height>=44),'native settings targets are at least 44px: '+JSON.stringify(targets));
  await capture('mobile-settings');
  assert(panel.height<420,'display settings use a compact panel rather than a tall TV layout');
  const settingsRow=await page.locator('._3e512').first().evaluate(el=>{
   const children=[...el.children].map(child=>child.getBoundingClientRect());return Math.abs((children[0].y+children[0].height/2)-(children[1].y+children[1].height/2));});
  assert(settingsRow<3,'setting labels and controls align in one row');
  await page.locator('._2k8Sx button').last().click();await page.waitForTimeout(400);
  await page.locator('._2k8Sx button').last().click();
  await page.getByText('Cloud Storage',{exact:true}).waitFor();
  await page.getByText('Nextcloud',{exact:true}).waitFor();
  assert(await page.getByRole('button').filter({hasText:/^\s*Link\s*$/}).isVisible(),'native Nextcloud Link remains available');
  await page.waitForTimeout(600);await capture('mobile-cloud-settings');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  const search=page.getByRole('searchbox',{name:'Search games'});
  await search.fill('no-such-game-fixture');
  await page.getByText('No games match your search.',{exact:true}).waitFor();
  await search.fill('');await search.pressSequentially('Mario',{delay:30});
  assert(await search.evaluate(el=>document.activeElement===el),'typing keeps search focus');assert(await page.locator('.cr-mobile-card').count()>0);
  await search.fill('');
  await page.locator('.cr-mobile-card').filter({hasText:'Super Nintendo'}).click();
  assert.equal(await page.locator('.cr-mobile-card').count(),48,'large folders mount only one page');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  assert((await page.locator('.cr-mobile-pagination').innerText()).includes('49–96'));
  await page.getByRole('button',{name:'‹ Systems'}).click();
  await page.locator('.cr-mobile-card').filter({hasText:'Nintendo Entertainment System'}).click();
  const title=await page.locator('.cr-mobile-card-title').first().innerText();
  await page.locator('.cr-mobile-card').first().tap();
  await page.getByRole('dialog').waitFor();await capture('mobile-game-details');
  await page.getByRole('dialog').getByRole('button').filter({hasText:/^\s*PLAY\s*$/}).tap();
  await page.waitForSelector('#webrcade-app-iframe');
  const frame=page.frameLocator('#webrcade-app-iframe');
  const iframe=await (await page.locator('#webrcade-app-iframe').elementHandle()).contentFrame();
  await iframe.waitForFunction(()=>window.app?.emulator?.started,{timeout:60000});
  for(const viewport of [{width:390,height:844},{width:844,height:390},{width:320,height:568},{width:768,height:1024}]){
   await page.setViewportSize(viewport);await page.waitForTimeout(150);
   const bounds=await page.locator('#webrcade-app-iframe').boundingBox();
   assert(Math.abs(bounds.x)<1 && Math.abs(bounds.y)<1 && Math.abs(bounds.width-viewport.width)<1 && Math.abs(bounds.height-viewport.height)<1,
    'native game frame fills the mobile viewport: '+JSON.stringify(bounds));
   assert.deepEqual(await iframe.evaluate(()=>({width:innerWidth,height:innerHeight})),viewport,'game uses the full parent viewport');
  }
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
  for(const scope of [page,iframe]){
   assert((await scope.locator('meta[name="viewport"]').getAttribute('content')).includes('viewport-fit=cover'),'library and game request the full safe-area viewport');
   await scope.evaluate(()=>document.querySelector('meta[name="viewport"]').content='width=device-width, initial-scale=1, viewport-fit=auto');
   await scope.waitForFunction(()=>document.querySelector('meta[name="viewport"]').content.includes('viewport-fit=cover'));
  }
  const overlays=iframe.getByText('Click', {exact:false});
  // Resume audio through the existing overlay, if this browser requires a gesture.
  if(await overlays.count())await overlays.first().click({timeout:3000}).catch(()=>{});
  assert.equal(await page.locator('.cr-mobile-card').count(),0,'cards unmount during gameplay');
  assert.equal(await page.locator('.cr-mobile-sheet').count(),0,'details/artwork unmount during gameplay');
  assert.equal(await page.evaluate('('+findLibrary.toString()+')().browseScreenRef.current._searchCache'),null,'search cache releases during play');
  assert(coreRequests.length>0,'native core is loaded on game launch');
  await capture('mobile-game-running');
  await iframe.locator('.kt-tab').tap();
  await iframe.locator('#kt-drawer').waitFor({state:'visible'});
  assert.equal(await iframe.locator('#kt-drawer').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(17, 28, 50)','controller pop-out retains its original blue palette');
  await capture('mobile-controller-menu');
  await iframe.locator('.kt-close').click();
  await iframe.locator('.kt-menu').tap();await iframe.waitForFunction(()=>app.isPauseScreen());
  const menu=iframe.locator('._3c68d');
  await menu.waitFor();
  assert.equal(await menu.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1,'portrait game menu uses mobile rows');
  const menuTargets=await menu.getByRole('button').evaluateAll(els=>els.map(el=>({height:el.getBoundingClientRect().height,font:+parseFloat(getComputedStyle(el).fontSize)})));
  assert(menuTargets.every(t=>t.height>=44 && t.font>=14),'game menu actions remain readable and tappable');
  await capture('mobile-game-menu');
  await iframe.getByRole('button',{name:/^View Controls/}).click();
  await iframe.locator('._QxYEW').waitFor();
  assert.equal(await iframe.locator('._1YZKt').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),14,'controls guide is readable on mobile');
  await capture('mobile-game-controls');
  await iframe.getByRole('button',{name:'OK',exact:true}).click();
  if(!await iframe.evaluate(()=>app.isPauseScreen())) {
   await iframe.locator('.kt-menu').tap();await iframe.waitForFunction(()=>app.isPauseScreen());
  }
  await iframe.getByRole('button',{name:/NES Settings/}).click();
  await iframe.locator('._QxYEW').waitFor();await page.waitForTimeout(300);
  const coreSettings=await iframe.locator('._QxYEW').boundingBox();
  assert(coreSettings.x>=0 && coreSettings.x+coreSettings.width<=390,'in-game settings fit the phone');
  await stableSettingsNavigation(iframe,390,844,'game-phone');
  await stableSettingsNavigation(iframe,844,390,'game-landscape');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
  await capture('mobile-game-settings');
  await iframe.getByRole('button',{name:'Cancel',exact:true}).click();
  if(!await iframe.evaluate(()=>app.isPauseScreen())) {
   await iframe.locator('.kt-menu').tap();await iframe.waitForFunction(()=>app.isPauseScreen());
  }
  await page.setViewportSize({width:844,height:390});
  assert.equal(await menu.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2,'landscape game menu uses two compact columns');
  await capture('mobile-game-menu-landscape');
  await iframe.getByRole('button',{name:/^Resume/}).click();
  await iframe.waitForFunction(()=>!app.isPauseScreen());
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>document.getElementById('webrcade-app-iframe').contentWindow.postMessage('exit','*'));
  await page.waitForSelector('.cr-mobile-card',{timeout:30000});
  assert.equal(await page.locator('#webrcade-app-iframe').count(),0,'native exit disposes emulator iframe');
  assert(await page.locator('.cr-mobile-card-title').filter({hasText:title}).count()>0,'returns to original folder');
  if(await page.getByRole('button',{name:'Close details'}).count())await page.getByRole('button',{name:'Close details'}).click();
  await page.getByRole('button',{name:'‹ Systems'}).click();
  assert(await page.locator('.cr-mobile-card').filter({hasText:'Recently Played'}).count()>0,'native history records mobile launch');
  if(process.env.WEBRCADE_TEST_3DS_TITLE){
   let keys=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/cloud-saves/3ds-keys.php')keys++;});
   await search.fill(process.env.WEBRCADE_TEST_3DS_TITLE);await page.locator('.cr-mobile-card').first().tap();
   await page.getByRole('dialog').getByText(/Streamed games require an internet connection/).waitFor();
   await page.getByRole('dialog').getByRole('button').filter({hasText:/^\s*PLAY\s*$/}).tap();
   const appFrame=await (await page.waitForSelector('#webrcade-app-iframe')).contentFrame();
   await appFrame.waitForFunction(()=>window.emulator?.mainStarted && window.Module?._get_current_frame_count?.()>150 &&
    Object.values(window.Module?.nativeVertexStats||{}).some(v=>v>0),null,{timeout:180000});
   assert.equal(keys,1,'encrypted 3DS still loads only the external mounted BIOS key set');
   assert.equal(await page.locator('.cr-mobile-card').count(),0);
   await page.evaluate(()=>document.getElementById('webrcade-app-iframe').contentWindow.postMessage('exit','*'));
   await page.waitForSelector('.cr-mobile-card',{timeout:180000});
   assert.equal(await page.locator('#webrcade-app-iframe').count(),0);
   console.log('PASS mobile touch launch of encrypted 3DS, real graphics, one external BIOS fetch, library unload and native core exit');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS phone/landscape/tablet fill, feeds URL/file, fixed settings navigation/actions with scrolling content across every page, all-library/empty search, bounded pagination, no core preload, real NES launch, UI/search unload, native emulator disposal, folder/history restore');
  await context.close();
  const desktop=await browser.newContext({viewport:{width:1440,height:900},ignoreHTTPSErrors:true,serviceWorkers:'block'});
  await desktop.route('**/cloud-saves/config.php',async route=>{const response=await route.fetch({url:'https://127.0.0.1:'+port+'/cloud-saves/config.php'});await route.fulfill({response,body:(await response.text()).replace('"autoRedirect":true','"autoRedirect":false')});});
  if(process.env.STAGE_PLAYER){
   await desktop.route('**/play/',async route=>{const response=await route.fetch({url:'https://127.0.0.1:'+port+'/play/'});await route.fulfill({response,body:(await response.text()).replace('<head>','<head><link rel="stylesheet" href="/touch-controls/mobile.css"><script src="/touch-controls/mobile.js"></script>')});});
   await desktop.route('**/play/static/js/main.*.chunk.js*',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.STAGE_PLAYER)}));
   for(const file of ['mobile.js','mobile.css'])await desktop.route('**/touch-controls/'+file+'*',route=>route.fulfill({contentType:file.endsWith('css')?'text/css':'application/javascript',body:fs.readFileSync(path.join(root,'assets',file))}));
  }
  const dp=await desktop.newPage();await dp.goto(origin+'/play/');await dp.waitForSelector('.slider');await dp.evaluate('('+findLibrary.toString()+')().ctx.showReleaseNotes(false)');
  assert.equal(await dp.locator('.cr-mobile-card').count(),0);assert.equal(await dp.locator('.slider').count(),1);
  if(process.env.WEBRCADE_TEST_OUTPUT)await dp.screenshot({path:path.join(process.env.WEBRCADE_TEST_OUTPUT,'mobile-desktop-preserved.png')});
  await dp.setViewportSize({width:800,height:600});assert.equal(await dp.locator('.cr-mobile-card').count(),0,'small desktop window keeps desktop view');
  console.log('PASS desktop retains native carousel/theme');await desktop.close();
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
