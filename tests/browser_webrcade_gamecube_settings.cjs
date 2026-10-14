// Native settings: GameCube visibility, save/cancel, history and consistent type.
// Isolated profiles and synthetic feed; no games, accounts or operator writes.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://localhost:8443';
const findBrowse=()=>{function find(n){if(!n)return null;if(n.stateNode?.browseScreenRef)return n.stateNode;return find(n.child)||find(n.sibling);}return find(document.getElementById('root')?._reactRootContainer?._internalRoot.current)?.browseScreenRef.current;};
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({...(engine===chromium?{executablePath:process.env.CHROME,args:['--no-sandbox']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
  try{
   for(const mobile of [true,false])for(const available of [false,true]){
    const prefix='gcvisibility-fixture',key=prefix+'.gamecube.enabled.v1';
    const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',hasTouch:mobile,viewport:mobile?{width:390,height:844}:{width:1440,height:900}});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/cloud-saves/config.php',r=>r.fulfill({contentType:'application/javascript',body:
     'window.WrcadCloudConfig='+JSON.stringify({enabled:false,autoRedirect:false,enable3DS:true,storagePrefix:prefix,message:'Cloud storage fixture',
      gamecubePrototypeUrl:available?'/experimental/gamecube/':null,feedUrl:'/content/feeds/combined.json'})+';'}));
    const gc={title:'Cube fixture',type:'gamecube',props:{uid:'cube-fixture',rom:'/fixture.iso'}},alias={title:'Cube alias',type:'retro-dolphin',props:{rom:'/alias.iso'}};
    const nes={title:'NES fixture',type:'nes',props:{rom:'/fixture.nes'}},psp={title:'PSP fixture',type:'psp',props:{rom:'/fixture.pbp'}};
    let cubeOnly=false;
    await page.route('**/content/feeds/combined.json',r=>r.fulfill({json:{title:'Settings fixture',categories:cubeOnly?[{title:'GameCube',items:[gc]}]:[{title:'GameCube',items:[gc,alias]},{title:'Mixed',items:[gc,nes,psp]}]}}));
    async function load(){await page.goto(origin+'/play/');await page.waitForFunction('('+findBrowse.toString()+')()?.state.feed');await page.waitForTimeout(1200);const ok=page.locator('.release-screen-dialog').getByRole('button',{name:'OK',exact:true});if(await ok.isVisible())await ok.click();}
    async function open(){await load();await page.locator('.header-nav-right button').last().click();await page.locator('._QxYEW').waitFor();}
    async function save(){await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('._E4PtH').getByRole('button',{name:'OK',exact:true}).click()]);}
    const next=()=>page.locator('button._17LMl').nth(1);
    const row=()=>page.getByText('GameCube (experimental)',{exact:true}).locator('..');
    async function experimental(){for(let i=0;i<5;i++)await next().click();await page.getByText('3DS performance readout',{exact:true}).waitFor();}
    const titles=()=>page.evaluate('('+findBrowse.toString()+')().state.feed.getUniqueCategories().flatMap(c=>c.items.map(i=>i.title))');
    await open();
    // Every tab must use the same body/control/action scale through viewport changes.
    const sizes=mobile?[[390,844],[844,390]]:[[800,600],[1440,900],[2200,1200]];
    for(const [width,height] of sizes){
     await page.setViewportSize({width,height});let tabs=0;
     for(;;){
      await page.waitForTimeout(250);
      const text=await page.locator('._QxYEW').evaluate(el=>({
       base:parseFloat(getComputedStyle(el.querySelector('._3aKyj')).fontSize),
       fonts:[...el.querySelectorAll('._19qVy,._1FOsd,._2J1_d,._1YiUm,._1YZKt,._6miOA')].map(n=>parseFloat(getComputedStyle(n).fontSize)),
       heading:parseFloat(getComputedStyle(el.querySelector('._R64Gp')).fontSize)}));
      const expected=mobile?14:Math.max(14,Math.min(28,width*.016));
      assert(Math.abs(text.base-expected)<.1,'shared body scale');assert(text.fonts.every(v=>Math.abs(v-text.base)<.1),'all labels/values/help/actions share scale on tab '+tabs);
      assert(Math.abs(text.heading-(mobile?15:expected*1.25))<.1,'shared heading scale');
      tabs++;if(await next().isDisabled())break;await next().click();
     }
     assert.equal(tabs,6,'every native library settings tab checked');
     for(let i=1;i<tabs;i++)await page.locator('button._17LMl').first().click();
    }
    await experimental();
    assert.equal(await page.getByText('Open GameCube disc',{exact:true}).count(),0);
    const perf=page.getByText('GameCube performance readout',{exact:true});assert.equal(await perf.count(),available?1:0);
    assert.equal(await row().count(),available?1:0);
    if(available){
     assert(await row().locator('input[type=checkbox]').isChecked(),'visible by default');
     assert(await perf.locator('..').locator('input').isChecked(),'performance monitor remains enabled');
     // Cancel discards this setting rather than hiding games unexpectedly.
     await row().locator('label').click();await page.locator('._E4PtH').getByRole('button',{name:'Cancel',exact:true}).click();
     assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);assert((await titles()).includes('Cube fixture'));
     const history=JSON.stringify([JSON.stringify(['gamecube','uid','cube-fixture'])]);
     await page.evaluate(({prefix,history})=>{localStorage.setItem(prefix+'.recently-played.v1',history);localStorage.setItem(prefix+'.recently-played.sync.v1.owner','null');localStorage.setItem(prefix+'.recently-played.sync.v1.null',JSON.stringify([{key:JSON.parse(history)[0],playedAt:Date.now()}]));}, {prefix,history});
     await open();await experimental();assert(await row().locator('input').isChecked());await row().locator('label').click();
     await save();await page.waitForFunction(k=>localStorage.getItem(k)==='0',key);await load();
     assert.deepEqual([...new Set(await titles())].sort(),['NES fixture','PSP fixture']);
     assert(await page.evaluate('('+findBrowse.toString()+')().getSearchItems("Cube").length===0'),'hidden from search');
     assert(!(await page.evaluate('('+findBrowse.toString()+')().state.feed.getCategories().some(c=>c.items.some(i=>i.type==="gamecube"||i.type==="retro-dolphin"))')),'hidden from recently played too');
     assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k))[0].key,prefix+'.recently-played.sync.v1.null'),JSON.parse(history)[0],'hidden games retain history');
     assert.equal(await page.evaluate(k=>localStorage.getItem(k),prefix+'.gamecube.perf.v1'),null,'visibility does not change readout preference');
     assert.equal(await page.evaluate(k=>localStorage.getItem(k),prefix+'.3ds.perf.v1'),null,'visibility does not change 3DS');
     cubeOnly=true;await open();await experimental();assert.equal(await row().locator('input').isChecked(),false,'hidden-only feed retains Settings');
     await row().locator('label').click();await save();await page.waitForFunction(k=>localStorage.getItem(k)==='1',key);await load();assert((await titles()).includes('Cube fixture'),'re-enabled games return');
    }
    assert.deepEqual(errors,[]);await context.close();console.log('PASS',engine.name(),mobile?'touch':'desktop','availability:',available,'all-tab typography, visibility save/cancel, reload, aliases/search/recent and empty-feed recovery');
   }
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
