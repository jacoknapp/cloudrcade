/* Actual browser Fetch/AbortController semantics for the PS2 range reader. */
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),{chromium,webkit}=require('playwright');
let origin=process.env.WEBRCADE_TEST_ORIGIN,server;
const rangeBytes=512*1024;
const modulePath=process.env.PS2_STREAM_MODULE||path.resolve(__dirname,'../deploy/webrcade/retro-play/app/disc.mjs');
const matrixPath=path.resolve(__dirname,'fixtures/ps2-disc-matrix.mjs'),httpRanges=[];
(async()=>{
 // With no deployed origin this is an owned, real HTTP partial-body fixture.
 // It needs no stage/container, native binaries, game, GPU or operator route.
 if(!origin){
  server=http.createServer((req,res)=>{
   if(req.url==='/experimental/ps2/disc.mjs'||req.url==='/ps2-disc-matrix.mjs'){
    res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(req.url.endsWith('disc.mjs')?modulePath:matrixPath));return;
   }
   if(req.url!=='/ps2-stream-fixture.iso'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>PS2 disc transport fixture</title>');return;}
   const size=40*2*1024**2;res.setHeader('ETag','"v1"');res.setHeader('Content-Length',size);
   if(req.method==='HEAD'){res.end();return;}
   const match=/bytes=(\d+)-(\d+)/.exec(req.headers.range||'');if(!match){res.writeHead(400);res.end();return;}
   const first=Number(match[1]),last=Number(match[2]);httpRanges.push(first/rangeBytes);
   res.writeHead(206,{'Content-Length':last-first+1,'Content-Range':`bytes ${first}-${last}/${size}`});
   const bytes=Buffer.alloc(last-first+1,first/rangeBytes);
   if(first>0&&first<20*rangeBytes){res.write(bytes.subarray(0,1024));const timer=setTimeout(()=>res.end(bytes.subarray(1024)),1500);res.on('close',()=>clearTimeout(timer));}
   else res.end(bytes);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 }
 for(const engine of [chromium,webkit]){
  const executablePath=engine===chromium?process.env.PS2_STREAM_CHROMIUM_EXECUTABLE:process.env.PS2_STREAM_WEBKIT_EXECUTABLE;
  const browser=await engine.launch({headless:true,executablePath,args:engine===chromium?['--no-sandbox']:[]});
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
  try{
   if(process.env.PS2_STREAM_MODULE)await context.route('**/experimental/ps2/disc.mjs',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(modulePath)}));
   await context.route('**/ps2-disc-matrix.mjs',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(matrixPath)}));
   const ranges=server?httpRanges:[];ranges.length=0;
   if(!server)await context.route('**/ps2-stream-fixture.iso',async route=>{
    const size=40*2*1024**2,headers={'content-length':String(size),etag:'"v1"'};
    if(route.request().method()==='HEAD')return route.fulfill({status:200,headers});
    const [,first,last]=/bytes=(\d+)-(\d+)/.exec(route.request().headers().range).map(Number);
    ranges.push(first/rangeBytes);
    // Hold speculation long enough to guarantee that the subsequent seek
    // cancels real Fetch/body work, rather than a pre-resolved fake promise.
    await new Promise(resolve=>setTimeout(resolve,first<20*rangeBytes&&first>0?1500:10));
    await route.fulfill({status:206,headers:{...headers,'content-length':String(last-first+1),'content-range':`bytes ${first}-${last}/${size}`},body:Buffer.alloc(last-first+1,Math.floor(first/rangeBytes))}).catch(()=>{});
   });
   const page=await context.newPage();await page.goto(origin+'/experimental/ps2/');
   const result=await page.evaluate(async()=>{
    const {remoteDisc,CHUNK}=await import('/experimental/ps2/disc.mjs'),disc=await remoteDisc('/ps2-stream-fixture.iso');
    const heap=new Uint8Array(2048);let aborted=0;
    const original=AbortController.prototype.abort;AbortController.prototype.abort=function(...args){aborted++;return original.apply(this,args);};
    try{
     await disc.read(0,256*1024);disc.copyCached(256*1024,2048,heap,0);
     await disc.read(256*1024+2048,CHUNK-256*1024-2048);
     await new Promise(resolve=>setTimeout(resolve,50));
     const pendingBytes=disc.cachedBytes,start=performance.now();
     const bytes=await disc.read(30*CHUNK,2048),seekMs=performance.now()-start;
     await disc.read(30*CHUNK+2048,CHUNK-2048);
     disc.close();await new Promise(resolve=>setTimeout(resolve,50));
     return{pendingBytes,seekMs,byte:bytes[0],aborted,cachedAfterClose:disc.cachedBytes};
    }finally{disc.close();AbortController.prototype.abort=original;}
   });
   assert.equal(result.pendingBytes,5*rangeBytes);assert.equal(result.byte,30);
   assert(result.seekMs<1400,'foreground seek must not wait for unrelated 1500ms speculation');
   assert(result.aborted>=5);assert.equal(result.cachedAfterClose,0);
   assert(ranges.includes(1)&&ranges.includes(2)&&ranges.includes(30));
   console.log('PASS PS2 '+engine.name()+' real Fetch read-ahead, foreground seek cancellation and bounded close',JSON.stringify(result));
   const matrix=await page.evaluate(async()=>{
    const module=await import('/experimental/ps2/disc.mjs');
    const {discMatrix}=await import('/ps2-disc-matrix.mjs');return discMatrix(module);
   });
   assert.equal(matrix.scenarios,13);assert.equal(matrix.budgetBytes,16*1024**2);
   console.log('PASS PS2 '+engine.name()+' delayed-abort/full-budget/strict-integrity matrix',JSON.stringify(matrix));
  }finally{await context.close();await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{server?.closeAllConnections();server?.close();});
