/* Real pinned NES SaveManager/ZIP/state slots, using an original minimal ROM and fake Dropbox. */
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN;
if(!origin)throw new Error('WEBRCADE_TEST_ORIGIN must point at an isolated image with current generated overlays/assets.');
const config={storagePrefix:'dropbox-native-fixture',appName:'Dropbox native test',enabled:false,autoRedirect:false,accessAllowed:true,server:'',
 dropbox:{enabled:true,appKey:'fixture-app',saveFolder:''}};
// Original NROM program: disable interrupts, initialize stack, loop. Battery RAM enabled.
const rom=Buffer.alloc(16+16384+8192);Buffer.from([0x4e,0x45,0x53,0x1a,1,1,2]).copy(rom);
Buffer.from([0x78,0xd8,0xa2,0xff,0x9a,0x4c,0x05,0x80]).copy(rom,16);
for(const offset of [0x3ffa,0x3ffc,0x3ffe]){rom[16+offset]=0;rom[16+offset+1]=0x80;}
(async()=>{
 for(const engine of [chromium,webkit].filter(e=>!process.env.WEBRCADE_TEST_ENGINES||process.env.WEBRCADE_TEST_ENGINES.split(',').includes(e.name()))){
  const browser=await engine.launch({headless:true,...(engine===chromium?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{})});
  try{
   const remote=new Map();let revision=0;
   async function launch(){
    const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
    await context.addInitScript(({prefix})=>{
     localStorage.setItem(prefix+'.cloud.provider.v1','dropbox');
     localStorage.setItem(prefix+'.dropbox.connection.v1',JSON.stringify({uid:'alice',name:'Alice',appKey:'fixture-app',refreshToken:'fixture-refresh',accessToken:'fixture-access',expires:Date.now()+3600000}));
    },{prefix:config.storagePrefix});
    await context.route('**/cloud-saves/config.php',r=>r.fulfill({contentType:'application/javascript',body:'window.WrcadCloudConfig='+JSON.stringify(config)}));
    await context.route('**/fixture.nes',r=>r.fulfill({contentType:'application/octet-stream',body:rom}));
    await context.route(/^https:\/\/(content|api)\.dropboxapi\.com\/2\//,async r=>{
     const request=r.request(),route=new URL(request.url()).pathname,args=JSON.parse(request.headers()['dropbox-api-arg']||request.postData()),old=remote.get(args.path);
     if(route.endsWith('/files/upload')){
      if(args.mode['.tag']==='add'&&old||args.mode['.tag']==='update'&&args.mode.update!==old?.rev)return r.fulfill({status:409,json:{error_summary:'path/conflict/file/'}});
      const next={body:request.postDataBuffer(),rev:(++revision).toString(16).padStart(9,'0')};remote.set(args.path,next);return r.fulfill({json:{rev:next.rev}});
     }
     if(!old)return r.fulfill({status:409,json:{error_summary:'path/not_found/'}});
     if(route.endsWith('/files/get_metadata'))return r.fulfill({json:{rev:old.rev}});
     if(route.endsWith('/files/download'))return r.fulfill({contentType:'application/octet-stream',headers:{'Dropbox-API-Result':JSON.stringify({rev:old.rev}),'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Dropbox-API-Result'},body:old.body});
     throw new Error('Unexpected route '+route);
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const props={type:'nes',title:'Original save fixture',rom:origin+'/fixture.nes',uid:'dropbox-native-fixture'};
    await page.goto(origin+'/play/app/nes/?props='+encodeURIComponent(Buffer.from(encodeURIComponent(JSON.stringify(props))).toString('base64')));
    await page.waitForFunction(()=>window.app?.emulator?.saveManager,{timeout:45000});
    assert.equal(await page.evaluate(()=>WrcadCloud.providerName),'Dropbox');
    assert.equal(await page.evaluate(()=>app.emulator.saveManager.isCloudEnabled()),true);
    await page.evaluate(()=>{window.saveErrors=[];app.emulator.saveManager.errorCallback=e=>{if(e)saveErrors.push(e);};});
    return {page,context,errors};
   }
   const a=await launch(),b=await launch();
   assert.equal(await a.page.evaluate(async()=>{try{return await app.emulator.saveManager.save('/fixture/battery',[{name:'battery.sav',content:new Uint8Array([1,2,3])}]);}catch(e){throw new Error('Storage: '+e.type+' '+e.target?.error?.name+' '+e.target?.error?.message+' '+String(e));}}),true);
   assert.deepEqual(await b.page.evaluate(async()=>Array.from((await app.emulator.saveManager.load('/fixture/battery')).find(f=>f.name==='battery.sav').content)),[1,2,3]);
   assert.equal(await a.page.evaluate(()=>app.emulator.saveManager.save('/fixture/battery',[{name:'battery.sav',content:new Uint8Array([4,5,6])}])),true);
   assert.equal(await b.page.evaluate(()=>app.emulator.saveManager.save('/fixture/battery',[{name:'battery.sav',content:new Uint8Array([9,9,9])}])),false);
   assert.deepEqual(await b.page.evaluate(async()=>Array.from((await app.emulator.saveManager.loadLocal('/fixture/battery')).find(f=>f.name==='battery.sav').content)),[9,9,9]);
   await a.page.evaluate(()=>app.emulator.saveManager.saveState('/fixture/states/',1,new Uint8Array([11,12,13]),null,null));
   const slots=await b.page.evaluate(()=>app.emulator.saveManager.getStateSlots('/fixture/states/'));assert(slots[1].time>0);
   assert.deepEqual(await b.page.evaluate(async()=>Array.from(await app.emulator.saveManager.loadState('/fixture/states/',1))),[11,12,13]);
   assert.deepEqual(await a.page.evaluate(()=>saveErrors),[]);
   assert((await b.page.evaluate(()=>saveErrors)).some(e=>e.includes('changed on another device')));
     assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
   await a.context.close();await b.context.close();
   console.log('PASS '+engine.name()+' real NES SaveManager ZIPs, second-browser restore, stale-write preservation, native state listing and load through Dropbox');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
