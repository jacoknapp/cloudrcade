/* Native mobile library -> details -> Play regression, using a homebrew fixture.
 * WEBRCADE_TEST_ORIGIN=https://localhost:8443 PSP_TEST_ROM=/content/sprite.pbp
 * NODE_PATH=<Playwright modules> node tests/browser_webrcade_psp_launch.cjs
 * No operator account, library preferences or cloud saves are changed.
 */
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://localhost:8443';
const rom=process.env.PSP_TEST_ROM;
if(!rom)throw new Error('PSP_TEST_ROM must name a test game URL.');
const config={appName:'PSP Launch Test',storagePrefix:'psp_launch_test',enabled:false,
  autoRedirect:false,enable3DS:true,feedUrl:'/content/feeds/combined.json'};
const feed={title:'PSP launch fixture',categories:[{title:'PSP',items:[{
  title:'PSP homebrew',type:'psp',props:{rom:new URL(rom,origin).href},
}]}]};
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,...(engine===chromium?{
   executablePath:process.env.CHROME,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  }:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
  try{
   const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',
    hasTouch:true,viewport:{width:390,height:844}});
   await context.addInitScript(()=>localStorage.setItem('psp_launch_test.psp.enabled.v1','1'));
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.stack));
   page.on('console',m=>{if(m.type()==='error'&&m.text().includes('absoluteKey'))errors.push(m.text());});
   await page.route('**/cloud-saves/config.php',r=>r.fulfill({contentType:'application/javascript',
    body:'window.WrcadCloudConfig='+JSON.stringify(config)+';'}));
   await page.route('**/content/feeds/combined.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(feed)}));
   await page.goto(origin+'/play/');
   await page.locator('.cr-mobile-card').filter({hasText:'PSP'}).waitFor();
   await page.waitForTimeout(1500);
   const ok=page.getByRole('button',{name:'OK',exact:true});if(await ok.count())await ok.first().click();
   await page.locator('.cr-mobile-card').filter({hasText:'PSP'}).first().tap();
   await page.locator('.cr-mobile-card').filter({hasText:'PSP homebrew'}).tap();
   await page.getByRole('dialog').getByRole('button').filter({hasText:/^\s*PLAY\s*$/}).tap();
   await page.locator('#webrcade-app-iframe').waitFor();
   const game=await(await page.locator('#webrcade-app-iframe').elementHandle()).contentFrame();
   const url=new URL(game.url());
   const props=JSON.parse(decodeURIComponent(Buffer.from(url.searchParams.get('props'),'base64').toString()));
   assert.equal(props.type,'retro-ppsspp','library passes the canonical core key');
   await game.waitForFunction(()=>window.emulator?.mainStarted&&window.Module?._get_current_frame_count()>120,null,{timeout:180000});
   assert(!(await game.locator('body').innerText()).includes('Whoops, something went wrong'));
   assert.equal(errors.length,0,errors.join('\n'));
   await page.screenshot({path:'/tmp/cloudrcade-psp-library-launch-'+engine.name()+'.png'});
   await game.evaluate(async()=>{emulator.pause(true);await app.onPreExit();});
   assert.equal(await game.evaluate(()=>Module.PThread.runningWorkers.length+Module.PThread.unusedWorkers.length),0);
   console.log('PASS',engine.name(),'native mobile PSP category/details/Play, canonical type, real frames and cleanup');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
