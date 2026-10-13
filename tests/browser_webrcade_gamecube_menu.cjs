// The compiled shared pause/slot UI with an isolated save adapter in both engines.
// No core, ROM, operator account, or claim of GPU gameplay.
const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../deploy/webrcade');
const bundle=process.env.WEBRCADE_GAMECUBE_UI_ROOT||path.resolve(__dirname,'../release/gamecube/app');
(async()=>{for(const engine of[chromium,webkit]){
 const browser=await engine.launch({executablePath:engine===chromium?process.env.CHROME:process.env.WEBRCADE_TEST_WEBKIT_PATH,args:engine===chromium?['--no-sandbox']:[]});
 try{
  const context=await browser.newContext({hasTouch:true,viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const style=fs.readFileSync(path.join(root,'retro-dolphin/app/index.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
  await page.route('http://menu.test/**',route=>{
   const name=new URL(route.request().url()).pathname.slice(1);
   if(['pause-ui.mjs','pause-ui.css'].includes(name))return route.fulfill({contentType:name.endsWith('.mjs')?'text/javascript':'text/css',body:fs.readFileSync(path.join(bundle,name))});
   if(['saves.mjs','save-feedback.mjs'].includes(name))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'retro-dolphin/app',name))});
   if(name==='menus.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(root,'touch/assets/menus.css'))});
   if(name==='gamecube.svg')return route.fulfill({contentType:'image/svg+xml',body:fs.readFileSync(path.join(root,'retro-dolphin/app/gamecube.svg'))});
   return route.fulfill({contentType:'text/html',body:`<html class="gc-paused-menu"><head><link rel="stylesheet" href="pause-ui.css"><link rel="stylesheet" href="menus.css"><style>${style}</style></head><body><div id="gamecube-menu" hidden></div></body></html>`});
  });
  await page.goto('http://menu.test/');
  await page.evaluate(async()=>{
   const {createPauseMenu}=await import('/pause-ui.mjs');window.calls={resume:0,exit:0,save:[],load:[],delete:[]};window.fail='';window.pad=[];window.uploading=false;window.saveListeners=new Set();
   Object.defineProperty(navigator,'getGamepads',{value:()=>pad});
   const slots=()=>JSON.parse(localStorage.getItem('test-slots')||'[]');
   const emulator={subscribeSaves:fn=>{saveListeners.add(fn);return()=>saveListeners.delete(fn);},isSaveBusy:()=>uploading,getSaveStatus:()=>uploading?'Uploading memory cards…':'Memory cards saved locally; cloud upload needs attention.',getPerformance:()=> 'Disc wait: 2.0 ms/s\nPresentation: 30 frames/s · limit 60',async getStateSlots(){return slots();},async saveStateForSlot(slot){calls.save.push(slot);if(fail)throw new Error(fail);const states=slots();states[slot]={time:Date.now(),shot:'gamecube.svg'};localStorage.setItem('test-slots',JSON.stringify(states));},async loadStateForSlot(slot){calls.load.push(slot);if(fail)throw new Error(fail);},async deleteStateForSlot(slot){calls.delete.push(slot);if(fail)throw new Error(fail);const states=slots();states[slot]=null;localStorage.setItem('test-slots',JSON.stringify(states));},async exit(){calls.exit++;if(fail)throw new Error(fail);}};
   window.menu=createPauseMenu({root:document.querySelector('#gamecube-menu'),appProps:{title:'Sunshine UI fixture',app:'GameCube'},emulator,onResume(){calls.resume++;menu.hide();},onPause(){menu.show();}});menu.show();
  });
  const action=name=>page.getByRole('button').filter({has:page.getByText(name,{exact:true})});
  const states=async()=>{await action('Save States').tap();await page.getByText('Save Slot 1',{exact:true}).waitFor();};
  await page.getByText('Sunshine UI fixture',{exact:true}).waitFor();
  await page.getByRole('status').filter({hasText:'cloud upload needs attention'}).waitFor();
  await page.evaluate(()=>{uploading=true;for(const fn of saveListeners)fn();if(!document.querySelector('#gamecube-menu-sync[aria-busy="true"]'))throw new Error('Save event did not update immediately');});
  await page.locator('#gamecube-menu-sync[aria-busy="true"] .gc-save-spinner').waitFor();
  assert.equal(await page.locator('.gc-save-spinner').evaluate(e=>getComputedStyle(e).animationName),'gc-save-spin');
  assert.equal(await page.locator('#gamecube-menu-sync').evaluate(e=>{
    const previous=e.style.pointerEvents;e.style.pointerEvents='auto';
    const r=e.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    e.style.pointerEvents=previous;return e===top||e.contains(top);
  }),true,'upload feedback is painted above the opaque native pause screen');
  await page.getByRole('status').filter({hasText:'Uploading memory cards'}).waitFor();
  await page.evaluate(()=>uploading=false);await page.locator('.gc-save-spinner').waitFor({state:'hidden'});
  await action('Performance').tap();await page.getByRole('region',{name:'GameCube performance details'}).waitFor();
  await page.getByText(/Disc wait: 2.0/).waitFor();await page.getByRole('button',{name:'Back to menu'}).tap();
  await page.getByText('Sunshine UI fixture',{exact:true}).waitFor();
  await page.keyboard.press('Escape');await page.waitForFunction(()=>calls.resume===1&&!menu.open);
  // Same shared gamepad pause chord (left trigger + Start), on release.
  await page.waitForTimeout(200);await page.evaluate(()=>{pad=[{mapping:'standard',connected:true,buttons:Array.from({length:17},()=>({pressed:false})),axes:[0,0,0,0]}];});
  await page.waitForTimeout(200);await page.evaluate(()=>{pad[0].buttons[6].pressed=pad[0].buttons[9].pressed=true;});await page.waitForTimeout(200);
  await page.evaluate(()=>{pad[0].buttons[6].pressed=pad[0].buttons[9].pressed=false;});await page.waitForFunction(()=>menu.open);
  await states();await page.evaluate(()=>fail='Synthetic storage failure');await action('Save').tap();
  await page.getByRole('alert').filter({hasText:'Synthetic storage failure'}).waitFor();assert.equal(await page.evaluate(()=>calls.resume),1,'failed save remains paused');
  await page.evaluate(()=>fail='');await action('Save').tap();await page.waitForFunction(()=>calls.resume===2&&!menu.open);
  await page.evaluate(()=>menu.show());await states();await action('Load').waitFor();
  await page.evaluate(()=>fail='Synthetic load failure');await action('Load').tap();await page.getByRole('alert').filter({hasText:'Synthetic load failure'}).waitFor();assert.equal(await page.evaluate(()=>calls.resume),2);
  await page.evaluate(()=>fail='');await action('Load').tap();await page.waitForFunction(()=>calls.resume===3&&!menu.open);
  await page.evaluate(()=>menu.show());await states();await action('Delete').tap();await action('Load').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>menu.open),true,'delete stays in the native slot editor');
  assert.deepEqual(await page.evaluate(()=>[calls.save,calls.load,calls.delete]),[[1,1],[1,1],[1]]);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>calls.resume===4&&!menu.open);
  await page.evaluate(()=>menu.show());await page.evaluate(()=>fail='Synthetic exit failure');await action('Return to Browse').tap();
  await page.getByRole('alert').filter({hasText:'Synthetic exit failure'}).waitFor();assert.equal(await page.evaluate(()=>menu.open),true);
  await page.evaluate(async()=>{
    menu.hide();document.documentElement.classList.remove('gc-paused-menu');
    const {GameCubeSaves}=await import('/saves.mjs'),{saveFeedback}=await import('/save-feedback.mjs');
    const node=document.createElement('p');node.id='gamecube-save-toast';node.innerHTML='<span class="gc-save-spinner"></span><span data-save-message></span>';document.body.append(node);
    window.autoSaves=new GameCubeSaves('test',{});autoSaves.cardPath='fixture';
    autoSaves.manager={isCloudEnabled:async()=>true,save:()=>new Promise(resolve=>window.finishUpload=resolve)};
    window.disposeFeedback=saveFeedback(node,autoSaves);
    window.upload=autoSaves.cards({request:async()=>({files:[]})});
  });
  await page.locator('#gamecube-save-toast[aria-busy="true"] .gc-save-spinner').waitFor();
  await page.getByText('Uploading memory cards…',{exact:true}).waitFor();
  await page.evaluate(async()=>{finishUpload(true);await upload;});
  await page.getByText('Memory cards uploaded to cloud.',{exact:true}).waitFor();
  await page.locator('#gamecube-save-toast .gc-save-spinner').waitFor({state:'hidden'});
  await page.evaluate(()=>disposeFeedback());await page.locator('#gamecube-save-toast').waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);await page.evaluate(()=>menu.dispose());await context.close();
  console.log('PASS',engine.name(),'shared pause, keyboard/gamepad chord, slot save/load/delete and recoverable errors');
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
