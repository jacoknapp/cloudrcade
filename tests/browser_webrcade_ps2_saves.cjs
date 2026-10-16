// Real PS2 save adapter + ZIP/IndexedDB, with isolated session/provider failures.
const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../deploy/webrcade');
const bundle=process.env.WEBRCADE_PS2_UI_ROOT||path.resolve(__dirname,'../release/ps2/app');
(async()=>{for(const engine of [chromium,webkit]){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ps2-save-profile-'));
 const context=await engine.launchPersistentContext(profile,{headless:true,executablePath:engine===chromium?process.env.CHROME:process.env.WEBRCADE_TEST_WEBKIT_PATH,args:engine===chromium?['--no-sandbox']:[]});
 try{
  const page=await context.newPage();
  await page.route('https://saves.test/**',route=>{
   const name=new URL(route.request().url()).pathname.slice(1);
   const file=name==='save-sdk.mjs'?path.join(bundle,name):name==='saves.mjs'?path.join(process.env.WEBRCADE_PS2_ADAPTER_ROOT||path.join(root,'retro-play/app'),name):name==='bridge.js'?path.join(process.env.WEBRCADE_CLOUD_ROOT||path.join(root,'touch/cloud'),name):null;
   return route.fulfill({contentType:file?'text/javascript':'text/html',body:file?fs.readFileSync(file):'<html><body>PS2 save fixture</body></html>'});
  });
  await page.goto('https://saves.test/');
  await page.evaluate(()=>{
   const original=fetch;window.remote=new Map();window.puts=0;window.rejected=0;window.serverCsrf='initial';window.denied=false;window.lostAck=false;let revision=0;
   window.fetch=async(input,options={})=>{
    const url=new URL(input,location.href);if(url.pathname!=='/cloud-saves/api.php')return original(input,options);
    if(url.searchParams.get('action')==='status')return Response.json({csrf:serverCsrf});
    const headers=new Headers(options.headers),key=url.searchParams.get('path'),old=remote.get(key),method=options.method||'GET';
    if(headers.get('X-CSRF-Token')!==serverCsrf){rejected++;return Response.json({code:'csrf_invalid',error:'Refresh the page and try again.'},{status:403});}
    if(method==='PUT'){
     puts++;if(denied)return Response.json({code:'access_denied',error:'Cloud permission denied for this connection.'},{status:403});
     if(headers.get('If-None-Match')==='*'&&old||headers.get('If-Match')&&headers.get('If-Match')!==old?.etag)return Response.json({error:'conflict'},{status:409});
     // Consume the real Blob bytes, including file-backed IndexedDB recovery.
     const body=new Blob([await options.body.arrayBuffer()]),etag='"'+(++revision)+'"';remote.set(key,{body,etag});
     if(lostAck){lostAck=false;throw new TypeError('Fixture lost response after remote commit');}
     return new Response(null,{status:204,headers:{ETag:etag}});
    }
    return old?new Response(method==='HEAD'?null:old.body,{headers:{ETag:old.etag}}):Response.json({error:'missing'},{status:404});
   };
   window.WrcadCloudConfig={storagePrefix:'ps2-save-fixture',server:'https://cloud.test',enabled:true,accessAllowed:true,autoRedirect:false};
   localStorage.setItem('ps2-save-fixture.nextcloud.connection.v1',JSON.stringify({uid:'test',login:'test',password:'fake',server:'https://cloud.test'}));
  });
  await page.addScriptTag({url:'/bridge.js'});
  const result=await page.evaluate(async()=>{
   const {Ps2Saves}=await import('/saves.mjs');const adapter=new Ps2Saves({FS:{}},{title:'Original PS2 save fixture'},'fixture',()=>{});await adapter.initialize('fixture');window.adapter=adapter;
   const bytes=new Uint8Array(16*1024*1024);for(let i=0;i<bytes.length;i++)bytes[i]=(i*31+17)&255;window.stateBytes=bytes;
   serverCsrf='renewed-after-gameplay';
   const saved=await adapter.save(1,bytes,'data:image/png;base64,fixture');
   const loaded=await adapter.load(1),slots=await adapter.slots();
   return {saved,rejected,size:loaded.length,equal:loaded.every((v,i)=>v===bytes[i]),slot:!!slots[1],status:adapter.status};
  });
  assert.equal(result.saved,true);assert.equal(result.rejected,0);assert.equal(result.size,16*1024*1024);assert.equal(result.equal,true);assert.equal(result.slot,true);
  await page.evaluate(()=>{denied=true;});
  assert.equal(await page.evaluate(()=>adapter.save(2,stateBytes,null)),false);
  assert.match(await page.evaluate(()=>adapter.status),/saved locally; Cloud permission denied/);
  assert.equal(await page.evaluate(()=>adapter.busy),false);
  assert.equal(await page.evaluate(async()=>(await adapter.load(2)).length),16*1024*1024,'denied upload remains locally loadable');
  await page.evaluate(()=>{denied=false;});
  assert.equal(await page.evaluate(()=>adapter.save(2,stateBytes,null)),true);
  await page.evaluate(()=>{lostAck=true;});
  assert.equal(await page.evaluate(()=>adapter.save(3,stateBytes,null)),false);
  const before=await page.evaluate(()=>puts);
  assert.equal(await page.evaluate(async()=>(await adapter.load(3)).length),16*1024*1024);
  assert.equal(await page.evaluate(()=>puts),before,'lost acknowledgement reconciled without replacing remote');
  console.log('PASS',engine.name(),'actual PS2 adapter, 16MiB ZIP/IndexedDB, session expiry before PUT, denied-upload detail/local load/retry, lost acknowledgement and slot browsing');
 }finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
}})().catch(error=>{console.error(error);process.exitCode=1;});
