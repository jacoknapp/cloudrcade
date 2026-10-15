/* Native experimental switches: defaults, OK/Cancel, reload and feed gates.
 * WEBRCADE_TEST_ORIGIN, STAGE_PLAYER, CHROME, WEBRCADE_TEST_WEBKIT_PATH supported.
 * Uses synthetic feeds/storage; loads no games or operator accounts.
 */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://localhost:8443';
const feed={title:'PS2 test',categories:[
 {title:'NES',items:[{title:'Existing NES',type:'nes',props:{rom:'/content/game.nes'}}]},
 {title:'PSP',items:[{title:'Existing PSP',type:'psp',props:{rom:'/content/game.pbp'}}]},
 {title:'PS2',items:[{title:'PS2 fixture',type:'ps2',props:{rom:'/content/test.iso'}}]},
]};
async function types(page){
 await page.waitForFunction(()=>{
  const find=node=>!node?null:node.stateNode?.browseScreenRef?node.stateNode:find(node.child)||find(node.sibling);
  const library=find(document.getElementById('root')?._reactRootContainer?._internalRoot.current);
  return library?.state.feed?.getUniqueCategories?.().some(category=>category.items?.some(item=>item.title==='Existing NES'));
 });
 return page.evaluate(()=>{
  const find=node=>!node?null:node.stateNode?.browseScreenRef?node.stateNode:find(node.child)||find(node.sibling);
  return find(document.getElementById('root')._reactRootContainer._internalRoot.current).state.feed.getUniqueCategories().flatMap(category=>category.items).map(item=>typeof item.type==='string'?item.type:item.type.key);
 });
}
async function settings(page){
 await page.waitForTimeout(1200);
 const ok=page.getByRole('button',{name:'OK',exact:true});if(await ok.count())await ok.first().click();
 await page.locator('.header-nav-right button').last().click();
 for(let index=0;index<7;index++){
  if(await page.getByText('Enable PlayStation 2 (experimental)',{exact:true}).isVisible())break;
  await page.locator('button._17LMl').nth(1).click();
 }
 await page.getByText('Enable PlayStation 2 (experimental)',{exact:true}).waitFor();
 await page.waitForFunction(()=>+getComputedStyle(document.querySelector('._1OdS7')).opacity>.95);
}
const checkbox=(page,label)=>page.locator('._3e512').filter({hasText:label}).locator('input');
const hasPS2=types=>types.some(type=>type==='ps2'||type==='play-ps2');
const hasPSP=types=>types.some(type=>type==='psp'||type==='retro-ppsspp');
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,...(engine===chromium?{executablePath:process.env.CHROME,args:['--no-sandbox']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
  try{for(const enable3DS of [false,true]){
   const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',hasTouch:true,viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/cloud-saves/config.php',route=>route.fulfill({contentType:'application/javascript',body:'window.WrcadCloudConfig='+JSON.stringify({appName:'PS2 Test',storagePrefix:'ps2_test',enabled:false,enable3DS,gamecubeUrl:'',ps2Url:'/experimental/ps2/',feedUrl:'/content/feeds/combined.json'})+';'}));
   await page.route('**/content/feeds/combined.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(feed)}));
   if(process.env.STAGE_PLAYER)await page.route('**/main.7ac86965.chunk.js*',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.STAGE_PLAYER)}));
   await page.goto(origin+'/play/');let current=await types(page);
   assert(!hasPS2(current));assert(current.includes('nes')&&hasPSP(current),JSON.stringify(current));
   await settings(page);
   assert(!await checkbox(page,'Enable PlayStation 2').isChecked());assert(!await checkbox(page,'PS2 performance readout').isChecked());
   await checkbox(page,'Enable PlayStation 2').locator('..').click();await checkbox(page,'PS2 performance readout').locator('..').click();
   await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.reload();assert(!hasPS2(await types(page)),'Cancel preserves disabled');
   await settings(page);assert(!await checkbox(page,'PS2 performance readout').isChecked());
   await checkbox(page,'Enable PlayStation 2').locator('..').click();await checkbox(page,'PS2 performance readout').locator('..').click();
   await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'OK',exact:true}).click()]);
   current=await types(page);assert(hasPS2(current));assert(current.includes('nes')&&hasPSP(current));
   assert.equal(await page.evaluate(()=>localStorage.getItem('ps2_test.ps2.perf.v1')),'1');
   await settings(page);assert(await checkbox(page,'Enable PlayStation 2').isChecked());assert(await checkbox(page,'PS2 performance readout').isChecked());
   await checkbox(page,'Enable PlayStation 2').locator('..').click();await checkbox(page,'PS2 performance readout').locator('..').click();
   await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'OK',exact:true}).click()]);assert(!hasPS2(await types(page)));
   let nativeLoads=0;page.on('request',request=>{if(request.url().includes('/experimental/ps2/core/'))nativeLoads++;});
   const props={rom:origin+'/content/test.iso',type:'play-ps2'};
   await page.goto(origin+'/experimental/ps2/?props='+encodeURIComponent(Buffer.from(encodeURIComponent(JSON.stringify(props))).toString('base64')));
   await page.getByText('Enable PlayStation 2 in Settings → Experimental Settings before launching.',{exact:true}).first().waitFor();
   assert.equal(nativeLoads,0,'disabled direct launch never loads the native core');
   assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${engine.name()} PS2 experimental native OK/Cancel, on/off/readout defaults, persisted reload and existing-core preservation (3DS=${enable3DS})`);
  }}finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
