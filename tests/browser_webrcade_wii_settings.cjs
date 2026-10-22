// Actual patched library and launcher; isolated synthetic feed, no operator data.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://127.0.0.1:18573';
const findBrowse=()=>{function find(n){if(!n)return null;if(n.stateNode?.browseScreenRef)return n.stateNode;return find(n.child)||find(n.sibling);}return find(document.getElementById('root')?._reactRootContainer?._internalRoot.current)?.browseScreenRef.current;};
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch(engine===chromium?{executablePath:process.env.CHROME,args:['--no-sandbox']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH});
  try{for(const mobile of [false,true])for(const [available,legacy] of [[false,'0'],[true,null],[true,'0'],[true,'1']]){
   const prefix='wii-settings-fixture',oldKey=prefix+'.wii.enabled.v1';
   const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',hasTouch:mobile,viewport:mobile?{width:390,height:844}:{width:1440,height:900}});
   if(legacy!==null)await context.addInitScript(({key,value})=>localStorage.setItem(key,value),{key:oldKey,value:legacy});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/cloud-saves/config.php',r=>r.fulfill({contentType:'application/javascript',body:'window.WrcadCloudConfig='+JSON.stringify({storagePrefix:prefix,enable3DS:true,gamecubeUrl:'/experimental/gamecube/',ps2Url:'/experimental/ps2/',wiiUrl:available?'/experimental/wii/':'',enabled:false,feedUrl:'/content/feeds/combined.json'})+';'}));
   await page.route('**/content/feeds/combined.json',r=>r.fulfill({json:{title:'Wii fixture',categories:[{title:'Nintendo Wii',items:[{title:'Wii fixture',type:'wii',props:{rom:'/fixture.iso'}},{title:'Wii alias fixture',type:'retro-dolphin-wii',props:{rom:'/alias.wbfs'}}]},{title:'GameCube',items:[{title:'Cube fixture',type:'gamecube',props:{rom:'/cube.iso'}}]},{title:'NES',items:[{title:'NES fixture',type:'nes',props:{rom:'/fixture.nes'}}]}]}}));
   if(process.env.STAGE_PLAYER)await page.route('**/main.7ac86965.chunk.js*',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.STAGE_PLAYER)}));
   const readTitles=()=>page.evaluate('('+findBrowse.toString()+')().state.feed.getUniqueCategories().flatMap(c=>c.items.map(i=>i.title))');
   async function ready(){await page.waitForFunction('('+findBrowse.toString()+')()?.state.feed');await page.waitForTimeout(500);const ok=page.locator('.release-screen-dialog').getByRole('button',{name:'OK',exact:true});if(await ok.isVisible())await ok.click();}
   async function settings(){await page.locator('.header-nav-right button').last().click();await page.locator('._QxYEW').waitFor();for(let i=0;i<5;i++)await page.locator('button._17LMl').nth(1).click();await page.getByText('3DS performance readout',{exact:true}).waitFor();}
   const row=label=>page.getByText(label,{exact:true}).locator('..'),perf=()=>row('Wii performance readout');
   const close=name=>page.locator('._E4PtH').getByRole('button',{name,exact:true}).click();
   const save=()=>Promise.all([page.waitForNavigation({waitUntil:'load'}),close('OK')]);
   await page.goto(origin+'/play/');await ready();let titles=await readTitles();assert.equal(titles.includes('Wii fixture'),available);assert.equal(titles.includes('Wii alias fixture'),available);assert(titles.includes('Cube fixture'));
   await settings();assert.equal(await page.getByText('Enable Wii (experimental)',{exact:true}).count(),0);assert.equal(await perf().count(),available?1:0);
   if(available){
    assert(!(await perf().locator('input').isChecked()),'readout defaults off');
    await perf().locator('label').click();assert.equal(await page.evaluate(k=>localStorage.getItem(k),prefix+'.wii.perf.v1'),null,'edits wait for OK');
    await close('Cancel');await settings();assert(!(await perf().locator('input').isChecked()),'Cancel discards edits');
    await perf().locator('label').click();await row('PS2 performance readout').locator('label').click();await save();await ready();
    titles=await readTitles();assert(titles.includes('Wii fixture')&&titles.includes('Wii alias fixture'),'Wii remains visible after saving readout');
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),prefix+'.wii.perf.v1'),'1');assert.equal(await page.evaluate(k=>localStorage.getItem(k),prefix+'.ps2.perf.v1'),'1','simultaneous PS2 setting retained');
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),prefix+'.gamecube.perf.v1'),null,'GameCube preference unchanged');
    await settings();assert(await perf().locator('input').isChecked());await perf().locator('label').click();await save();await ready();assert((await readTitles()).includes('Wii fixture'));
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),oldKey),legacy,'retired preference ignored without rewriting it');
    if(process.env.WII_SETTINGS_OUT)await page.screenshot({path:process.env.WII_SETTINGS_OUT+'-'+engine.name()+'-'+mobile+'-'+legacy+'.png'});
    await page.goto(origin+'/experimental/wii/');await page.waitForFunction(()=>!!window.WrcadWii);await page.getByRole('heading',{name:'Wii',exact:true}).waitFor();assert(await page.locator('#disc').isEnabled());assert.equal(await page.locator('#wii-experimental').count(),0);
    assert(!/Enable Wii|Experimental/.test(await page.locator('#status').textContent()),'direct launcher needs no opt-in');
   }
   assert.deepEqual(errors,[]);await context.close();console.log('PASS',engine.name(),mobile?'touch':'desktop','Wii packaged',available,'legacy',legacy,'default visibility/aliases, retired preference, plain labels, readout OK/Cancel and direct picker');
  }}finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
