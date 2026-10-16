/* PS2 mobile streaming: held network responses, read-ahead, seeks and memory. */
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
(async()=>{
 const {remoteDisc,CHUNK,LIMIT,AHEAD}=await import(pathToFileURL(path.resolve(__dirname,'../deploy/webrcade/retro-play/app/disc.mjs')));
 global.location={href:'https://arcade.test/play/'};
 const size=100*CHUNK+123,requests=[],pending=new Set();
 let peak=0,disc;
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 global.fetch=async(url,options)=>{
  if(options.method==='HEAD')return new Response(null,{headers:{'Content-Length':String(size),ETag:'"v1"'}});
  const [,first,last]=/bytes=(\d+)-(\d+)/.exec(options.headers.Range).map(Number);
  assert.equal(options.headers['If-Range'],'"v1"');
  const request={index:Math.floor(first/CHUNK),first,last,aborted:false};requests.push(request);pending.add(request);
  peak=Math.max(peak,disc?.cachedBytes||0);
  return new Promise((resolve,reject)=>{
   const abort=()=>{request.aborted=true;pending.delete(request);reject(new DOMException('cancelled','AbortError'));};
   request.release=(mode='good')=>{
    if(!pending.delete(request))return;
    options.signal.removeEventListener('abort',abort);
    if(mode==='transport'){reject(new TypeError('connection reset'));return;}
    const length=last-first+1,bytes=new Uint8Array(mode==='short'?length-1:length).fill(request.index%251);
    const body=mode==='body'?new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,64));controller.error(new TypeError('body reset'));}}):bytes;
    resolve(new Response(body,{status:206,headers:{'Content-Range':`bytes ${first}-${last}/${size}`,ETag:mode==='changed'?'"v2"':'"v1"'}}));
   };
   options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();
  });
 };
 const next=index=>{const request=[...pending].find(r=>r.index===index);assert(request,`range ${index} pending`);return request;};
 const opening=remoteDisc('/content/ps2/test.iso');await tick();next(0).release();disc=await opening;
 assert.equal(requests.length,1,'initial probe must not speculate');
 assert.equal(requests[0].last+1,512*1024,'cold metadata must not wait for a full2MiB download');
 assert.equal(CHUNK*LIMIT,16*1024**2,'smaller ranges retain the existing memory budget');
 // A random metadata seek loads only its requested chunk.
 let read=disc.read(10*CHUNK,2048);await tick();next(10).release();await read;
 assert.equal(requests.length,2,'single metadata read must not speculate');
 const heap=new Uint8Array(4096);
 assert.equal(disc.copyCached(10*CHUNK+2048,2048,heap,0),2048);
 assert.equal(requests.length,2,'a few adjacent metadata sectors must not trigger read-ahead');
 await disc.read(10*CHUNK+4096,256*1024-4096);
 assert.deepEqual([...pending].map(r=>r.index),[11],'256KiB of demand starts one future chunk');
 await disc.read(10*CHUNK+256*1024,CHUNK-256*1024);
 assert.deepEqual([...pending].map(r=>r.index),[11,12,13,14],'a sustained stream fetches the next2MiB in parallel before a boundary');
 assert.equal(disc.cachedBytes,(2+AHEAD)*CHUNK,'pending read-ahead buffers count inside the cache budget');
 // Demand joins an in-flight read-ahead instead of fetching it twice.
 read=disc.read(11*CHUNK,2048);let completed=false;read.then(()=>completed=true);
 await tick();assert(!completed);assert.equal(requests.filter(r=>r.index===11).length,1);
 next(11).release();assert.equal((await read)[0],11);
 next(12).release();await tick();
 const before=requests.length;assert.equal(disc.copyCached(12*CHUNK,2048,heap,0),2048);
 assert.equal(heap[0],12);assert.equal(requests.length,before,'ready read-ahead removes the next boundary network wait');
 // A new contiguous sector extends the horizon, then a seek aborts it.
 disc.copyCached(12*CHUNK+2048,2048,heap,0);await disc.read(12*CHUNK+4096,CHUNK-4096);assert(next(13));assert(next(14));
 read=disc.read(30*CHUNK,2048);await tick();assert(requests.find(r=>r.index===13).aborted);assert(requests.find(r=>r.index===14).aborted);
 next(30).release();await read;
 // Failed speculation is silent; demand retries with all range checks intact.
 await disc.read(30*CHUNK+2048,CHUNK-2048);next(31).release('short');next(32).release('transport');await tick();
 next(32).release('transport');await tick();
 read=disc.read(31*CHUNK,2048);await tick();next(31).release();assert.equal((await read)[0],31);
 assert.equal(requests.filter(r=>r.index===31).length,2);
 disc.copyCached(31*CHUNK+2048,2048,heap,0);next(32).release('changed');await tick();
 read=disc.read(32*CHUNK,2048);await tick();next(32).release('changed');await assert.rejects(read,/changed/);
 read=disc.read(25*CHUNK,2048);await tick();next(25).release('transport');await tick();next(25).release();
 assert.equal((await read)[0],25,'foreground transport reset retries once without changing the range');
 read=disc.read(26*CHUNK,2048);await tick();next(26).release('transport');await tick();next(26).release('transport');
 await assert.rejects(read,/connection reset/);assert.equal(requests.filter(r=>r.index===26).length,2,'transport retry is bounded');
 read=disc.read(27*CHUNK,2048);await tick();next(27).release('body');await tick();next(27).release();
 assert.equal((await read)[0],27,'interrupted response body retries with a fresh strict byte count');
 // Multiple foreground consumers also coalesce; completed-cache eviction and
 // aborted speculative buffers cannot exceed the original eight-slot budget.
 for(let index=1;index<LIMIT+8;index++){
  const a=disc.read(index*CHUNK,64),b=disc.read(index*CHUNK,64);await tick();
  const request=[...pending].find(r=>r.index===index);request?.release();
  assert.deepEqual(await a,await b);assert(disc.cachedBytes<=CHUNK*LIMIT);
 }
 assert(peak<=CHUNK*LIMIT,'ready plus pending allocations stay at most16MiB');
 // EOF read-ahead stops at the disc boundary; close aborts every pending fetch.
 read=disc.read(99*CHUNK,2048);await tick();next(99).release();await read;
 await disc.read(99*CHUNK+2048,CHUNK-2048);assert.equal(next(100).last,size-1);
 assert(!requests.some(r=>r.index>100));
 const last=disc.read(100*CHUNK,123);await tick();disc.close();await assert.rejects(last,/cancel|closed/i);
 await tick();assert.equal(pending.size,0);assert.equal(disc.cachedBytes,0);
 console.log('PASS PS2 sequential read-ahead removes ready boundary waits, coalesces demand, cancels seeks, retries speculation, validates responses and bounds pending+ready memory');
})().catch(error=>{console.error(error);process.exitCode=1;});
