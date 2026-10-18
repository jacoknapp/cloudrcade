// Isolated layout/menu contract in both browser engines; no core or saves.
const {chromium,webkit}=require('playwright');const fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{for(const engine of[chromium,webkit]){
 const browser=await engine.launch({args:engine===chromium?['--no-sandbox']:[],executablePath:engine===chromium?process.env.CHROME:process.env.WEBRCADE_TEST_WEBKIT_PATH});
 try{
  const context=await browser.newContext({hasTouch:true,viewport:{width:390,height:844}});const page=await context.newPage();
  await page.route('http://controller.test/**',r=>r.fulfill({contentType:'text/html',body:'<html><head></head><body></body></html>'}));await page.goto('http://controller.test/experimental/wii/');
  const gameHtml=fs.readFileSync(path.join(__dirname,'../deploy/webrcade/retro-dolphin/app/index.html'),'utf8');
  await page.addStyleTag({content:gameHtml.match(/<style>([\s\S]*?)<\/style>/)[1]});
  await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'../deploy/webrcade/touch/assets/controller.css'),'utf8')});
  await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.id='screen';canvas.tabIndex=0;document.body.append(canvas);canvas.focus();});
  assert.equal(await page.locator('#screen').evaluate(e=>getComputedStyle(e).outlineStyle),'none','focused video has no browser frame');
  await page.evaluate(()=>{const controller={isControlDown:()=>false,isPadButtonDown:()=>false,getAxisValue:()=>0,isAxisLeft:()=>false,isAxisRight:()=>false,isAxisUp:()=>false,isAxisDown:()=>false};window.app={pauseScreen:false,menus:0,isShowOverlay:()=>false,isPauseScreen(){return this.pauseScreen;},emulator:{started:true,paused:false,updateScreenSize(){},controllers:{getController:()=>controller},pause(value){this.paused=value;return true;},showPauseMenu(){app.pauseScreen=true;app.menus++;}}};window.WrcadWii={menuOpen(){}};});
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../deploy/webrcade/touch/assets/controller.js'),'utf8')});
  await page.locator('.kt-pad').waitFor({state:'visible'});assert.equal(await page.locator('#wrcad-touch.kt-3ds').count(),0,'GameCube has independent geometry');
  assert.equal(await page.locator('.kt-shoulders [data-cid="12"]').textContent(),'−');
  assert.equal(await page.locator('#wrcad-touch.kt-gamecube').count(),0,'Wii has its own controller class');
  assert.equal(await page.locator('#wrcad-touch.kt-wii').count(),1);
  assert.equal(await page.locator('.kt-c-stick').count(),0,'Nunchuk uses one stick');
  assert.equal(await page.locator('[data-cid="10"]').textContent(),'Home');
  for(const viewport of[{width:320,height:568},{width:390,height:844},{width:430,height:932},{width:568,height:320},{width:844,height:390}]){
   await page.setViewportSize(viewport);await page.waitForTimeout(200);
   const edge=await page.locator('.kt-tab').boundingBox();
   assert(Math.abs(edge.x+edge.width-viewport.width)<1,'closed settings tab attaches to right viewport edge');
   const rectangles=await page.locator('.kt-pad button,.kt-stick').evaluateAll(elements=>elements.filter(e=>!e.hidden&&e.getBoundingClientRect().width).map(e=>{const r=e.getBoundingClientRect();return{id:e.dataset.layoutId,x:r.x,y:r.y,width:r.width,height:r.height};}));
   for(const rect of rectangles)assert(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=viewport.width+.1&&rect.y+rect.height<=viewport.height+.1,JSON.stringify({viewport,rect}));
   for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++){
    const a=rectangles[i],b=rectangles[j];assert(!(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y),JSON.stringify({viewport,a,b}));
   }
   const button=id=>rectangles.find(r=>r.id==='button-'+id),a=button(4),b=button(5),x=button(6),y=button(7);
   assert(a.width>b.width&&b.x>a.x&&b.y>a.y&&x.y<a.y&&y.y<a.y,'Wii A/B and separate 1/2 geometry');
  }
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  if(process.env.WEBRCADE_WII_SCREENSHOT)await page.screenshot({path:process.env.WEBRCADE_WII_SCREENSHOT+'-'+engine.name()+'.png'});
  const saved={'wii:portrait':{'button-4':[.72,.45],dock:[0,.25]},'psp:portrait':{'button-4':[.4,.6]},'gamecube:portrait':{'button-4':[.8,.7]}};
  await page.evaluate(saved=>{const key='webrcade.touch.layouts.v1';localStorage.setItem(key,JSON.stringify(saved));dispatchEvent(new StorageEvent('storage',{key}));},saved);
  const restored=await page.locator('.kt-actions [data-cid="4"]').boundingBox();assert(Math.abs(restored.x+restored.width/2-390*.72)<1&&Math.abs(restored.y+restored.height/2-844*.45)<1,'saved per-system coordinates still apply');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('webrcade.touch.layouts.v1'))),saved,'default redesign does not rewrite saved layouts');
  await page.locator('.kt-tab').tap();assert.equal(await page.locator('#kt-drawer .kt-gc-save').count(),0);await page.locator('.kt-close').tap();
  const leftEdge=await page.locator('.kt-tab').boundingBox();assert(Math.abs(leftEdge.x)<1,'saved left dock stays attached to left edge');
  await page.locator('.kt-menu').tap();await page.waitForFunction(()=>app.menus===1&&app.emulator.paused);await page.waitForFunction(()=>document.querySelector('#wrcad-touch').hidden);assert.equal(await page.locator('.kt-tab').isVisible(),false,'standard pause hides controller settings');
  console.log('PASS',engine.name(),'Wii own Remote/Nunchuk geometry, independent layouts, small/portrait/landscape bounds and standard Menu contract');
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
