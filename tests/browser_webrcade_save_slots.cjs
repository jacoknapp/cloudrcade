// Actual pinned SameBoy SDK slot editor, isolated adapter: no operator saves/ROMs.
// WEBRCADE_SAMEBOY_UI_ROOT contains index.html, cloud-main.js, static/{js,css}.
const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const bundle=process.env.WEBRCADE_SAMEBOY_UI_ROOT;
assert(bundle,'Set WEBRCADE_SAMEBOY_UI_ROOT to the packaged SameBoy app');
const assets=path.resolve(__dirname,'../deploy/webrcade/touch/assets');
const original=fs.readFileSync(path.join(bundle,'index.html'),'utf8');
const runtime=original.match(/<script>(!function[\s\S]*?)<\/script>/)[1]
 .replace('return u.push.apply(u,f||[]),t()','return')
 .replace('a.m=e,','window.nativeRequire=a,a.m=e,');
const vendor=fs.readdirSync(path.join(bundle,'static/js')).find(n=>/^2\..*\.js$/.test(n));
const css=fs.readdirSync(path.join(bundle,'static/css')).find(n=>n.endsWith('.css'));
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({executablePath:engine===chromium?process.env.CHROME:process.env.WEBRCADE_TEST_WEBKIT_PATH,args:engine===chromium?['--no-sandbox']:[]});
 try{for(const touch of [true,false]){
 const context=await browser.newContext({hasTouch:touch,viewport:touch?{width:390,height:844}:{width:1440,height:900}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://slots.test/**',route=>{
  const name=new URL(route.request().url()).pathname.slice(1);
  if(name==='menus.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync(process.env.SAVE_SLOT_CSS||path.join(assets,name))});
  if(name && fs.existsSync(path.join(bundle,name)))return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':'text/css',body:fs.readFileSync(path.join(bundle,name))});
  return route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="static/css/${css}"><link rel="stylesheet" href="menus.css"><div id="root"></div><script>${runtime}</script><script src="static/js/${vendor}"></script><script src="cloud-main.js"></script>`});
 });
 await page.goto('http://slots.test/');
 await page.evaluate(()=>{
  window.WrcadCloud={install(){},installUI(){},installRuntime(){}};
  const React=nativeRequire(0),ReactDOM=nativeRequire(104),SDK=nativeRequire(1);
  const shot='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="144"><rect width="160" height="144" fill="#bdcda1"/><text x="10" y="75">GBC screenshot</text></svg>');
  window.calls={save:[],load:[],delete:[],close:0};window.slots=[];slots[1]={time:Date.now(),shot};
  const emulator={getStateSlots:async()=>slots,saveStateForSlot:async n=>{calls.save.push(n);slots[n]={time:Date.now(),shot};},loadStateForSlot:async n=>calls.load.push(n),deleteStateForSlot:async n=>{calls.delete.push(n);slots[n]=null;}};
  window.show=()=>ReactDOM.render(React.createElement(SDK.s,{emulator,emptyImageSrc:shot,onClose:()=>{calls.close++;ReactDOM.unmountComponentAtNode(document.querySelector('#root'));},showStatusCallback:()=>{}}),document.querySelector('#root'));
  show();
 });
 await page.getByText('Save Slot 1',{exact:true}).waitFor();await page.waitForTimeout(100);
 const button=name=>page.getByRole('button').filter({has:page.getByText(name,{exact:true})});
 if(touch){for(const [width,height] of [[390,844],[320,568],[844,390],[1024,768]]){
  await page.setViewportSize({width,height});
  await page.waitForTimeout(100);
  const metrics=await page.evaluate(()=>{
   const panel=document.querySelector('._QxYEW'),body=document.querySelector('._3aKyj');
   const r=panel.getBoundingClientRect();
   return {height:r.height,viewport:innerHeight,bodyOverflow:body.scrollWidth-body.clientWidth};
  });
  assert(metrics.height<=height-23,'slot panel fits visible height');
  assert(metrics.height<500,'slot panel has no excessive blank body');
  assert(metrics.bodyOverflow<=1,'slot content has no horizontal clipping');
  for(const name of ['Load','Save','Delete','OK']){
   await button(name).scrollIntoViewIfNeeded();
   const r=await button(name).boundingBox();assert(r.width>=44&&r.height>=44,'44px action target '+name);
   assert(r.x>=0&&r.x+r.width<=width,'action fits width '+name);
   assert(r.y>=0&&r.y+r.height<=height,'action fits height '+name);
   assert(await button(name).evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===hit||e.contains(hit);}),name+' is painted and reachable');
  }
  if(process.env.SAVE_SLOT_SCREENSHOTS){fs.mkdirSync(process.env.SAVE_SLOT_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.SAVE_SLOT_SCREENSHOTS,engine.name()+'-'+width+'x'+height+'.png')});}
 }}else assert.equal(await page.locator('._QxYEW').evaluate(e=>getComputedStyle(e).height), '720px','desktop native panel unchanged');
 // All eight native tabs remain reachable. Empty slots offer Save; used slots expose all actions.
 await page.setViewportSize(touch?{width:390,height:844}:{width:1440,height:900});
 const arrows=page.locator('._17LMl');
 for(let n=2;n<=8;n++){await arrows.last().click();await page.getByText('Save Slot '+n,{exact:true}).waitFor();}
 await button('Save').click();await page.waitForFunction(()=>calls.close===1);
 await page.evaluate(()=>show());await page.getByText('Save Slot 1',{exact:true}).waitFor();await page.waitForTimeout(100);
 await button('Load').click();await page.waitForFunction(()=>calls.close===2);
 await page.evaluate(()=>show());await page.getByText('Save Slot 1',{exact:true}).waitFor();await page.waitForTimeout(100);
 await button('Delete').click();await button('Load').waitFor({state:'hidden'});
 await button('Save').click();await page.waitForFunction(()=>calls.close===3);
 assert.deepEqual(await page.evaluate(()=>calls),{save:[8,1],load:[1],delete:[1],close:3});
 assert.deepEqual(errors,[]);await context.close();console.log('PASS',engine.name(),touch?'phone/landscape/tablet':'desktop','native GBC slot layout, eight slots and save/load/delete');
 }}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
