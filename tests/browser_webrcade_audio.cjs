// Real WebAudio mute/clock and Safari category-loss recovery, isolated browser profiles.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium,webkit}=require('playwright');
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true,executablePath:engine===chromium?process.env.CHROME:process.env.WEBRCADE_TEST_WEBKIT_PATH,args:engine===chromium?['--no-sandbox','--autoplay-policy=no-user-gesture-required']:[]});
 try{for(const mockSession of [false,true]){
 const context=await browser.newContext({hasTouch:true,ignoreHTTPSErrors:true,viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(mock=>{
  window.edges=[];const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(to,...args){edges.push([this,to]);return connect.call(this,to,...args);};
  window.sessionWrites=[];window.nativeCategory='auto';
  if(mock){let type='auto';Object.defineProperty(navigator,'audioSession',{value:{get type(){return type},set type(v){sessionWrites.push(v);if(type!==v){type=v;nativeCategory=v;}}}});}
 },mockSession);
 await page.route('https://audio.test/**',r=>r.fulfill({contentType:'text/html',body:'<html><head></head><body></body></html>'}));
 const script=process.env.AUDIO_ASSET_URL?await (await context.request.get(process.env.AUDIO_ASSET_URL)).text():fs.readFileSync(process.env.AUDIO_CONTROLLER_PATH||require('path').join(__dirname,'../deploy/webrcade/touch/assets/controller.js'),'utf8');
 async function load(){
  await page.goto('https://audio.test/play/app/gb/');
  await page.addStyleTag({content:fs.readFileSync(require('path').join(__dirname,'../deploy/webrcade/touch/assets/controller.css'),'utf8')});
  await page.evaluate(()=>{const controller={isControlDown:()=>false,isPadButtonDown:()=>false,getAxisValue:()=>0,isAxisLeft:()=>false,isAxisRight:()=>false,isAxisUp:()=>false,isAxisDown:()=>false};window.app={isShowOverlay:()=>false,isPauseScreen:()=>false,emulator:{started:true,paused:false,updateScreenSize(){},controllers:{getController:()=>controller}}};});
  await page.addScriptTag({content:script});await page.locator('.kt-pad').waitFor({state:'visible'});
  await page.locator('.kt-tab').click();
  await page.evaluate(async()=>{window.probe=new AudioContext();await probe.resume();window.tone=probe.createOscillator();tone.connect(probe.destination);tone.start();window.gate=edges.find(([s,t])=>t===probe.destination)[0];window.analyser=probe.createAnalyser();gate.connect(analyser);});
 }
 async function level(){await page.waitForTimeout(200);return page.evaluate(()=>{const samples=new Float32Array(2048);analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs));});}
 async function check(muted){await page.waitForTimeout(40);assert.equal(await page.evaluate(()=>gate.gain.value),muted?0:1);assert.equal(await page.evaluate(()=>probe.state),'running');assert.equal(await page.locator('.kt-mute').getAttribute('aria-checked'),String(muted));if(await page.evaluate(()=>!!navigator.audioSession))assert.equal(await page.evaluate(()=>navigator.audioSession.type),muted?'ambient':'playback');const before=await page.evaluate(()=>probe.currentTime),sample=await level();assert(muted?sample===0:sample>.1);assert(await page.evaluate(()=>probe.currentTime)>before,'mute preserves the core audio clock');}
 async function muteClick(){if(!await page.locator('.kt-mute').isVisible())await page.locator('.kt-tab').click();await page.locator('.kt-mute').click();}
 await load();await check(false);
 await muteClick();await check(true);
 await muteClick();await check(false);
 await muteClick();await check(true);
 await page.evaluate(()=>{tone.stop();return probe.close()});await load();await check(true);
 await muteClick();await check(false);
 if(mockSession){
  // Model the WebKit failure: the declared type survives while its native
  // category is lost. Reassigning the same value cannot fix this fixture.
  for(const event of ['focus','pageshow','visibilitychange']){
   await page.evaluate(event=>{nativeCategory='ambient';const target=event==='visibilitychange'?document:window;target.dispatchEvent(new Event(event));},event);
   await page.waitForFunction(()=>nativeCategory==='playback',null,{timeout:3000});
   await check(false);
  }
  await page.evaluate(async()=>{await probe.suspend();nativeCategory='ambient';await probe.resume();});
  await page.waitForFunction(()=>nativeCategory==='playback',null,{timeout:3000});await check(false);
  const writes=await page.evaluate(()=>sessionWrites.length);
  await page.evaluate(()=>{for(let i=0;i<30;i++)document.dispatchEvent(new PointerEvent('pointerdown'));});
  assert.equal(await page.evaluate(()=>sessionWrites.length),writes,'ordinary game input never cycles the audio category');
  // A mute that races an asynchronous reset must stay silent and ambient.
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.querySelector('.kt-mute').click();});
  await check(true);assert.equal(await page.evaluate(()=>nativeCategory),'ambient');
  await muteClick();await check(false);
 }
 await page.evaluate(()=>{tone.stop();return probe.close()});assert.deepEqual(errors,[]);
 console.log('PASS',engine.name(),mockSession?'mock session API':'native API/fallback','real waveform/gain/clock, saved mute, foreground/context-resume stale-category repair and coalesced input');
 await context.close();
 }}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
