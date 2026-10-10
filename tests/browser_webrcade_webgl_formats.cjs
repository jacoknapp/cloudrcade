// Runs the actual browser-format conversion functions against synthetic pixels.
// The game only initializes the existing GL context; the test uses a fresh profile.
const {chromium}=require('playwright'),assert=require('assert/strict');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'http://localhost:18082';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-unsafe-webgpu']});
 try {
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  const feed=await(await context.request.get(origin+'/content/feeds/combined.json')).json();
  const game=feed.categories.flatMap(c=>c.items).find(i=>i.title.includes('Ultra Moon'));assert(game);
  const props=Buffer.from(encodeURIComponent(JSON.stringify({type:'3ds',title:game.title,...game.props}))).toString('base64');
  await page.goto(origin+'/play/app/retro-azahar/?ctx=standalone&props='+encodeURIComponent(props));
  await page.waitForFunction(()=>window.Module?._get_current_frame_count()>150,null,{timeout:120000});
  await page.evaluate(()=>emulator.pause(true));
  await page.waitForFunction(()=>!emulator.pendingGpuFrame,null,{timeout:60000});
  const result=await page.evaluate(()=>({result:Module._wrc_webgl_formats_test(),failure:Module.formatFailure}));
  assert.equal(result.result,1,'D24S8 and RGBA4 reinterpreted pixels must match: '+JSON.stringify(result.failure));
  await page.evaluate(()=>emulator.pause(false));const before=await page.evaluate(()=>Module._get_current_frame_count());
  await page.waitForFunction(n=>Module._get_current_frame_count()>n+60,before,{timeout:60000});
  await page.evaluate(async()=>{emulator.pause(true);await app.onPreExit();});
  console.log('PASS actual WebGL format shaders: 256 depth/stencil patterns, RGBA4 -> RGB5A1 and restored game state');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
