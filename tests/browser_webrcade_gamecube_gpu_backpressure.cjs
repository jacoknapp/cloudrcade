// Deliberately delay owned worker fences after real GPU completion. The native
// ring must retain commands while two frames are pending and resume when freed.
const assert=require('node:assert/strict');const{chromium}=require('playwright');
const origin=process.env.WEBRCADE_GAMECUBE_ORIGIN,rom=process.env.GAMECUBE_TEST_ROM;
if(!origin||!rom)throw Error('Supply isolated origin and legal read-only game');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface']});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
  await context.addInitScript(()=>{let config;Object.defineProperty(window,'WrcadCloudConfig',{get:()=>config,set:v=>config={...v,enabled:false,autoRedirect:false,storagePrefix:'shadowcrash_gpu_delay_test'}});});
  await context.route('**/upstream-discio-worker.js',async r=>{const response=await r.fetch(),body=await response.text(),anchor='gamecubeGpuFrames.submitted(q);';assert.equal(body.split(anchor).length,2);await r.fulfill({response,body:body.replace(anchor,'gamecubeGpuFrames.submitted({onSubmittedWorkDone:()=>q.onSubmittedWorkDone().then(()=>new Promise(resolve=>setTimeout(resolve,500)))});')});});
  await context.route('**/session.mjs',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('this.scope = scope;','this.scope = scope;window.__session=this;')});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const props=Buffer.from(encodeURIComponent(JSON.stringify({title:'Owned GPU backlog test',type:'gamecube',rom:new URL(rom,origin).href}))).toString('base64');
  await page.goto(origin+'/experimental/gamecube/?props='+encodeURIComponent(props));await page.waitForFunction(()=>__session?.booted,null,{timeout:120000});
  const sample=()=>page.evaluate(()=>__session.adapter.request('runFrame'));const first=await sample();
  for(let i=0;i<12;i++){await page.waitForTimeout(1000);const f=await sample();assert(f.gamecubeDiagnostics.gpuQueue.pending<=2);assert(f.gamecubeDiagnostics.gpuQueue.maximum<=2);assert.equal(f.gamecubeDiagnostics.rendererError,null);}
  const last=await sample();assert.equal(last.gamecubeDiagnostics.gpuQueue.maximum,2);assert(last.gamecubeDiagnostics.gpuQueue.completed>first.gamecubeDiagnostics.gpuQueue.completed+5);assert(last.gamecubeDiagnostics.render.frames>first.gamecubeDiagnostics.render.frames+5);assert(last.frame>first.frame+5);assert(last.gamecubeDiagnostics.gpuQueue.lastCompletionMs>=490);assert.deepEqual(errors,[]);
  await page.evaluate(()=>WrcadGameCube.exit());
  console.log('PASS native GPU replay preserves/resumes ring work under 500ms delayed completion fences, two pending frames maximum',JSON.stringify(last.gamecubeDiagnostics.gpuQueue));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
