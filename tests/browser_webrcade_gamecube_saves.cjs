// Actual GameCube ZIP/IndexedDB/shared-cloud bridge; synthetic account transport.
const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../deploy/webrcade');
const bundle=process.env.WEBRCADE_GAMECUBE_UI_ROOT||path.resolve(__dirname,'../release/gamecube/app');
(async()=>{for(const engine of[chromium,webkit]){
 const profile=fs.mkdtempSync('/tmp/gamecube-save-profile-');
 const browser=await engine.launchPersistentContext(profile,{executablePath:engine===chromium?process.env.CHROME:process.env.WEBRCADE_TEST_WEBKIT_PATH,args:engine===chromium?['--no-sandbox']:[]});
 try{
  const context=browser,page=await context.newPage();
  await page.route('https://saves.test/**',async route=>{
   const url=new URL(route.request().url()),name=url.pathname.slice(1);
   if(name==='save-sdk.mjs')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(bundle,name))});
   if(name==='bridge.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'touch/cloud/bridge.js'))});
   return route.fulfill({contentType:'text/html',body:'<html><body>Save fixture</body></html>'});
  });
  await page.goto('https://saves.test/');
  await page.evaluate(()=>{
   const nativeFetch=window.fetch,remote=new Map();let revision=0;
   window.testWrites=[];window.testOffline=false;
   window.fetch=async(url,options={})=>{
    const query=new URL(url,location.href);
    if(query.pathname!=='/cloud-saves/api.php')return nativeFetch(url,options);
    if(query.searchParams.get('action')==='status')return Response.json({csrf:'fixture'});
    if(testOffline)return Response.json({error:'offline fixture'},{status:502});
    const key=query.searchParams.get('path'),old=remote.get(key),method=options.method||'GET';
    if(method==='PUT'){
     const headers=new Headers(options.headers);
     if((headers.get('If-None-Match')==='*'&&old)||(headers.get('If-Match')&&headers.get('If-Match')!==old?.etag))return Response.json({error:'conflict'},{status:409});
     const record={body:new Blob([options.body]),etag:'"'+(++revision)+'"'};remote.set(key,record);testWrites.push(key);
     return new Response('',{headers:{ETag:record.etag}});
    }
    return old?new Response(method==='HEAD'?null:old.body,{headers:{ETag:old.etag}}):Response.json({error:'missing'},{status:404});
   };
   window.WrcadCloudConfig={storagePrefix:'save-fixture',server:'https://cloud.test',enabled:true,accessAllowed:true,autoRedirect:false};
   localStorage.setItem('save-fixture.nextcloud.connection.v1',JSON.stringify({uid:'test',login:'test',password:'fake',server:'https://cloud.test'}));
  });
  await page.addScriptTag({url:'/bridge.js'});
  const result=await page.evaluate(async()=>{
   const sdk=await import('/save-sdk.mjs');window.sdk=sdk;WrcadCloud.install(sdk);await sdk.settings.load();

   const manager=new sdk.SaveManager({getTitle:()=> 'Isolated save fixture'},()=>{});
   manager.createZip=sdk.createSaveZip;manager.getFiles=blob=>sdk.readSaveZip(blob);manager.getSaveMetadata=blob=>sdk.readSaveZip(blob,true);window.manager=manager;
   const bytes=new Uint8Array(16*1024*1024);for(let i=0;i<bytes.length;i++)bytes[i]=(i*31+17)&255;
   const files=[{name:'state',content:new Blob([bytes])},{name:'meta.json',content:new Blob(['{"time":123}'])}];
   const zip=await sdk.createSaveZip(files),header=new DataView(await zip.slice(0,30).arrayBuffer());
   const restored=await sdk.readSaveZip(zip),out=new Uint8Array(await restored[0].content.arrayBuffer());
   const legacy=await sdk.SaveManager.prototype.createZip.call(manager,files);
   const legacyRead=await sdk.readSaveZip(legacy),oldReader=await sdk.SaveManager.prototype.getFiles.call(manager,zip);
   if(legacyRead[0].content.size!==bytes.length||oldReader[0].content.length!==bytes.length||oldReader[0].content.some((v,i)=>v!==bytes[i]))throw new Error('Old/new ZIP compatibility failed');
   if(out.length!==bytes.length||out.some((v,i)=>v!==bytes[i]))throw new Error('ZIP roundtrip mismatch');
   // Corrupt only snapshot payload: metadata browsing must never inflate it,
   // while an actual load must catch CRC damage rather than passing it to WASM.
   const offset=30+header.getUint16(26,true)+header.getUint16(28,true);
   const corrupt=new Blob([zip.slice(0,offset),new Uint8Array([0]),zip.slice(offset+1)]);
   const metadata=await sdk.readSaveZip(corrupt,true);let crc=false;
   try{await sdk.readSaveZip(corrupt);}catch(error){crc=/CRC/.test(String(error));}
   try { await manager.save('gamecube/test/states/1',files); } catch(error) {throw new Error('save: '+(error.target?.error?.name||error.name)+': '+(error.target?.error?.message||error.message));}
   const inspected=await manager.inspectSave('gamecube/test/states/1');
   const loaded=await manager.load('gamecube/test/states/1');
   return {method:header.getUint16(8,true),size:out.length,blob:restored[0].content instanceof Blob,metadataOnly:metadata[0].content===undefined,crc,inspected:inspected[0].content===undefined,time:JSON.parse(await inspected[1].content.text()).time,loadedBytes:loaded[0].content.size};
  });
  assert.deepEqual(result,{method:0,size:16*1024*1024,blob:true,metadataOnly:true,crc:true,inspected:true,time:123,loadedBytes:16*1024*1024});
  assert.equal(await page.evaluate(()=>testWrites.length),1,'read-only metadata cannot rewrite the snapshot');
  await page.evaluate(()=>{testOffline=true;});
  await page.evaluate(async()=>{await manager.save('gamecube/test/states/1',[{name:'state',content:new Blob(['pending'])},{name:'meta.json',content:new Blob(['{"time":456}'])}]);});
  await page.evaluate(()=>{testOffline=false;});
  assert.equal(await page.evaluate(async()=>JSON.parse(await (await manager.inspectSave('gamecube/test/states/1')).find(f=>f.name==='meta.json').content.text()).time),456,'pending local progress wins during browsing');
  assert.equal(await page.evaluate(()=>testWrites.length),1,'browsing does not flush incomplete metadata');
  await page.evaluate(async()=>{await manager.load('gamecube/test/states/1');});assert.equal(await page.evaluate(()=>testWrites.length),2,'normal loading still retries pending full bytes');
  assert.equal(await page.evaluate(async()=>await (await manager.loadCloud('gamecube/test/states/1'))[0].content.text()),'pending');
  await page.evaluate(()=>{localStorage.setItem('save-fixture.nextcloud.connection.v1',JSON.stringify({uid:'other',login:'other',password:'fake',server:'https://cloud.test'}));});
  await assert.rejects(page.evaluate(()=>manager.inspectSave('gamecube/test/states/1')),/account changed/i);
  console.log('PASS',engine.name(),'16MiB stored ZIP/Blob roundtrip, CRC, payload-free metadata, real IndexedDB/cloud and pending recovery');
 }finally{await browser.close();fs.rmSync(profile,{recursive:true,force:true});}
}})().catch(error=>{console.error(error);process.exitCode=1;});
