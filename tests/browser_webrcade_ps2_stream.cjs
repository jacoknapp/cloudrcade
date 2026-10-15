/* Actual browser Fetch/AbortController semantics for the PS2 range reader. */
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://localhost:8443';
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,args:engine===chromium?['--no-sandbox']:[]});
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
  try{
   if(process.env.PS2_STREAM_MODULE){const fs=require('node:fs');await context.route('**/experimental/ps2/disc.mjs',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(process.env.PS2_STREAM_MODULE)}));}
   const ranges=[];let held=0;
   await context.route('**/ps2-stream-fixture.iso',async route=>{
    const size=40*2*1024**2,headers={'content-length':String(size),etag:'"v1"'};
    if(route.request().method()==='HEAD')return route.fulfill({status:200,headers});
    const [,first,last]=/bytes=(\d+)-(\d+)/.exec(route.request().headers().range).map(Number);
    ranges.push(first/(2*1024**2));held++;
    // Hold speculation long enough to guarantee that the subsequent seek
    // cancels real Fetch/body work, rather than a pre-resolved fake promise.
    await new Promise(resolve=>setTimeout(resolve,first<20*2*1024**2&&first>0?1500:10));
    await route.fulfill({status:206,headers:{...headers,'content-length':String(last-first+1),'content-range':`bytes ${first}-${last}/${size}`},body:Buffer.alloc(last-first+1,Math.floor(first/(2*1024**2)))}).catch(()=>{});held--;
   });
   const page=await context.newPage();await page.goto(origin+'/experimental/ps2/');
   const result=await page.evaluate(async()=>{
    const {remoteDisc,CHUNK}=await import('/experimental/ps2/disc.mjs'),disc=await remoteDisc('/ps2-stream-fixture.iso');
    const heap=new Uint8Array(2048);let aborted=0;
    const original=AbortController.prototype.abort;AbortController.prototype.abort=function(...args){aborted++;return original.apply(this,args);};
    try{
     await disc.read(0,2048);disc.copyCached(2048,2048,heap,0);
     await new Promise(resolve=>setTimeout(resolve,50));
     const pendingBytes=disc.cachedBytes,start=performance.now();
     const bytes=await disc.read(30*CHUNK,2048),seekMs=performance.now()-start;
     disc.copyCached(30*CHUNK+2048,2048,heap,0);
     disc.close();await new Promise(resolve=>setTimeout(resolve,50));
     return{pendingBytes,seekMs,byte:bytes[0],aborted,cachedAfterClose:disc.cachedBytes};
    }finally{disc.close();AbortController.prototype.abort=original;}
   });
   assert.equal(result.pendingBytes,6*1024**2);assert.equal(result.byte,30);
   assert(result.seekMs<1400,'foreground seek must not wait for unrelated 1500ms speculation');
   assert(result.aborted>=5);assert.equal(result.cachedAfterClose,0);
   assert(ranges.includes(1)&&ranges.includes(2)&&ranges.includes(30));
   console.log('PASS PS2 '+engine.name()+' real Fetch read-ahead, foreground seek cancellation and bounded close',JSON.stringify(result));
  }finally{await context.close();await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
