/* Device-GPU native library -> GameCube -> shared native pause menu regression.
 * Requires a packaged beta image and GAMECUBE_TEST_ROM URL; no accounts or
 * operator preferences are modified. Software adapters are rejected by the app.
 * Uses a fresh browser profile and read-only disc requests.
 */
const assert=require('node:assert/strict'),fs=require('node:fs');const{chromium}=require('playwright');
const origin=process.env.WEBRCADE_GAMECUBE_ORIGIN||'https://localhost:8443';
const rom=process.env.GAMECUBE_TEST_ROM;if(!rom)throw new Error('GAMECUBE_TEST_ROM must name a legally available qualification game.');
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface']});
 const context=await b.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',hasTouch:true,viewport:{width:390,height:844}});
 await context.addInitScript(()=>{let config;Object.defineProperty(window,'WrcadCloudConfig',{configurable:true,get:()=>config,set(value){config={...value,enabled:false,autoRedirect:false,storagePrefix:'gamecube_standard_menu_test'};}});});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/session.mjs',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('this.scope = scope;','this.scope = scope; globalThis.__session=this;')});});
 await page.route('**/vendor/src/audio.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('this.context = null;','this.context = null; globalThis.__audio=this;')});});
 await page.route('**/content/feeds/combined.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({title:'GameCube Test',categories:[{title:'GameCube',items:[{title:'GameCube hardware test',type:'gamecube',props:{rom:new URL(rom,origin).href}}]}]})}));
 await page.goto(origin+'/play/');await page.locator('.cr-mobile-card').filter({hasText:'GameCube'}).first().waitFor();await page.waitForTimeout(1500);
 const ok=page.getByRole('button',{name:'OK',exact:true});if(await ok.count())await ok.first().click();
 await page.locator('.cr-mobile-card').filter({hasText:'GameCube'}).first().tap();await page.locator('.cr-mobile-card').filter({hasText:'GameCube hardware test'}).tap();
 await page.getByRole('dialog').getByRole('button').filter({hasText:/^\s*PLAY\s*$/}).tap();await page.locator('#webrcade-app-iframe').waitFor();const game=await(await page.locator('#webrcade-app-iframe').elementHandle()).contentFrame();
 console.log('IFRAME',new URL(game.url()).pathname);assert.equal(new URL(game.url()).pathname,'/experimental/gamecube/');
 await game.waitForFunction(()=>globalThis.__session?.booted,null,{timeout:120000});console.log('LIBRARY PLAY BOOT PASS');
 assert.equal(await game.locator('#launcher').isVisible(),false);assert.equal(await game.locator('#touch').count(),0);assert.equal(await game.locator('#pause').count(),0);
 await game.locator('.kt-pad').waitFor({state:'visible'});
 await game.locator('#gamecube-perf').filter({hasText:/core fps/}).waitFor({timeout:60000});
 await game.locator('.kt-tab').tap();assert.equal(await game.locator('#kt-drawer .kt-gc-save').count(),0,'controller settings contain no core actions');await game.locator('.kt-close').tap();
 async function menu(){await game.locator('.kt-menu').tap();await game.getByRole('button',{name:/^Resume/}).waitFor();await game.waitForFunction(()=>__session.paused);}
 await menu();await game.locator('#gamecube-perf').filter({hasText:'GameCube paused'}).waitFor();await game.waitForFunction(()=>document.getElementById('wrcad-touch').hidden);assert.equal(await game.locator('.kt-tab').isVisible(),false);
 const stopped=await game.evaluate(async()=>(await __session.adapter.request('runFrame')).frame);await page.waitForTimeout(700);
 assert.equal(await game.evaluate(async()=>(await __session.adapter.request('runFrame')).frame),stopped,'standard menu really stops emulation');
 await page.screenshot({path:process.env.GAMECUBE_PAUSE_SCREENSHOT||'/tmp/cloudrcade-gamecube-pause.png'});
 console.log('STANDARD NATIVE PAUSE MENU AND STOPPED CORE PASS');
 await game.getByRole('button',{name:/^Resume/}).tap();await game.waitForFunction(()=>!__session.paused&&!app.isPauseScreen());
 await game.locator('.kt-pad').waitFor({state:'visible'});
 await game.waitForFunction(()=>Number(document.querySelector('#gamecube-perf')?.textContent.match(/GameCube ([\d.]+) core fps/)?.[1])>0,null,{timeout:60000});
 await game.waitForFunction(()=>__audio.context?.state==='running'&&__audio.activeTransport==='worklet'&&__audio.workletRing?.samples.some(n=>n!==0),null,{timeout:60000});console.log('NONZERO AUDIOWORKLET PCM PASS');
 await menu();await game.getByRole('button',{name:/^Save States/i}).tap();await game.getByText('Save Slot 1',{exact:true}).waitFor();
 await game.getByRole('button').filter({has:game.getByText('Save',{exact:true})}).tap();await game.waitForFunction(()=>WrcadGameCube.status==='State saved.'&&!app.isPauseScreen(),null,{timeout:60000});
 await game.locator('.kt-pad').waitFor({state:'visible'});await menu();await game.getByRole('button',{name:/^Save States/i}).tap();
 await game.getByRole('button').filter({has:game.getByText('Load',{exact:true})}).tap();await game.waitForFunction(()=>WrcadGameCube.status==='State loaded.'&&!app.isPauseScreen(),null,{timeout:60000});
 const restored=await game.evaluate(()=>__session.adapter.request('runFrame')),deadline=Date.now()+60000;
 for(;;){const frame=await game.evaluate(()=>__session.adapter.request('runFrame'));if(frame.frame>=restored.frame+30)break;if(Date.now()>deadline)throw new Error('Loaded state did not resume native frames');await page.waitForTimeout(250);}
 console.log('STANDARD SAVE SLOT EDITOR STATE ROUNDTRIP PASS');await game.locator('.kt-pad').waitFor({state:'visible'});
  const a=game.locator('.kt-actions [data-cid="4"]'), rect=await a.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.waitForTimeout(200);assert.equal(await game.evaluate(()=>__session.lastInput.mask&1),1);await page.mouse.up();console.log('EXISTING TOUCH INPUT PASS');
 const stream=await game.evaluate(async()=>(await __session.adapter.request('streamStats')).stream);
 assert(stream&&stream.chunkSize===2*1024*1024&&stream.cachedChunks<=8&&stream.cachedBytes<=16*1024*1024&&stream.requests>0&&!stream.fileContentsBuffered);console.log('BOUNDED DISC STREAM',JSON.stringify(stream));
 await page.screenshot({path:process.env.GAMECUBE_LIBRARY_SCREENSHOT||'/tmp/cloudrcade-gamecube-library.png'});
 await menu();await game.getByRole('button',{name:/^Return to Browse/i}).tap();await page.locator('#webrcade-app-iframe').waitFor({state:'detached',timeout:60000});console.log('LIBRARY EXIT PASS');assert.deepEqual(errors,[]);
 await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
