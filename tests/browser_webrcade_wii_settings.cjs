// Actual patched library; synthetic feed, isolated browser profiles, no operator data.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://127.0.0.1:18573';
const findBrowse=()=>{function find(n){if(!n)return null;if(n.stateNode?.browseScreenRef)return n.stateNode;return find(n.child)||find(n.sibling);}return find(document.getElementById('root')?._reactRootContainer?._internalRoot.current)?.browseScreenRef.current;};
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch(engine===chromium?{executablePath:process.env.CHROME,args:['--no-sandbox']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH});
  try{for(const mobile of [false,true])for(const available of [false,true]){
   const prefix='wii-settings-fixture';
   const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',hasTouch:mobile,viewport:mobile?{width:390,height:844}:{width:1440,height:900}});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/cloud-saves/config.php',r=>r.fulfill({contentType:'application/javascript',body:'window.WrcadCloudConfig='+JSON.stringify({storagePrefix:prefix,enable3DS:true,gamecubeUrl:'/experimental/gamecube/',ps2Url:'/experimental/ps2/',wiiUrl:available?'/experimental/wii/':'',enabled:false,feedUrl:'/content/feeds/combined.json'})+';'}));
   await page.route('**/content/feeds/combined.json',r=>r.fulfill({json:{title:'Wii fixture',categories:[{title:'Wii',items:[{title:'Wii fixture',type:'wii',props:{rom:'/fixture.iso'}},{title:'Wii alias fixture',type:'retro-dolphin-wii',props:{rom:'/alias.iso'}}]},{title:'GameCube',items:[{title:'Cube fixture',type:'gamecube',props:{rom:'/cube.iso'}}]},{title:'NES',items:[{title:'NES fixture',type:'nes',props:{rom:'/fixture.nes'}}]}]}}));
   const readTitles=()=>page.evaluate('('+findBrowse.toString()+')().state.feed.getUniqueCategories().flatMap(c=>c.items.map(i=>i.title))');
   async function load(){await page.goto(origin+'/play/');await ready();}
   async function ready(){await page.waitForFunction('('+findBrowse.toString()+')()?.state.feed');await page.waitForTimeout(500);const ok=page.locator('.release-screen-dialog').getByRole('button',{name:'OK',exact:true});if(await ok.isVisible())await ok.click();}
   async function settings(){await page.locator('.header-nav-right button').last().click();await page.locator('._QxYEW').waitFor();for(let i=0;i<5;i++)await page.locator('button._17LMl').nth(1).click();await page.getByText('3DS performance readout',{exact:true}).waitFor();}
   const row=label=>page.getByText(label,{exact:true}).locator('..');
   const enabled=()=>row('Enable Wii (experimental)');const perf=()=>row('Wii performance readout (experimental)');
   const close=name=>page.locator('._E4PtH').getByRole('button',{name,exact:true}).click();
   const save=()=>Promise.all([page.waitForNavigation({waitUntil:'load'}),close('OK')]);
   await load();let titles=await readTitles();assert(!titles.includes('Wii fixture'));assert(titles.includes('Cube fixture'));
   await settings();assert.equal(await enabled().count(),available?1:0);
   if(available){
    assert(!(await enabled().locator('input').isChecked()));assert(!(await perf().locator('input').isChecked()));
    await enabled().locator('label').click();await perf().locator('label').click();
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),prefix+'.wii.enabled.v1'),null,'edits remain pending until OK');
    await close('Cancel');await settings();assert(!(await enabled().locator('input').isChecked()),'Cancel discards edits');
    await enabled().locator('label').click();await perf().locator('label').click();await row('PS2 performance readout').locator('label').click();
    await save();await page.waitForFunction(k=>localStorage.getItem(k)==='1',prefix+'.wii.enabled.v1');await ready();
    titles=await readTitles();assert(titles.includes('Wii fixture')&&titles.includes('Wii alias fixture'),'enabled Wii names and aliases parsed');
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),prefix+'.wii.perf.v1'),'1');
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),prefix+'.ps2.perf.v1'),'1','simultaneous settings retained');
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),prefix+'.gamecube.perf.v1'),null,'GameCube preference unchanged');
    await settings();assert(await enabled().locator('input').isChecked());await enabled().locator('label').click();await save();await ready();
    assert(!(await readTitles()).includes('Wii fixture'),'disable removes Wii from library');
   }
   assert.deepEqual(errors,[]);await context.close();console.log('PASS',engine.name(),mobile?'touch':'desktop','Wii availability',available,'off by default, OK/Cancel, alias filtering, independent persisted readout');
  }}finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
