// Source drawer contract in Chromium/WebKit; isolated storage, no games/accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const source=fs.readFileSync(path.resolve(__dirname,'../deploy/webrcade/retro-dolphin/app/frame-skip.mjs'),'utf8');
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({...(engine===webkit?{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH}:{}),args:engine===chromium?['--no-sandbox']:[]});
  try{
   const c=await browser.newContext(),p=await c.newPage();
   await p.route('https://frameskip.test/**',r=>r.fulfill({contentType:r.request().url().endsWith('.mjs')?'text/javascript':'text/html',body:r.request().url().endsWith('.mjs')?source:'<html data-cloudrcade-core="gamecube"><body></body></html>'}));
   await p.goto('https://frameskip.test/');
   const setup=async system=>p.evaluate(async system=>{
    document.body.innerHTML='';document.documentElement.dataset.cloudrcadeCore=system;
    window.WrcadCloudConfig={storagePrefix:'skip-test'};window.calls=[];
    const {createFrameSkipControl}=await import('/frame-skip.mjs');
    window.control=createFrameSkipControl(window,{onChange:async value=>{calls.push(value);await new Promise(r=>setTimeout(r,30));if(window.rejectSkip)throw Error('fixture request failed');}});
    document.body.innerHTML='<section id="kt-drawer"><button class="kt-edit">Edit</button></section>';
   },system);
   await setup('gamecube');const select=p.getByRole('combobox',{name:'Frame skip'});
   assert.equal(await select.inputValue(),'1');
   assert.deepEqual(await select.locator('option').allTextContents(),['Off','2×','3×','4×']);
   assert.equal(await p.locator('#kt-drawer .gc-frame-skip').count(),1);
   await select.selectOption('4');await select.waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('select').disabled);
   assert.equal(await p.evaluate(()=>control.value),4);assert.equal(await p.evaluate(()=>localStorage.getItem('skip-test.gamecube.frameSkip.v1')),'4');
   await setup('wii');assert.equal(await select.inputValue(),'1','Wii does not inherit the GameCube preference');
   await select.selectOption('2');await p.waitForFunction(()=>!document.querySelector('select').disabled);
   await setup('gamecube');assert.equal(await select.inputValue(),'4','preference restored on relaunch');
   await p.evaluate(()=>window.rejectSkip=true);await select.selectOption('1');await p.waitForFunction(()=>!document.querySelector('select').disabled);
   assert.equal(await select.inputValue(),'4','failed worker change keeps the previous preference');
   assert.equal(await p.evaluate(()=>control.value),4);
   await p.evaluate(()=>window.rejectSkip=false);await select.selectOption('1');await p.waitForFunction(()=>!document.querySelector('select').disabled);
   assert.equal(await p.evaluate(()=>control.value),1);
   console.log('PASS',engine.name(),'frame skip drawer, Off/2×/3×/4×, per-core persistence, late mount and failed-request recovery');
   await c.close();
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
