// Packaged native settings, with isolated profiles and no game/account writes.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://localhost:8443';
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({args:engine===chromium?['--no-sandbox']:[]});
  try{
   for(const available of [false,true]){
    const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:390,height:844}});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/cloud-saves/config.php',r=>r.fulfill({contentType:'application/javascript',body:
     'window.WrcadCloudConfig='+JSON.stringify({enabled:false,autoRedirect:false,enable3DS:true,
      gamecubePrototypeUrl:available?'/experimental/gamecube/':null,feedUrl:'/content/feeds/combined.json'})+';'}));
    await page.route('**/content/feeds/combined.json',r=>r.fulfill({json:{title:'Settings test',categories:[{title:'NES',items:[{title:'Fixture',type:'nes',props:{rom:'/fixture.nes'}}]}]}}));
    async function open(){
     await page.goto(origin+'/play/');await page.waitForTimeout(2000);
     const ok=page.getByRole('button',{name:'OK',exact:true});if(await ok.count())await ok.first().click();
     await page.locator('.header-nav-right button').last().click();
     for(let i=0;i<5;i++)await page.locator('button._17LMl').nth(1).click();
     await page.getByText('3DS performance readout',{exact:true}).waitFor();
     await page.waitForFunction(()=>{const e=document.querySelector('._1OdS7');return !e||+getComputedStyle(e).opacity>.95;});
    }
    await open();
    const gc=page.getByText('GameCube performance readout',{exact:true});assert.equal(await gc.count(),available?1:0);
    if(available){
     const row=gc.locator('..');assert(await row.locator('input').isChecked(),'built-in monitor starts enabled');
     await row.locator('label').click();assert.equal(await row.locator('input').isChecked(),false);
     await open();assert.equal(await gc.locator('..').locator('input').isChecked(),false,'off persists after reload');
     await gc.locator('..').locator('label').click();assert(await gc.locator('..').locator('input').isChecked());
     assert.equal(await page.evaluate(()=>localStorage.getItem('wrcad.3ds.perf.v1')),null,'GameCube toggle does not alter 3DS');
    }
    assert.deepEqual(errors,[]);await context.close();console.log('PASS',engine.name(),'native GameCube settings availability:',available,'default, persistence and 3DS isolation');
   }
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
