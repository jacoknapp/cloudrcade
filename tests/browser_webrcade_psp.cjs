/* Actual PSP core lifecycle. Use an operator-owned game or
 * upstream open-source homebrew demo, served by the test instance.
 * WEBRCADE_TEST_ORIGIN=https://localhost:8443 PSP_TEST_ROM=/content/demo.elf
 * NODE_PATH=<Playwright modules> node tests/browser_webrcade_psp.cjs
 * Uses disposable browser storage and disables cloud accounts.
 */
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://localhost:8443';
const rom=process.env.PSP_TEST_ROM;
if(!rom) throw new Error('PSP_TEST_ROM must name a test game URL.');
const engine=process.env.WEBRCADE_TEST_BROWSER==='webkit'?webkit:chromium;
const config={appName:'PSP Test',storagePrefix:'psp_test',enabled:false,autoRedirect:false,
  enable3DS:false,feedUrl:'/content/feeds/combined.json'};
(async()=>{
  const browser=await engine.launch({headless:true,...(engine===chromium?{
    executablePath:process.env.CHROME,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  }:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH})});
  const errors=[],logs=[];
  try {
    const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',
      hasTouch:true,viewport:{width:390,height:844}});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{logs.push(m.text());if(process.env.PSP_TEST_DEBUG)console.log(m.text());});
    await page.route('**/cloud-saves/config.php',r=>r.fulfill({contentType:'application/javascript',
      body:'window.WrcadCloudConfig='+JSON.stringify(config)+';'}));
    // The library resolves the PSP alias to this canonical core identifier.
    const props={title:'PSP homebrew',type:'retro-ppsspp',rom:new URL(rom,origin).href};
    const url=origin+'/play/app/retro-ppsspp/?ctx=standalone&props='+encodeURIComponent(Buffer.from(encodeURIComponent(JSON.stringify(props))).toString('base64'));
    await page.goto(url);
    await page.waitForFunction(()=>window.emulator?.mainStarted&&window.Module?._get_current_frame_count()>120,null,{timeout:180000});
    if(await page.locator('.release-screen-content').isVisible())await page.locator('.release-screen-content').tap();
    await page.waitForFunction(()=>emulator.loopResumed);
    await page.locator('.kt-pad').waitFor({state:'visible'});
    const resources=await page.evaluate(()=>({frames:Module._get_current_frame_count(),heap:Module.HEAPU8.length,
      workers:Module.PThread.runningWorkers.length+Module.PThread.unusedWorkers.length,audio:Module.RWA.context.state}));
    console.log('PSP resources',JSON.stringify(resources));
    // PPSSPP uses six pool workers plus loader, rendering and I/O threads.
    assert(resources.workers<=12,'bounded worker startup');
    assert(resources.heap<1024*1024*1024,'bounded startup memory');
    assert(await page.locator('.kt-extra-dpad').isVisible());
    assert.equal(await page.locator('[data-cid="10"]').isVisible(),false,'PSP has no L2');
    assert.equal(await page.locator('[data-cid="11"]').isVisible(),false,'PSP has no R2');
    assert((await page.locator('[data-cid="4"]').innerText()).includes('✕'));
    assert((await page.locator('[data-cid="5"]').innerText()).includes('○'));
    await page.evaluate(()=>{window.inputs=[];const original=Module._simulate_input;
      Module._simulate_input=(...args)=>{inputs.push(args);return original(...args)};});
    const stick=await page.locator('.kt-stick').first().boundingBox();
    await page.mouse.move(stick.x+stick.width*.8,stick.y+stick.height*.5);await page.mouse.down();
    await page.waitForTimeout(200);assert(await page.evaluate(()=>inputs.some(i=>i[1]===16&&i[2]>0)));
    await page.mouse.up();await page.waitForTimeout(100);
    await page.locator('.kt-menu').tap();await page.waitForFunction(()=>app.isPauseScreen());
    const frames=await page.evaluate(()=>Module._get_current_frame_count());
    await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>Module._get_current_frame_count()),frames);
    const marker='/home/web_user/retroarch/userdata/saves/PSP/SAVEDATA/cloudrcade-test.bin';
    await page.evaluate(async path=>{emulator.mkdirs(FS,path.substring(0,path.lastIndexOf('/')));
      FS.writeFile(path,new Uint8Array([12,34,56]));await emulator.saveState();},marker);
    await page.evaluate(()=>emulator.saveStateForSlot(1));
    // Native state-slot menus require a cloud account. Exercise the core's
    // round trip using the local backup without connecting an account.
    await page.evaluate(async()=>{
      const files=await emulator.getSaveManager().loadLocal(emulator.saveStatePrefix+'state.1');
      const state=files?.find(f=>f.name==='state')?.content;
      if(!state?.length)throw new Error('Local state backup is empty');
      FS.writeFile('/home/web_user/retroarch/userdata/states/game.state',state);
      Module._cmd_load_state();
    });
    await page.getByText('Resume',{exact:true}).click();
    await page.waitForFunction(n=>Module._get_current_frame_count()>n+20,frames);
    await page.screenshot({path:process.env.PSP_TEST_SCREENSHOT||'/tmp/cloudrcade-psp-native.png'});
    await page.reload();await page.waitForFunction(()=>window.emulator?.mainStarted,null,{timeout:180000});
    assert.deepEqual(await page.evaluate(path=>Array.from(FS.readFile(path)),marker),[12,34,56]);
    await page.evaluate(async()=>{emulator.pause(true);await app.onPreExit();});
    assert.equal(await page.evaluate(()=>Module.PThread.runningWorkers.length+Module.PThread.unusedWorkers.length),0);
    assert.equal(await page.evaluate(()=>Module.RWA.context.state),'closed');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS',engine.name(),'real PSP launch/frames, controller input, pause/resume, local saves/state/reload and worker/audio cleanup');
  } catch(error) {console.error(logs.slice(-45).join('\n'));throw error;}
  finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
