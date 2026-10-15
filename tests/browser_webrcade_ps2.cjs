/* Actual Play! WASM/GL lifecycle using original homebrew or an owned game.
 * PS2_TEST_ROM=/content/cloudrcade.iso WEBRCADE_TEST_ORIGIN=https://localhost:8443
 * WEBRCADE_TEST_BROWSER=webkit uses an isolated persistent profile for Blob IDB.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://localhost:8443',rom=process.env.PS2_TEST_ROM;
if(!rom)throw new Error('PS2_TEST_ROM must identify an original homebrew or operator-owned game.');
const engine=process.env.WEBRCADE_TEST_BROWSER==='webkit'?webkit:chromium;
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cloudrcade-ps2-browser-'));
 const context=await engine.launchPersistentContext(profile,{headless:true,ignoreHTTPSErrors:true,serviceWorkers:'block',hasTouch:true,viewport:{width:390,height:844},
  ...(engine===chromium?{executablePath:process.env.CHROME,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
 const page=await context.newPage(),errors=[],logs=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{logs.push(message.text());if(process.env.PS2_TEST_DEBUG)console.log(message.type(),message.text());});
 const prefix=process.env.PS2_TEST_PREFIX||'cloudrcade';
 await context.addInitScript(namespace=>{localStorage.setItem(namespace+'.ps2.enabled.v1','1');localStorage.setItem(namespace+'.ps2.perf.v1','1');},prefix);
 const props={title:'PS2 qualification fixture',type:'play-ps2',rom:new URL(rom,origin).href,uid:'ps2-browser-qualification'};
 const url=origin+'/experimental/ps2/?ctx=standalone&props='+encodeURIComponent(Buffer.from(encodeURIComponent(JSON.stringify(props))).toString('base64'));
 async function loaded(){
  await page.waitForFunction(()=>window.WrcadPS2?.ready||!document.getElementById('failure').hidden,null,{timeout:120000});
  assert(await page.evaluate(()=>WrcadPS2.ready),await page.locator('#failure-detail').innerText());
  await page.waitForFunction(minimum=>WrcadPS2.module.getFrames()>minimum,Number(process.env.PS2_TEST_MIN_FRAMES||30),{timeout:120000});
 }
 try{
  await page.goto(url);await loaded();await page.locator('.kt-pad').waitFor({state:'visible'});
  if(process.env.PS2_TEST_WARMUP_MS)await page.waitForTimeout(Number(process.env.PS2_TEST_WARMUP_MS));
  const before=await page.locator('#outputCanvas').screenshot();await page.waitForTimeout(800);const after=await page.locator('#outputCanvas').screenshot();
  if(!process.env.PS2_TEST_SKIP_PIXEL_CHANGE)assert(!before.equals(after),'native homebrew pixels advance, not just a frame counter');
  const resources=await page.evaluate(()=>({frames:WrcadPS2.module.getFrames(),heap:WrcadPS2.module.HEAPU8.length,workers:WrcadPS2.module.PThread.runningWorkers.length+WrcadPS2.module.PThread.unusedWorkers.length,audio:WrcadPS2.module.cloudAudio()?.state,cache:WrcadPS2.disc.cachedBytes||0,transferred:WrcadPS2.disc.transferred||0,size:WrcadPS2.disc.size}));
  assert(resources.workers<=8);assert(resources.heap<1024**3);assert(resources.cache<=16*1024**2);
  if(rom.endsWith('.iso'))assert(resources.transferred<resources.size/2,'disc boot streams without whole-disc MEMFS');
  assert(await page.locator('.kt-analog-left').isVisible());assert(await page.locator('.kt-analog-right').isVisible());
  for(const cid of [10,11,16,17])assert(await page.locator(`[data-cid="${cid}"]`).isVisible());
  const geometry=await page.evaluate(()=>{const r=document.getElementById('outputCanvas').getBoundingClientRect(),p=document.querySelector('.kt-pad').getBoundingClientRect();return{bottom:r.bottom,padTop:p.top};});
  assert(geometry.bottom<geometry.padTop,'portrait picture clears the default controls');
  await page.locator('#ps2-performance').waitFor({state:'visible'});await page.waitForFunction(()=>document.getElementById('ps2-performance').textContent.includes('FPS'));
  await page.setViewportSize({width:844,height:390});await page.waitForTimeout(250);await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{window.ps2Inputs=[];const original=WrcadPS2.module.setInput;WrcadPS2.module.setInput=(...args)=>{ps2Inputs.push(args);original(...args);};});
  const stick=await page.locator('.kt-analog-right').boundingBox();await page.mouse.move(stick.x+stick.width*.8,stick.y+stick.height*.5);await page.mouse.down();await page.waitForTimeout(200);await page.mouse.up();
  assert(await page.evaluate(()=>ps2Inputs.some(input=>input[4]>180)),'right stick reaches native input');
  await page.locator('.kt-menu').tap();await page.waitForFunction(()=>app.isPauseScreen()&&app.emulator.paused);await page.waitForTimeout(300);
  const frozen=await page.evaluate(()=>WrcadPS2.module.getFrames());await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>WrcadPS2.module.getFrames()),frozen,'acknowledged pause stops native frames');
  await page.evaluate(async()=>{const FS=WrcadPS2.module.FS;FS.mkdirTree('/cloudrcade/cards/mc0/qualification');FS.writeFile('/cloudrcade/cards/mc0/qualification/marker.bin',new Uint8Array([12,34,56]));await WrcadPS2.saves.cards();});
  await page.evaluate(()=>WrcadPS2.saveState(1));assert(await page.evaluate(async()=>!!(await WrcadPS2.saves.slots())[1]));await page.evaluate(()=>WrcadPS2.loadState(1));
  await page.evaluate(()=>WrcadPS2.hideMenu());await page.waitForTimeout(300);assert((await page.evaluate(()=>WrcadPS2.module.getFrames()))>frozen);
  await page.evaluate(()=>dispatchEvent(new Event('blur')));await page.waitForFunction(()=>app.emulator.paused);await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.waitForFunction(()=>!app.emulator.paused);
  const screenshot=process.env.PS2_TEST_SCREENSHOT||path.join(os.tmpdir(),'cloudrcade-ps2-'+engine.name()+'.png');await page.screenshot({path:screenshot});
  await page.evaluate(async()=>{window.ownedPs2Module=WrcadPS2.module;window.ownedPs2Audio=ownedPs2Module.cloudAudio();await WrcadPS2.exit({leave:false});});
  assert(await page.evaluate(()=>!WrcadPS2.ready&&ownedPs2Module.PThread.runningWorkers.length===0&&ownedPs2Module.PThread.unusedWorkers.length===0));
  assert.equal(await page.evaluate(()=>ownedPs2Audio.state),'closed');
  await page.goto(url);await loaded();assert.deepEqual(await page.evaluate(()=>Array.from(WrcadPS2.module.FS.readFile('/cloudrcade/cards/mc0/qualification/marker.bin'))),[12,34,56]);
  await page.evaluate(()=>WrcadPS2.exit({leave:false}));assert.deepEqual(errors,[]);
  console.log('PASS PS2 '+engine.name()+' real native rendered pixels, streamed disc, DualShock, rotation, pause/resume, state roundtrip, card reload, background and disposal',JSON.stringify(resources));
 }catch(error){console.error(logs.slice(-30).join('\n'));
  console.error('Native status',await page.evaluate(()=>({ready:WrcadPS2?.ready,frames:WrcadPS2?.module?.getFrames(),video:WrcadPS2?.module?.getVideoFrames(),native:WrcadPS2?.module?.getNativeFrames(),cached:WrcadPS2?.disc?.cachedBytes,transferred:WrcadPS2?.disc?.transferred})).catch(()=>null));
  await page.screenshot({path:process.env.PS2_TEST_SCREENSHOT||path.join(os.tmpdir(),'cloudrcade-ps2-failed-'+engine.name()+'.png')}).catch(()=>{});throw error;
 }
 finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
