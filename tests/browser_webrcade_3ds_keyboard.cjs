// Test the compiled WASM-import keyboard bridge, native prompt and continued frames in a fresh profile.
// Requires Playwright, a combined feed and the built app at WEBRCADE_TEST_ORIGIN.
const {chromium,webkit,devices}=require('playwright');
const assert=require('assert/strict');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'http://localhost:18082';
(async()=>{
 const engine=process.argv[2]||'webkit';
 const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{...(process.env.CHROME?{executablePath:process.env.CHROME}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}: {})});
 try {
  const context=await browser.newContext({...devices['iPhone 13'],viewport:{width:402,height:874},serviceWorkers:'block'});
  await context.addInitScript(()=>{
   let factory;
   Object.defineProperty(window,'EJS_Runtime',{configurable:true,get:()=>factory,set:f=>{
    factory=options=>{
     options.instantiateWasm=(imports,receive)=>{
      const env=imports.env||imports.a;
      window.keyboardBridge=Object.values(env).find(fn=>typeof fn==='function'&&fn.toString().includes('getInputText'));
      WebAssembly.instantiateStreaming(fetch(options.locateFile('azahar_libretro.wasm')),imports)
       .then(({instance,module})=>receive(instance,module));
      return {};
     };
     return f(options);
    };
   }});
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const feed=await (await context.request.get(origin+'/content/feeds/combined.json')).json();
  const game=feed.categories.flatMap(c=>c.items).find(i=>i.title.includes('Ultra Moon'));assert(game);
  const props=Buffer.from(encodeURIComponent(JSON.stringify({type:'3ds',title:game.title,...game.props}))).toString('base64');
  await page.goto(origin+'/play/app/retro-azahar/?ctx=standalone&props='+encodeURIComponent(props));
  await page.waitForFunction(()=>window.Module?._get_current_frame_count()>150,null,{timeout:120000});
  assert(await page.evaluate(()=>typeof keyboardBridge==='function'),'compiled WASM keyboard import must be captured');
  page.once('dialog',dialog=>{assert.match(dialog.message(),/Trainer name/);dialog.accept('Trainer');});
  const result=await page.evaluate(()=>{
   const hint=Module.stringToNewUTF8('Trainer name');const result=keyboardBridge(hint,12,0);Module._free(hint);
   if(typeof result!=='number')throw Error('Keyboard unwound instead of returning synchronously');
   const text=Module.UTF8ToString(result);Module._free(result);return text;
  });
  assert.equal(result,'Trainer');
  const frame=await page.evaluate(()=>Module._get_current_frame_count());
  await page.waitForFunction(n=>Module._get_current_frame_count()>n+60,frame,{timeout:60000});
  page.once('dialog',dialog=>dialog.dismiss());assert.equal(await page.evaluate(()=>keyboardBridge(0,12,0)),0);
  assert.deepEqual(errors,[]);
  await page.evaluate(async()=>{emulator.pause(true);await app.onPreExit();});
  console.log('PASS',engine,'compiled keyboard import: native prompt, synchronous UTF-8 result, cancellation and continued frames');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
