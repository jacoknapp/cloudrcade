/* Actual native library -> details -> Play, with oversized mobile game frames.
 * Original homebrew only. PS2_TEST_ROM, WEBRCADE_TEST_ORIGIN, CHROME and
 * WEBRCADE_TEST_WEBKIT_PATH select the isolated fixture/browser executables.
 */
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://localhost:8443',rom=process.env.PS2_TEST_ROM;
if(!rom)throw new Error('PS2_TEST_ROM is required.');
const config={appName:'PS2 Launch Test',storagePrefix:'ps2_launch_test',enabled:false,enable3DS:false,ps2Url:'/experimental/ps2/',feedUrl:'/content/feeds/combined.json'};
const feed={title:'PS2 launch',categories:[{title:'PlayStation 2',items:[{title:'PS2 homebrew',type:'ps2',props:{rom:new URL(rom,origin).href}}]}]};
(async()=>{for(const engine of process.env.WEBRCADE_TEST_BROWSER==='webkit'?[webkit]:[chromium]){
 const browser=await engine.launch({headless:true,...(engine===chromium?{executablePath:process.env.CHROME,args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface','--ignore-gpu-blocklist']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',hasTouch:true,viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.addInitScript(()=>localStorage.setItem('ps2_launch_test.ps2.enabled.v1','1'));
  await context.route('**/cloud-saves/config.php',route=>route.fulfill({contentType:'application/javascript',body:'window.WrcadCloudConfig='+JSON.stringify(config)+';'}));
  await context.route('**/content/feeds/combined.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(feed)}));
  await page.goto(origin+'/play/');await page.locator('.cr-mobile-card').filter({hasText:'PlayStation 2'}).waitFor();await page.waitForTimeout(1500);
  const ok=page.getByRole('button',{name:'OK',exact:true});if(await ok.count())await ok.first().click();
  await page.locator('.cr-mobile-card').filter({hasText:'PlayStation 2'}).first().tap();await page.locator('.cr-mobile-card').filter({hasText:'PS2 homebrew'}).tap();
  await page.getByRole('dialog').getByRole('button').filter({hasText:/^\s*PLAY\s*$/}).tap();await page.locator('#webrcade-app-iframe').waitFor();
  const game=await(await page.locator('#webrcade-app-iframe').elementHandle()).contentFrame();
  await game.waitForFunction(()=>window.WrcadPS2?.ready&&WrcadPS2.module.getFrames()>30,null,{timeout:120000});
  const props=JSON.parse(decodeURIComponent(Buffer.from(new URL(game.url()).searchParams.get('props'),'base64').toString()));assert.equal(props.type,'play-ps2');
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.locator('#webrcade-app-iframe').evaluate((frame,height)=>frame.style.setProperty('height',height+'px','important'),viewport.height+60);await page.waitForTimeout(350);
   const picture=await game.locator('#outputCanvas').boundingBox();
   assert(picture.x>=-.5&&picture.y>=-.5&&picture.x+picture.width<=viewport.width+.5&&picture.y+picture.height<=viewport.height+.5,'picture fits the actual visible parent window');
   assert(Math.abs(picture.width/picture.height-4/3)<.001);
   if(viewport.width<viewport.height){const pad=await game.locator('.kt-pad').boundingBox();assert(picture.y+picture.height<=pad.y-19.5,'picture clears fixed default controls with20px gap');}
   else assert(Math.abs(picture.height-viewport.height)<.5,'landscape picture fits the clipped iframe');
  }
  await game.locator('.kt-menu').tap();await game.waitForFunction(()=>app.isPauseScreen());await game.evaluate(()=>WrcadPS2.hideMenu());
  await game.evaluate(()=>WrcadPS2.exit());await page.locator('#webrcade-app-iframe').waitFor({state:'detached'});assert.deepEqual(errors,[]);
  console.log('PASS',engine.name(),'PS2 actual library Play/canonical launch, portrait/landscape/oversized-frame geometry, Menu and return to library');
 }finally{await browser.close();}
}})().catch(error=>{console.error(error);process.exitCode=1;});
