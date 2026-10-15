const assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'../deploy/webrcade/retro-dolphin/app');
 const {DiscRangeCache}=await import(pathToFileURL(path.join(root,'range-cache.mjs')));
 const {FrameLimit}=await import(pathToFileURL(path.join(root,'frame-limit.mjs')));
 const chunkSize=2*1024*1024,requests=[],pending=new Map();let highWater=0;
 const fetcher=async(url,{headers,signal})=>{
  const [,first,last]=/bytes=(\d+)-(\d+)/.exec(headers.Range).map(Number);
  requests.push(first/chunkSize);
  return new Promise((resolve,reject)=>{
   signal.addEventListener('abort',()=>{pending.delete(first/chunkSize);reject(new Error('aborted'));},{once:true});
   pending.set(first/chunkSize,()=>{pending.delete(first/chunkSize);resolve(new Response(new Uint8Array(last-first+1).fill(first/chunkSize),
    {status:206,headers:{'Content-Range':`bytes ${first}-${last}/${12*chunkSize+7}`,ETag:'"fixture"'}}));});
  });
 };
 const cache=new DiscRangeCache({chunkSize,maxChunks:8,fetcher,onStats:s=>{highWater=Math.max(highWater,s.cachedBytes);assert(s.cachedBytes<=8*chunkSize);}});
 const req=i=>({url:'https://test/disc',size:12*chunkSize+7,validator:{header:'ETag',value:'"fixture"'},first:i*chunkSize,last:Math.min((i+1)*chunkSize,12*chunkSize+7)-1});
 const tick=()=>new Promise(r=>setImmediate(r));
 let demand=cache.read(req(0));await tick();pending.get(0)();assert.equal((await demand)[0],0);
 assert.deepEqual(requests,[0,1,2],'foreground fetch starts both future chunks');
 demand=cache.read(req(1));await tick();assert.equal(requests.filter(i=>i===1).length,1,'pending prefetch coalesces with demand');
 pending.get(1)();assert.equal((await demand)[0],1);pending.get(2)();await tick();
 demand=cache.read(req(2));assert.equal((await demand)[0],2);assert.equal(cache.counters.prefetchHits,1);
 const before=requests.length;const partial=await cache.read({...req(2),first:2*chunkSize+7,last:2*chunkSize+10});
 assert.equal(partial.length,4);assert.equal(partial[0],2);assert.equal(requests.length,before,'tiny cache hits transfer only requested bytes');
 // Seek cancels unrelated speculative fetches and prioritizes actual demand.
 demand=cache.read(req(8));await tick();assert(!pending.has(3)&&!pending.has(4));pending.get(8)();await demand;
 for(let i=9;i<=12;i++){
  await tick();const next=cache.read(req(i));await tick();if(pending.has(i))pending.get(i)();const bytes=await next;assert.equal(bytes.length,i===12?7:chunkSize);
 }
 assert(!requests.includes(13),'read-ahead stops at EOF');assert(highWater<=16*1024*1024);
 cache.close();await tick();assert.equal(cache.entries.size,0);assert.equal(pending.size,0);
 await assert.rejects(cache.read(req(0)),/closed/);
 let cancelled=false;
 const failing=new DiscRangeCache({chunkSize,maxChunks:8,fetcher:async()=>({status:200,headers:new Headers(),body:{cancel:async()=>{cancelled=true;}}})});
 await assert.rejects(failing.read(req(0)),/invalid HTTP byte range/);assert(cancelled);failing.close();
 let failPrefetch=true,attempts=0;
 const retry=new DiscRangeCache({chunkSize,maxChunks:8,fetcher:async(url,{headers})=>{
  const [,first,last]=/bytes=(\d+)-(\d+)/.exec(headers.Range).map(Number);
  if(first===chunkSize){attempts++;if(failPrefetch){failPrefetch=false;throw new Error('temporary network failure');}}
  return new Response(new Uint8Array(last-first+1),{status:206,headers:{'Content-Range':`bytes ${first}-${last}/${12*chunkSize+7}`,ETag:'"fixture"'}});
 }});
 await retry.read(req(0));await tick();assert.equal(retry.counters.prefetchErrors,1);
 await retry.read(req(1));assert.equal(attempts,2,'failed speculative read is retried on demand');retry.close();
 // A streaming game must retain its completed read-ahead after the cache fills.
 // Ready future chunks used to be evicted ahead of stale demand chunks, so
 // sequential reads fetched the same data again and blocked Dolphin each time.
 const sequentialRequests=[],sequentialSize=32*chunkSize;
 const sequential=new DiscRangeCache({chunkSize,maxChunks:8,fetcher:async(url,{headers})=>{
  const [,first,last]=/bytes=(\d+)-(\d+)/.exec(headers.Range).map(Number);
  sequentialRequests.push(first/chunkSize);
  return new Response(new Uint8Array(last-first+1).fill(first/chunkSize),{status:206,
   headers:{'Content-Range':`bytes ${first}-${last}/${sequentialSize}`,ETag:'"fixture"'}});
 }});
 for(let i=0;i<32;i++){
  const bytes=await sequential.read({...req(i),size:sequentialSize,last:(i+1)*chunkSize-1});
  assert.equal(bytes[0],i);assert(sequential.entries.size<=8);
  await Promise.all([...sequential.entries.values()].map(e=>e.promise));
 }
 assert.deepEqual(sequentialRequests,Array.from({length:32},(_,i)=>i),'read-ahead survives eviction without duplicate network transfers');
 assert.equal(sequential.counters.misses,1,'only the first sequential chunk waits for the network');
 assert.equal(sequential.counters.prefetchHits,31);sequential.close();
 let networkAttempts=0;
 const recovered=new DiscRangeCache({chunkSize,maxChunks:8,fetcher:async(url,init)=>{
  networkAttempts++;
  if(networkAttempts===1)throw new TypeError('Failed to fetch');
  const [,first,last]=/bytes=(\d+)-(\d+)/.exec(init.headers.Range).map(Number);
  return new Response(new Uint8Array(last-first+1).fill(42),{status:206,
   headers:{'Content-Range':`bytes ${first}-${last}/${12*chunkSize+7}`,ETag:'"fixture"'}});
 }});
 assert.equal((await recovered.read(req(0)))[0],42,'a transient network failure retries before failing the native disc read');
 assert.equal(networkAttempts,4,'one bounded retry plus the two normal read-ahead requests');
 recovered.close();
 let failedAttempts=0;
 const unavailable=new DiscRangeCache({chunkSize,maxChunks:8,fetcher:async()=>{failedAttempts++;throw new TypeError('Failed to fetch');}});
 await assert.rejects(unavailable.read(req(0)),/Failed to fetch/);
 assert.equal(failedAttempts,2,'a persistent network failure is not retried indefinitely');unavailable.close();
 const limit=new FrameLimit(60);limit.presented(0);assert.equal(limit.timerDelay(0),17);assert.equal(limit.timerDelay(16),1);assert.equal(limit.timerDelay(17),0);limit.reset();let count=0;
 for(let ms=0;ms<1000;ms+=.1)if(!limit.remaining(ms)){limit.presented(ms);count++;}
 assert.equal(count,60,'thousands of drain attempts cannot submit over60 frames/s');
 assert(limit.remaining(1000)>0);limit.reset();assert.equal(limit.remaining(1000),0);
 limit.presented(1000);limit.presented(5000);assert(limit.remaining(5000)>16,'slow frames cannot accumulate catch-up credits');
 console.log('PASS GameCube two-chunk read-ahead/coalescing/seek priority/EOF/cancellation and16MiB budget; real60Hz gate');
})().catch(e=>{console.error(e);process.exitCode=1;});
