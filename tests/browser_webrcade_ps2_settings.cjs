/* Standard PS2 availability: old opt-outs, Core Settings and OK/Cancel.
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
  if(await page.getByText('PS2 performance readout',{exact:true}).isVisible())break;
  await page.locator('button._17LMl').nth(1).click();
 }
 await page.getByText('PS2 performance readout',{exact:true}).waitFor();
 assert.equal(await page.getByText('Experimental Settings',{exact:true}).count(),0);
 assert.equal(await page.getByText(/Enable PlayStation 2/).count(),0);
 await page.waitForFunction(()=>+getComputedStyle(document.querySelector('._1OdS7')).opacity>.95);
}
const checkbox=(page,label)=>page.locator('._3e512').filter({hasText:label}).locator('input');
const hasPS2=types=>types.some(type=>type==='ps2'||type==='play-ps2');
const hasPSP=types=>types.some(type=>type==='psp'||type==='retro-ppsspp');
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,...(engine===chromium?{executablePath:process.env.CHROME,args:['--no-sandbox']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
  try{for(const [enable3DS,legacy] of [[false,null],[false,'0'],[true,'0'],[true,'1']]){
   const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',hasTouch:true,viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/cloud-saves/config.php',route=>route.fulfill({contentType:'application/javascript',body:'window.WrcadCloudConfig='+JSON.stringify({appName:'PS2 Test',storagePrefix:'ps2_test',enabled:false,enable3DS,gamecubeUrl:'',ps2Url:'/experimental/ps2/',feedUrl:'/content/feeds/combined.json'})+';'}));
   await page.route('**/content/feeds/combined.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(feed)}));
   if(process.env.STAGE_PLAYER)await page.route('**/main.7ac86965.chunk.js*',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.STAGE_PLAYER)}));
   if(legacy!==null)await context.addInitScript(value=>localStorage.setItem('ps2_test.ps2.enabled.v1',value),legacy);
   if(process.env.PS2_APP_ROOT)await context.route('**/experimental/ps2/**',async route=>{
    const path=require('node:path'),name=new URL(route.request().url()).pathname.slice('/experimental/ps2/'.length)||'index.html',file=path.join(process.env.PS2_APP_ROOT,name);
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())return route.continue();
    const response=await route.fetch();await route.fulfill({response,body:fs.readFileSync(file)});
   });
   await page.goto(origin+'/play/');let current=await types(page);
   assert(hasPS2(current),'PS2 is available by default, including old opt-outs');assert(current.includes('nes')&&hasPSP(current),JSON.stringify(current));
   await settings(page);
   assert(!await checkbox(page,'PS2 performance readout').isChecked());
   await checkbox(page,'PS2 performance readout').locator('..').click();
   await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.reload();assert(hasPS2(await types(page)),'Cancel cannot hide PS2');
   await settings(page);assert(!await checkbox(page,'PS2 performance readout').isChecked());
   await checkbox(page,'PS2 performance readout').locator('..').click();
   await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'OK',exact:true}).click()]);
   current=await types(page);assert(hasPS2(current));assert(current.includes('nes')&&hasPSP(current));
   assert.equal(await page.evaluate(()=>localStorage.getItem('ps2_test.ps2.perf.v1')),'1');
   await settings(page);assert(await checkbox(page,'PS2 performance readout').isChecked());
   if(process.env.PS2_SETTINGS_SCREENSHOT)await page.screenshot({path:process.env.PS2_SETTINGS_SCREENSHOT+'-'+engine.name()+'-'+enable3DS+'-'+legacy+'.png'});
   await checkbox(page,'PS2 performance readout').locator('..').click();
   await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'OK',exact:true}).click()]);assert(hasPS2(await types(page)));
   assert.equal(await page.evaluate(()=>localStorage.getItem('ps2_test.ps2.enabled.v1')),legacy,'retired enable preference is ignored without rewriting other settings');
   await page.goto(origin+'/experimental/ps2/');
   await page.getByRole('heading',{name:'PlayStation 2',exact:true}).waitFor();
   assert(await page.locator('#file').isEnabled(),'direct file launcher needs no opt-in');
   await page.getByText('Select a PS2 game.',{exact:true}).waitFor();
   assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${engine.name()} standard PS2 visibility/label, retired opt-out, Core Settings readout OK/Cancel and direct picker (3DS=${enable3DS}, old=${legacy})`);
  }}finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
