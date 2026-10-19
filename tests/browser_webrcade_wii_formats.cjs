// Real native readers, synthetic containers and optional read-only operator discs.
// Override only an owned browser's responses for source/exact-package checks.
const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const origin=process.env.WEBRCADE_WII_ORIGIN||'https://127.0.0.1:18573';
const override=process.env.WEBRCADE_WII_OVERRIDE_ROOT;
const inventory=process.env.WEBRCADE_WII_FORMAT_INVENTORY ? JSON.parse(fs.readFileSync(process.env.WEBRCADE_WII_FORMAT_INVENTORY)) : [];
(async()=>{
 for(const engine of [chromium,webkit]){
  if(process.env.WII_FORMAT_ENGINE && process.env.WII_FORMAT_ENGINE!==engine.name())continue;
  const browser=await engine.launch(engine===chromium?{executablePath:process.env.CHROME,args:['--no-sandbox']}:{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH});
  try{
   const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   if(process.env.WII_FORMAT_DEBUG){page.on('console',m=>console.log(engine.name(),m.type(),m.text()));page.on('requestfailed',r=>console.log('request failed',r.url(),r.failure()));}
   await page.exposeFunction('formatProgress',url=>console.log(engine.name(),'inspect',url));
   await context.route('**/cloud-saves/config.php',r=>r.fulfill({contentType:'text/javascript',body:'window.WrcadCloudConfig={storagePrefix:"wii-format-test",enabled:false};'}));
   if(override)await context.route('**/experimental/wii/**',async route=>{
    const relative=decodeURIComponent(new URL(route.request().url()).pathname.split('/experimental/wii/')[1]||'index.html');
    // WebKit loses SharedArrayBuffer on an intercepted HTTPS navigation even
    // with isolation headers. Keep its real document; override modules only.
    if(relative==='index.html'||relative.startsWith('fixtures/'))return route.fallback();
    const root=path.resolve(override),file=path.resolve(root,relative||'index.html');assert(file.startsWith(root+path.sep));
    const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css','.svg':'image/svg+xml'};
    return route.fulfill({path:file,contentType:mime[path.extname(file)]||'application/octet-stream',headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'}});
   });
   for(const format of ['wbfs','ciso'])await context.route('**/fixtures/native-test.'+format,async route=>{
    const block=2*1024**2,size=format==='wbfs'?128*1024**2:128*1024**2+0x8000;
    const meta=Buffer.alloc(0x8000),header=Buffer.alloc(0x100);header.write('TEST01');header.writeUInt32BE(0x5d1c9ea3,24);header.write('Wii container fixture',32);
    let offset;
    if(format==='wbfs'){
     meta.write('WBFS');meta.writeUInt32BE(size/512,4);meta[8]=9;meta[9]=21;meta[12]=1;
     header.copy(meta,512);meta.writeUInt16BE(3,768);offset=3*block;
    }else{meta.write('CISO');meta.writeUInt32LE(block,4);meta.fill(1,8,72);offset=0x8000;}
    const [,first,last]=/^bytes=(\d+)-(\d+)$/.exec(route.request().headers().range||'').map(Number);
    assert(last-first+1<=block,'native HTTP reads remain chunked');
    const body=Buffer.alloc(last-first+1);
    for(const [data,at] of [[meta,0],[header,offset]]){
     const a=Math.max(first,at),b=Math.min(last+1,at+data.length);if(b>a)data.copy(body,a-first,a-at,b-at);
    }
    await route.fulfill({status:206,body,headers:{'Content-Type':'application/octet-stream','Content-Range':`bytes ${first}-${last}/${size}`,'ETag':'"container-fixture-v1"'}});
   });
   await page.goto(origin+'/experimental/wii/');
   if(override)assert.match(fs.readFileSync(path.join(override,'index.html'),'utf8'),/accept="\.iso,\.wbfs,\.ciso"/);
   else assert.equal(await page.locator('#disc').getAttribute('accept'),'.iso,.wbfs,.ciso');
   const rows=[...['wbfs','ciso'].map(ext=>({url:'./fixtures/native-test.'+ext,gameId:'TEST01'})),...inventory.map(row=>({...row,url:new URL(row.url,origin).pathname}))];
   const results=await page.evaluate(async rows=>{
    const {remoteDisc}=await import('./transport.mjs');
    const {UpstreamWorkerAdapter}=await import('./vendor/src/upstream-worker-adapter.js');
    const adapter=new UpstreamWorkerAdapter({videoBackend:'Null',ppcWasmJit:false,noJitCache:true}),results=[];
    try{
     await adapter.load();
     for(const row of rows){
      await window.formatProgress(row.url);
      const disc=await remoteDisc(row.url),metadata=await adapter.request('mountUrl',{...disc,inspectOnly:true});
      const {stream}=await adapter.request('streamStats');
      results.push({url:row.url,expectedId:row.gameId,gameId:metadata.gameId,platform:metadata.platform,format:disc.format,remote:disc.remote,bytes:stream.bytesFetched,cachedBytes:stream.cachedBytes,cachedChunks:stream.cachedChunks,boot:metadata.coreBoot});
     }
     return results;
    }finally{adapter.rejectAll('Owned format inspection complete');adapter.worker?.terminate();}
   },rows);
   for(const r of results){
    assert.equal(r.gameId,r.expectedId,r.url);assert.equal(r.platform,'Wii');assert(r.remote);assert(!r.boot.attempted);
    assert(r.cachedChunks<=8&&r.cachedBytes<=16*1024**2);assert(r.bytes<32*1024**2,'inspection never downloads a whole disc');
   }
   assert.deepEqual(errors,[]);console.log(JSON.stringify({engine:engine.name(),results},null,2));await context.close();
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
