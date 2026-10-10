// Fresh contexts: runtime BIOS keys only; no personal account/save access.
const {chromium,webkit}=require('playwright');
const assert=require('assert/strict');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'http://localhost:18082';
const title=process.argv[2]||'Mario Kart 7';
const noKeys=process.env.WEBRCADE_TEST_NO_KEYS==='1';
const expectFailure=process.env.WEBRCADE_TEST_EXPECT_FAILURE==='1';
(async()=>{
 const browser=process.env.WEBRCADE_TEST_BROWSER==='webkit'?await webkit.launch({headless:true,...(process.env.WEBRCADE_TEST_WEBKIT_PATH?{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH}:{})}):await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
 const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1200,height:850}});
 await context.route('**/content/feeds/combined.json',async route=>{
 const url=new URL(route.request().url());const response=await route.fetch({url:origin+url.pathname+url.search});
 const data=JSON.parse(await response.text());
 function rewrite(value){if(typeof value==='string'&&/^https?:\/\//.test(value)){const url=new URL(value);if(url.pathname.startsWith('/content/'))return origin+url.pathname+url.search;}if(Array.isArray(value))return value.map(rewrite);if(value&&typeof value==='object')for(const k of Object.keys(value))value[k]=rewrite(value[k]);return value}
 await route.fulfill({response,body:JSON.stringify(rewrite(data))});
 });
 let keyRequests=0;context.on('request',r=>{if(r.url().includes('/cloud-saves/3ds-keys.php'))keyRequests++});
 // Disable real account interaction while retaining the actual mounted-key URL.
 await context.route('**/cloud-saves/config.php',async route=>{
   const response=await route.fetch();const body=(await response.text()).trim();
   const prefix='window.WrcadCloudConfig = ';assert(body.startsWith(prefix)&&body.endsWith(';'));
   const config=JSON.parse(body.slice(prefix.length,-1));config.enabled=false;config.autoRedirect=false;
   if(noKeys)config.n3dsKeysUrl='';
   await route.fulfill({response,body:prefix+JSON.stringify(config)+';'});
 });
 const page=await context.newPage();let missingKey=false;page.on('console',m=>{if(/Primary NCCH key is not available/.test(m.text()))missingKey=true});
 await page.goto(origin+'/play/?feed='+encodeURIComponent(origin+'/content/feeds/combined.json'));
 const ok=page.getByRole('button',{name:'OK',exact:true});await page.waitForTimeout(2000);if(await ok.count())await ok.first().click().catch(()=>{});
 await page.waitForFunction(()=>document.body.innerText.includes('Nintendo 3DS'));
 await page.evaluate(title=>{function find(n){if(!n)return null;if(n.stateNode?.browseScreenRef)return n.stateNode;return find(n.child)||find(n.sibling)}
 const library=find(document.getElementById('root')._reactRootContainer._internalRoot.current);
 const game=library.state.feed.getUniqueCategories().flatMap(c=>c.items).find(i=>i.type==='3ds'&&i.title.includes(title));
 if(!game)throw Error('Missing title');library.browseScreenRef.current.props.onAppSelected(game);},title);
 const frame=await (await page.waitForSelector('#webrcade-app-iframe')).contentFrame();
 if(expectFailure){
 const deadline=Date.now()+60000;while(!missingKey&&Date.now()<deadline)await page.waitForTimeout(500);
 assert(missingKey,'encrypted content must report missing external key');assert.equal(keyRequests,0);
 assert(await frame.evaluate(()=>{try{FS.stat('/home/web_user/retroarch/userdata/saves/Azahar/sysdata/keys.txt');return false}catch{return true}}),'no operator key file may be present');
 assert(await frame.evaluate(()=>!Object.values(window.Module?.nativeVertexStats||{}).some(v=>v>0)),'encrypted game must not issue 3DS graphics draws without keys');
 console.log('PASS encrypted NCCH reports missing external key; no BIOS key file present or fetched');await browser.close();return;
 }
 await frame.waitForFunction(()=>window.emulator?.mainStarted&&window.Module?._get_current_frame_count?.()>150,null,{timeout:180000});
 await frame.waitForFunction(()=>Object.values(window.Module?.nativeVertexStats||{}).some(v=>v>0),null,{timeout:60000});
 const keyExists=await frame.evaluate(()=>{try{return FS.stat('/home/web_user/retroarch/userdata/saves/Azahar/sysdata/keys.txt').size>0}catch{return false}});
 assert.equal(keyExists,!noKeys);assert.equal(keyRequests,noKeys?0:1);
 if(keyExists) assert(await frame.evaluate(()=>FS.lookupPath('/home/web_user/retroarch/userdata/saves/Azahar/sysdata/keys.txt').node.mount.type === FS.filesystems.MEMFS),'keys must stay in the memory filesystem');
 // Collect an ordinary battery-save ZIP and check its file names only.
 await frame.evaluate(async()=>{FS.writeFile('/home/web_user/retroarch/userdata/saves/Azahar/sdmc/runtime-bios-check.bin',new Uint8Array([1,2,3]));await emulator.saveState();const files=await emulator.getSaveManager().loadLocal(emulator.saveStatePath);
   if(!files?.some(f=>f.name==='sdmc/runtime-bios-check.bin'))throw Error('Ordinary save marker absent');
   if(files?.some(f=>f.name.startsWith('sysdata/')||f.name.endsWith('keys.txt')||f.name.endsWith('keys.bin')))throw Error('Key file entered save ZIP');});
 console.log('PASS',title,'boots beyond 150 frames with real 3DS graphics draws; runtime key presence='+keyExists+'; fetches='+keyRequests+'; keys excluded from ordinary save ZIP');
 await browser.close();
 }catch(e){await browser.close();throw e}
})().catch(e=>{console.error(e.message);process.exitCode=1});
