/* Device-GPU native library -> GameCube -> existing drawer regression.
 * Requires a packaged beta image and GAMECUBE_TEST_ROM URL; no accounts or
 * operator preferences are modified. Software adapters are rejected by the app.
 * Uses a fresh browser profile and read-only disc requests.
 */
const assert=require('node:assert/strict'),fs=require('node:fs');const{chromium}=require('playwright');
const origin=process.env.WEBRCADE_GAMECUBE_ORIGIN||'https://localhost:8443';
const rom=process.env.GAMECUBE_TEST_ROM;if(!rom)throw new Error('GAMECUBE_TEST_ROM must name a legally available qualification game.');
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface']});
 const context=await b.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',hasTouch:true,viewport:{width:390,height:844}});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/session.mjs',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('this.scope = scope;','this.scope = scope; globalThis.__session=this;')});});
 await page.route('**/vendor/src/audio.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('this.context = null;','this.context = null; globalThis.__audio=this;')});});
 await page.route('**/content/feeds/combined.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({title:'GameCube Test',categories:[{title:'GameCube',items:[{title:'GameCube hardware test',type:'gamecube',props:{rom:new URL(rom,origin).href}}]}]})}));
 await page.goto(origin+'/play/');await page.locator('.cr-mobile-card').filter({hasText:'GameCube'}).first().waitFor();await page.waitForTimeout(1500);
 const ok=page.getByRole('button',{name:'OK',exact:true});if(await ok.count())await ok.first().click();
 await page.locator('.cr-mobile-card').filter({hasText:'GameCube'}).first().tap();await page.locator('.cr-mobile-card').filter({hasText:'GameCube hardware test'}).tap();
 await page.getByRole('dialog').getByRole('button').filter({hasText:/^\s*PLAY\s*$/}).tap();await page.locator('#webrcade-app-iframe').waitFor();const game=await(await page.locator('#webrcade-app-iframe').elementHandle()).contentFrame();
 console.log('IFRAME',new URL(game.url()).pathname);assert.equal(new URL(game.url()).pathname,'/experimental/gamecube/');
 await game.waitForFunction(()=>__session?.booted,null,{timeout:120000});console.log('LIBRARY PLAY BOOT PASS');
 assert.equal(await game.locator('#launcher').isVisible(),false);assert.equal(await game.locator('#touch').count(),0);assert.equal(await game.locator('#pause').count(),0);
 await game.locator('.kt-pad').waitFor({state:'visible'});await game.locator('.kt-tab').tap();await game.locator('#kt-drawer').waitFor({state:'visible'});console.log('EXISTING DRAWER PASS');
 await game.locator('.kt-gc-pause').tap();await game.waitForFunction(()=>__session.paused);assert.equal(await game.locator('.kt-tab').isVisible(),true);await game.locator('.kt-gc-pause').filter({hasText:'Resume'}).tap();await game.waitForFunction(()=>!__session.paused);console.log('PAUSE RESUME PASS');
 await game.locator('.kt-gc-save').tap();await game.locator('.kt-gc-status').filter({hasText:'State saved.'}).waitFor({timeout:60000});
 await game.locator('.kt-gc-load').tap();await game.locator('.kt-gc-status').filter({hasText:'State loaded.'}).waitFor({timeout:60000});console.log('DRAWER STATE ROUNDTRIP PASS');
 await game.locator('.kt-close').tap();await game.locator('.kt-pad').waitFor({state:'visible'});
  const a=game.locator('.kt-actions [data-cid="4"]'), rect=await a.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.waitForTimeout(200);assert.equal(await game.evaluate(()=>__session.lastInput.mask&1),1);await page.mouse.up();console.log('EXISTING TOUCH INPUT PASS');
 await page.screenshot({path:'/tmp/cloudrcade-gamecube-library.png'});
 await game.locator('.kt-tab').tap();await game.locator('.kt-gc-exit').tap();await page.locator('#webrcade-app-iframe').waitFor({state:'detached',timeout:60000});console.log('LIBRARY EXIT PASS');assert.deepEqual(errors,[]);
 await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
