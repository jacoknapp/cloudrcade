// Real browser range requests and cancellation; synthetic bytes only, no game files.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'../deploy/webrcade/retro-azahar/app/src/emulator');
const chunk=2*1024*1024,size=chunk*20+17,requests=[];
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Range fixture</title>');return;}
 if(req.url==='/reader.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(root,'lazyrom.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'read-ahead-rom.js'),'utf8').replace(/^import .*?;\n/,''));return;}
 const m=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range||'');if(!m){res.writeHead(400);res.end();return;}
 const first=+m[1],last=+m[2];requests.push([first,last]);
 const timer=setTimeout(()=>{if(res.destroyed)return;res.writeHead(206,{'Content-Type':'application/octet-stream','Content-Range':`bytes ${first}-${last}/${size}`,'Content-Length':last-first+1});res.end(Buffer.alloc(last-first+1,Math.floor(first/chunk)));},req.url==='/slow.bin'?150:5);
 res.on('close',()=>clearTimeout(timer));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,...(engine===chromium?{...(process.env.CHROME?{executablePath:process.env.CHROME}:{}),args:['--no-sandbox']}:{...(process.env.WEBRCADE_TEST_WEBKIT_PATH?{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH}:{})})});
  try{
   const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
   const before=requests.length;
   const startup=await page.evaluate(async ({size,chunk})=>{
    const {ReadAheadRom}=await import('/reader.js');
    const reader=new ReadAheadRom('/game.bin',size);
    const header=await reader.readHeader();
    const count=reader.read(new Uint8Array(8),0,8,chunk-8);
    reader.close();
    return {header:header.length,count,misses:reader.readAheadStats.misses};
   }, {size,chunk});
   assert.deepEqual(startup,{header:65536,count:8,misses:0});
   assert.deepEqual(requests.slice(before),[[0,chunk-1]],'startup and the first demand share one request');
   await page.evaluate(async ({size,chunk})=>{const {ReadAheadRom}=await import('/reader.js');window.rom=new ReadAheadRom('/game.bin',size);window.bytes=new Uint8Array(8);rom.read(bytes,0,8,chunk-32);rom.read(bytes,0,8,chunk-24);}, {size,chunk});
   await page.waitForFunction(()=>rom.readAheadStats.prefetched===1);
   assert.deepEqual(await page.evaluate(chunk=>{rom.read(bytes,0,8,chunk);return {data:[...bytes],hits:rom.readAheadStats.prefetchHits,misses:rom.readAheadStats.misses,budget:rom.chunks.size+Number(!!rom.pending)};},chunk),{data:Array(8).fill(1),hits:1,misses:1,budget:2});
   await page.evaluate(async ({size,chunk})=>{rom.close();const {ReadAheadRom}=await import('/reader.js');window.rom=new ReadAheadRom('/slow.bin',size);rom.prefetch(2);rom.getChunk(2);if(rom.pending!==null)throw Error('Demand did not cancel read-ahead');rom.prefetch(3);rom.close();}, {size,chunk});
   await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>rom.chunks.size),0);assert.deepEqual(errors,[]);
   console.log('PASS',engine.name(),'one-request startup, binary prefetch hit, sync fallback, cancellation and closed cache');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
