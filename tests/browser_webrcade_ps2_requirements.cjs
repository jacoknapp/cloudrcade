/* Missing/failed/software WebGPU must fail clearly and release native workers. */
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://localhost:8443';
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true,...(engine===chromium?{executablePath:process.env.CHROME,args:['--no-sandbox']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
 try{for(const mode of ['missing','unavailable','software']){
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),page=await context.newPage(),requests=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  await context.route('**/cloud-saves/config.php',route=>route.fulfill({contentType:'application/javascript',body:'window.WrcadCloudConfig={storagePrefix:"ps2_requirements",enabled:false};'}));
  await context.addInitScript(mode=>{
   localStorage.setItem('ps2_requirements.ps2.enabled.v1','1');
   Object.defineProperty(navigator,'gpu',{value:mode==='missing'?undefined:{requestAdapter:async()=>mode==='unavailable'?null:{isFallbackAdapter:true,info:{vendor:'SwiftShader'}}}});
   const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){if(/webgl/i.test(kind))throw new Error('Unexpected WebGL fallback');return original.call(this,kind,...args);};
   let current;Object.defineProperty(window,'Module',{configurable:true,get:()=>current,set:value=>{current=value;if(value)window.ownedNative=value;}});
  },mode);
  const props={title:'GPU requirement fixture',type:'play-ps2',uid:'ps2-gpu-requirements',rom:new URL(process.env.PS2_TEST_ROM||'/content/cloudrcade.iso',origin).href};
  await page.goto(origin+'/experimental/ps2/?ctx=standalone&props='+encodeURIComponent(Buffer.from(encodeURIComponent(JSON.stringify(props))).toString('base64')));
  await page.locator('#failure').waitFor({state:'visible',timeout:120000});
  assert.match(await page.locator('#failure-detail').innerText(),/WebGPU|hardware/);
  await page.waitForFunction(()=>!window.Module&&ownedNative.PThread.runningWorkers.length===0&&ownedNative.PThread.unusedWorkers.length===0);
  assert(!requests.some(url=>/\/core\/Gpu\.(js|wasm)/.test(url)),'reject unavailable hardware before GPU module download');
  assert.deepEqual(errors,[]);await context.close();console.log('PASS',engine.name(),'PS2 WebGPU '+mode+' rejection, no fallback and native worker cleanup');
 }}finally{await browser.close();}
}})().catch(error=>{console.error(error);process.exitCode=1;});
