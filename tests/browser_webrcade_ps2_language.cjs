/* Original homebrew asks the real HLE BIOS for language and displays its value. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://localhost:8443',fixture=process.env.PS2_LANGUAGE_ELF;
if(!fixture)throw Error('PS2_LANGUAGE_ELF must be generated with ps2_homebrew.py --language');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--disable-vulkan-surface','--ignore-gpu-blocklist']});
 try{
  for(const [locale,expected]of [['en-US',1],['fr-CA',2],['ja-JP',0],['zh-Hant-TW',10],['sv-SE',1]]){
   const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',hasTouch:true,locale,viewport:{width:390,height:844}});
   try{
    await context.addInitScript(()=>{let config;Object.defineProperty(window,'WrcadCloudConfig',{configurable:true,get:()=>config,set(v){config={...v,enabled:false,autoRedirect:false,storagePrefix:'ps2_language_private'};}});});
    if(process.env.PS2_LANGUAGE_APP){const app=process.env.PS2_LANGUAGE_APP;for(const filename of ['host.mjs','language.mjs'])await context.route('**/'+filename,route=>route.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(path.join(app,filename))}));for(const filename of ['Play.js','Play.wasm'])await context.route('**/core/'+filename,async route=>{const response=await route.fetch();await route.fulfill({response,body:fs.readFileSync(path.join(app,'core',filename))});});}
    await context.route('**/ps2-language-probe.elf',route=>{
     const bytes=fs.readFileSync(fixture),headers={'content-type':'application/octet-stream','content-length':String(bytes.length),etag:'"language-probe"'};
     if(route.request().method()==='HEAD')return route.fulfill({status:200,headers});
     const [,first,last]=/bytes=(\d+)-(\d+)/.exec(route.request().headers().range).map(Number),end=Math.min(last,bytes.length-1);
     return route.fulfill({status:206,headers:{...headers,'content-length':String(end-first+1),'content-range':`bytes ${first}-${end}/${bytes.length}`},body:bytes.subarray(first,end+1)});
    });
    const props={title:'PS2 original OSD language probe',type:'play-ps2',rom:origin+'/ps2-language-probe.elf',uid:'ps2-language-original-probe'},page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/experimental/ps2/?ctx=standalone&props='+encodeURIComponent(Buffer.from(encodeURIComponent(JSON.stringify(props))).toString('base64')));
    await page.waitForFunction(()=>window.WrcadPS2?.ready||!document.getElementById('failure').hidden,null,{timeout:120000});assert(await page.evaluate(()=>WrcadPS2.ready),await page.locator('#failure-detail').innerText());
    assert.equal(await page.evaluate(()=>WrcadPS2.module.getSystemLanguage()),expected);assert.equal(await page.evaluate(()=>WrcadPS2.module.cloudGpu.adapter.fallback),false);
    // RGBAQ's low byte is 1+16*guestOSDLanguage; green64/blue48 are fixed.
    await page.waitForFunction(value=>{const canvas=document.getElementById('outputCanvas'),copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);const p=ctx.getImageData(canvas.width>>1,canvas.height>>1,1,1).data;return Math.abs(p[0]-(1+16*value))<=1&&Math.abs(p[1]-64)<=1&&Math.abs(p[2]-48)<=1;},expected,{timeout:30000,polling:100});
    const frames=await page.evaluate(()=>WrcadPS2.module.getFrames());await page.evaluate(()=>WrcadPS2.exit({leave:false}));assert.deepEqual(errors,[]);console.log('PASS actual guest BIOS OSD language',JSON.stringify({locale,expected,frames}));
   }finally{await context.close();}
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
