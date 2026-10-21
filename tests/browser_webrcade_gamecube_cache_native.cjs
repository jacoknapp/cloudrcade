/* Real CPU-pthread cache selection + state compatibility. No cloud writes.
 * Requires GAMECUBE_TEST_ROM on an isolated origin. Optional GAMECUBE_TEST_STATE
 * is a private older native state; OUT_DIR owns any resulting private images.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const origin=process.env.WEBRCADE_GAMECUBE_ORIGIN||'https://127.0.0.1:18574';
const rom=process.env.GAMECUBE_TEST_ROM;if(!rom)throw Error('Set GAMECUBE_TEST_ROM');
const outDir=process.env.OUT_DIR;if(outDir)fs.mkdirSync(outDir,{recursive:true,mode:0o700});
const readState=()=>process.env.GAMECUBE_TEST_STATE?fs.readFileSync(process.env.GAMECUBE_TEST_STATE).toString('base64'):null;
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface','--ignore-gpu-blocklist']});
 const results=[];let desktopState=null;
 try{
  for(const profile of ['desktop','standard']){
   const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:800,height:600}});
   try{
    await context.addInitScript(profile=>{
     let config;Object.defineProperty(window,'WrcadCloudConfig',{configurable:true,get:()=>config,set(value){config={...value,enabled:false,storagePrefix:'cache-budget-isolated'};}});
     const hints=profile==='desktop'?{platform:'Win32',maxTouchPoints:0,deviceMemory:8,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}:{platform:'MacIntel',maxTouchPoints:5,deviceMemory:undefined,userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X)'};
     for(const [key,value] of Object.entries(hints))Object.defineProperty(navigator,key,{configurable:true,get:()=>value});
     Object.defineProperty(navigator,'userAgentData',{configurable:true,get:()=>undefined});
     const gpu=navigator.gpu,request=gpu.requestAdapter.bind(gpu);gpu.requestAdapter=async options=>(await request(options))||request(options);
    },profile);
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')console.error(message.text());});
    await page.route('**/session.mjs',async route=>{const response=await route.fetch();let text=await response.text();text=text.replace('this.scope = scope;','this.scope = scope;globalThis.__s=this;const originalFail=this.fail.bind(this);this.fail=error=>{console.error("SESSION FATAL",error?.stack||String(error));return originalFail(error);};');await route.fulfill({response,body:text});});
    await page.route('**/upstream-discio-worker.js',async route=>{const response=await route.fetch();let text=await response.text();text=text.replace('    case "heapStats":',`    case "cacheBudgetProbe": return {capacity:moduleInstance._DolphinWeb_GetWasmCacheCapacity(),lateChange:moduleInstance._DolphinWeb_SetWasmCacheProfile(0),helper:api.getPpcWasmHelperStats(),heapBytes:moduleInstance.HEAPU8.byteLength};\n    case "heapStats":`);await route.fulfill({response,body:text});});
    const props=Buffer.from(encodeURIComponent(JSON.stringify({title:'Cache profile qualification',rom:new URL(rom,origin).href}))).toString('base64');
    await page.goto(origin+'/experimental/gamecube/?props='+encodeURIComponent(props));
    await page.waitForFunction(()=>globalThis.__s?.booted,null,{timeout:180000});
    await page.waitForTimeout(Number(process.env.WARM||45)*1000);
    const gpu=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter();return {vendor:a.info.vendor,fallback:a.info.isFallbackAdapter}});assert.equal(gpu.fallback,false);
    const req=(type,payload={})=>page.evaluate(({type,payload})=>__s.adapter.request(type,payload),{type,payload});
    const restore=async base64=>{
     await page.evaluate(()=>__s.pause());
     const result=await page.evaluate(async base64=>{const bytes=Uint8Array.from(atob(base64),v=>v.charCodeAt(0));return __s.adapter.request('loadStateFile',{bytes});},base64);assert.equal(result.loaded,true);
     await page.evaluate(()=>WrcadGameCube.togglePause());await page.waitForTimeout(10000);
    };
    const old=readState();if(old)await restore(old);
    if(profile==='standard'&&desktopState)await restore(desktopState);
    const selected=await page.evaluate(()=>__s.jitCache);assert.equal(selected.profile,profile);assert.equal(selected.capacity,profile==='desktop'?32768:16384);
    await assert.rejects(req('jitCacheProfile',{profile:'standard'}),/before boot/);
    const a=await req('runFrame');await page.waitForTimeout(Number(process.env.SAMPLE||15)*1000);const z=await req('runFrame');
    assert(z.frame>a.frame&&z.coreTicks>a.coreTicks);assert(z.gamecubeDiagnostics.render.frames>a.gamecubeDiagnostics.render.frames);assert(z.gamecubeDiagnostics.render.ageMs<2000);assert.equal(z.gamecubeDiagnostics.rendererError,null);assert.equal(z.gamecubeDiagnostics.missingPipelines,0);assert.equal(z.gamecubeDiagnostics.skippedDraws,0);
    const native=await req('cacheBudgetProbe');assert.equal(native.capacity,selected.capacity);assert.equal(native.lateChange,0);assert.equal(native.heapBytes,768*1024*1024);assert(native.helper.includes('instcap:'+selected.capacity));
    const live=Number(/instlive:(\d+)/.exec(native.helper)?.[1]);assert(live>0&&live<=selected.capacity);
    if(profile==='desktop'&&old)assert(live>16384,'the actual CPU pthread must retain beyond the mobile limit');
    if(profile==='desktop'&&old){
     await page.evaluate(()=>__s.pause());
     desktopState=await page.evaluate(async()=>{const result=await __s.adapter.request('saveStateFile');if(!result.saved||!result.bytes?.byteLength)throw Error('Native state save failed');const bytes=new Uint8Array(result.bytes);let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);});
     await page.evaluate(()=>WrcadGameCube.togglePause());
    }
    if(outDir)await page.screenshot({path:path.join(outDir,profile+'.png')});
    assert.deepEqual(errors,[]);const result={profile,capacity:native.capacity,live,lateChange:native.lateChange,heapBytes:native.heapBytes,olderStateLoaded:!!old,desktopStateLoaded:profile==='standard'&&!!desktopState,gpu};results.push(result);console.log('PASS',JSON.stringify(result));
   }finally{await context.close();}
  }
 }finally{await browser.close();}
 if(process.env.OUT)fs.writeFileSync(process.env.OUT,JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
