// Device-GPU failure/restart qualification with an explicitly supplied legal ROM.
// Own browser profile and GPUDevice only; no operator saves or device-wide reset.
const assert=require('node:assert/strict');const{chromium}=require('playwright');
const origin=process.env.WEBRCADE_GAMECUBE_ORIGIN||'https://127.0.0.1:18975';
const rom=process.env.GAMECUBE_TEST_ROM;if(!rom)throw new Error('GAMECUBE_TEST_ROM must name a legally available read-only game.');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface']});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',hasTouch:true,viewport:{width:390,height:844}});
  await context.addInitScript(()=>{let config;Object.defineProperty(window,'WrcadCloudConfig',{configurable:true,get:()=>config,set(value){config={...value,enabled:false,autoRedirect:false,storagePrefix:'gamecube_device_loss_test'};}});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/session.mjs',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('this.scope = scope;','this.scope = scope; globalThis.__session=this;')});});
  await context.route('**/upstream-discio-worker.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text())+'\nself.__destroyTestDevice=()=>renderGpu.device.destroy();\n'});});
  const props={title:'GameCube recovery test',type:'gamecube',rom:new URL(rom,origin).href};
  const encoded=Buffer.from(encodeURIComponent(JSON.stringify(props))).toString('base64');
  await page.goto(origin+'/experimental/gamecube/?props='+encodeURIComponent(encoded));
  await page.waitForFunction(()=>globalThis.__session?.booted,null,{timeout:120000});
  await page.locator('.kt-tab').tap();await page.locator('.kt-close').tap();
  const waitFrames=async target=>{const deadline=Date.now()+180000;for(;;){const f=await page.evaluate(()=>__session.adapter.request('runFrame'));if(f.frame>=target)return f;if(Date.now()>deadline)throw new Error('Native frame progress timed out');await page.waitForTimeout(500);}};
  const first=await waitFrames(300);assert(first.renderWidth>0&&first.renderHeight>0);
  const old=page.workers().find(w=>w.url().includes('/upstream-discio-worker.js'));assert(old);
  const closed=new Promise(resolve=>old.once('close',resolve));
  // Device loss can terminate the worker before its evaluation reply arrives.
  await old.evaluate(()=>self.__destroyTestDevice()).catch(e=>{if(!/closed|destroyed|disposed/i.test(e.message))throw e;});
  await page.locator('#gamecube-failure').waitFor({state:'visible',timeout:60000});
  assert.match(await page.locator('#gamecube-failure-detail').textContent(),/GPU|device/i);
  await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Failed worker was not terminated')),10000))]);
  assert(await page.evaluate(()=>__session.closed&&!WrcadGameCube.ready));
  console.log('PASS real GPUDevice loss terminates the native worker and displays restart/library recovery');
  await page.getByRole('button',{name:'Restart game',exact:true}).click();
  await page.waitForFunction(()=>globalThis.__session?.booted&&!__session.closed,null,{timeout:120000});
  assert.equal(await page.locator('#gamecube-failure').isVisible(),false);
  assert.notEqual(page.workers().find(w=>w.url().includes('/upstream-discio-worker.js')),old);
  const restarted=await waitFrames(300);assert(restarted.renderWidth>0&&restarted.renderHeight>0);
  const diag=await page.evaluate(()=>__session.adapter.request('rendererDiagnostics'));
  assert.deepEqual(diag.errors,[]);assert.deepEqual(diag.fatalStatusHistory,[]);assert.equal(diag.gpuResources.shaderFail,0);
  console.log('PASS restart boots the retained streamed game on a fresh canvas/worker/device and advances native frames',JSON.stringify({frame:restarted.frame,resources:diag.gpuResources}));
  await page.evaluate(()=>WrcadGameCube.exit());assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
