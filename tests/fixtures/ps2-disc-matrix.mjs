// Shared actual-source scheduler contract, run in Node, Chromium and WebKit.
// Only the network is controlled. Abort settlement is explicitly released so
// dispatch ordering, ownership and coalescing do not depend on clock thresholds.
export async function discMatrix({remoteDisc,CHUNK,LIMIT}) {
 const check=(value,message)=>{if(!value)throw new Error(message);};
 const equal=(actual,expected,message)=>check(actual===expected,`${message}: ${actual} !== ${expected}`);
 const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
 const rejected=async(promise,pattern)=>{try{await promise;}catch(error){check(pattern.test(error.message),error.message);return;}throw new Error('Expected rejection '+pattern);};
 const originalFetch=globalThis.fetch;
 let current,assertions=0;
 async function fixture({size=100*CHUNK+123,validator='etag'}={}) {
  const requests=[];let disc,peak=0;
  const headers=()=>validator==='etag'?{ETag:'"v1"'}:validator==='date'?{ETag:'W/"weak"','Last-Modified':'Wed, 01 Jan 2025 00:00:00 GMT'}:{};
  globalThis.fetch=async(_url,options)=>{
   if(options.method==='HEAD')return new Response(null,{headers:{'Content-Length':String(size),...headers()}});
   const [,first,last]=/bytes=(\d+)-(\d+)/.exec(options.headers.Range).map(Number);
   equal(options.headers['If-Range'],validator==='etag'?'"v1"':validator==='date'?'Wed, 01 Jan 2025 00:00:00 GMT':undefined,'If-Range validator');
   const request={index:first/CHUNK,first,last,aborted:false,settled:false};requests.push(request);
   peak=Math.max(peak,disc?.cachedBytes||CHUNK);check(peak<=LIMIT*CHUNK,'live cache budget exceeded');
   return new Promise((resolve,reject)=>{
    const abort=()=>{request.aborted=true;};
    const finish=()=>{request.settled=true;options.signal.removeEventListener('abort',abort);};
    request.abortDone=()=>{if(request.settled)return;finish();reject(new DOMException('cancelled','AbortError'));};
    request.release=(mode='good')=>{
     check(!request.settled,'Request released twice');finish();
     if(mode==='transport'){reject(new TypeError('connection reset'));return;}
     const length=last-first+1,bytes=new Uint8Array(length+(mode==='oversized'?1:mode==='short'?-1:0));
     for(let at=0;at<bytes.length;at++)bytes[at]=(first+at)%251;
     let body=bytes;
     if(mode==='body')body=new ReadableStream({start(controller){controller.error(new TypeError('body reset'));}});
     if(mode==='cancel-held')body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(length+1));},cancel(){return new Promise(done=>request.cancelDone=done);}});
     const responseHeaders={...headers(),'Content-Range':`bytes ${first}-${last}/${size}`};
     if(mode==='range')responseHeaders['Content-Range']=`bytes ${first+1}-${last}/${size}`;
     if(mode==='changed'){responseHeaders.ETag='"v2"';responseHeaders['Last-Modified']='Thu, 02 Jan 2025 00:00:00 GMT';}
     resolve(new Response(body,{status:mode==='full'?200:206,headers:responseHeaders}));
    };
    options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();
   });
  };
  const opening=remoteDisc('/disc-matrix.iso');await tick();requests[0].release();disc=await opening;
  const pending=index=>requests.filter(r=>r.index===index&&!r.settled).at(-1);
  const read=index=>{const result=disc.read(index*CHUNK,64);result.catch(()=>{});return result;};
  const verify=(bytes,offset,length=64)=>{equal(bytes.length,length,'exact result length');check(bytes.every((v,at)=>v===(offset+at)%251),'exact bytes');};
  const stream=()=>{const heap=new Uint8Array(CHUNK);equal(disc.copyCached(0,1,heap,0),1,'cached start');equal(disc.copyCached(1,CHUNK-1,heap,0),CHUNK-1,'cached stream');};
  const cleanup=async()=>{disc.close();for(const r of requests){if(!r.settled)r.abortDone();r.cancelDone?.();}await tick();equal(disc.cachedBytes,0,'settled close releases every buffer');};
  return current={disc,requests,pending,read,verify,stream,cleanup,get peak(){return peak;}};
 }
 try {
  // Spare slots, repeated seeks and a request rejoining its cancelled chunk.
  let f=await fixture();f.stream();equal(f.requests.length,5,'four speculative ranges');
  let a=f.read(20);await tick();check(f.pending(20),'seek dispatches before aborted speculation settles');
  for(let at=1;at<=4;at++)check(f.pending(at).aborted,'old speculation aborted');
  equal(f.disc.cachedBytes,6*CHUNK,'aborted speculative buffers remain owned');
  let b=f.read(30);await tick();check(f.pending(30),'rapid second seek admits with spare budget');
  f.pending(30).release();f.verify(await b,30*CHUNK);f.pending(20).release();f.verify(await a,20*CHUNK);
  const obsolete=f.pending(1);a=f.read(1);b=f.read(1);await tick();equal(f.requests.filter(r=>r.index===1).length,2,'cancelled index is replaced immediately with spare budget');
  equal(f.disc.cachedBytes,8*CHUNK,'replacement and old cancelled buffer both remain counted');
  check(f.pending(1)!==obsolete,'new demand has an independent owner');
  obsolete.abortDone();await tick();check(f.pending(1),'old failure cannot delete its replacement');
  f.pending(1).release();f.verify(await a,CHUNK);f.verify(await b,CHUNK);await f.cleanup();assertions++;

  // A promoted speculative read coalesces and survives an unrelated seek.
  f=await fixture();f.stream();a=f.read(1);b=f.read(1);const seek=f.read(50);await tick();
  check(!f.pending(1).aborted,'demand promotion protects a shared speculative read');
  equal(f.requests.filter(r=>r.index===1).length,1,'two consumers share one request');
  f.pending(1).release();f.verify(await a,CHUNK);f.verify(await b,CHUNK);f.pending(50).release();await seek;
  await f.cleanup();assertions++;

  // Saturation: 28 demand plus four delayed-abort speculation use all 32
  // slots, including eviction of the ready probe. One cancelled settlement
  // suffices; waiting for all four would leave the new demand undispatched.
  for(const target of [70,1]) {
   f=await fixture();f.stream();const active=[],obsolete=f.pending(1);
   f.disc.copyCached(0,1,new Uint8Array(1),0); // End the stream before concurrent seeks.
   for(let at=10;at<10+LIMIT-4;at++)active.push(f.read(at));
   await tick();equal(f.disc.cachedBytes,LIMIT*CHUNK,'full32-slot budget');
   a=f.read(target);b=f.read(target);await tick();equal(f.requests.filter(r=>r.index===target).length,target===1?1:0,'full budget blocks new allocation');
   equal(f.requests.length,1+4+LIMIT-4,'blocked demand does not issue a GET');
   const freed=target===1?2:1;f.pending(freed).abortDone();await tick();check(f.pending(target),'first freed buffer admits demand');
   equal(f.requests.filter(r=>r.index===target).length,target===1?2:1,'budget waiters coalesce after waking');
   for(const at of [1,2,3,4].filter(at=>at!==freed))check(!f.pending(at).settled,'other aborts remain unsettled');
   equal(f.disc.cachedBytes,LIMIT*CHUNK,'replacement retains full budget');
   if(target===1)check(f.pending(1)!==obsolete,'full-budget replacement owns a separate slot');
   f.pending(target).release();f.verify(await a,target*CHUNK);f.verify(await b,target*CHUNK);
   f.disc.close();equal(f.disc.cachedBytes,(LIMIT-1)*CHUNK,'close retains every pending buffer');
   for(const r of f.requests)if(!r.settled)r.abortDone();await Promise.allSettled(active);await f.cleanup();assertions++;
  }

  // A completed sequential consumer may want more speculation in the same
  // turn. A demand already waiting on the full budget must still be admitted.
  f=await fixture();f.stream();const promoted=f.read(1),contenders=[];
  for(let at=10;at<10+LIMIT-4;at++)contenders.push(f.read(at));
  a=f.read(80);await tick();check(!f.pending(80),'streaming saturation blocks demand');
  f.pending(1).release();await promoted;await tick();check(f.pending(80),'streaming completion cannot starve queued demand');
  f.pending(80).release();f.verify(await a,80*CHUNK);
  f.disc.close();for(const r of f.requests)if(!r.settled)r.abortDone();await Promise.allSettled(contenders);await f.cleanup();assertions++;

  // All-demand saturation also waits for the first ready slot. Abort/close
  // wakes blocked admission without waiting for the transport abort cleanup.
  for(const close of [false,true]) {
   f=await fixture();const reads=[];for(let at=10;at<10+LIMIT;at++)reads.push(f.read(at));await tick();
   equal(f.disc.cachedBytes,LIMIT*CHUNK,'all-demand full budget');a=f.read(80);await tick();check(!f.pending(80),'33rd pending demand waits');
   if(close){f.disc.close();await rejected(a,/closed|cancel/i);equal(f.disc.cachedBytes,LIMIT*CHUNK,'close keeps aborted ownership until settlement');}
   else{f.pending(10).release();await reads[0];await tick();check(f.pending(80),'first ready demand is evictable');f.pending(80).release();f.verify(await a,80*CHUNK);}
   f.disc.close();for(const r of f.requests)if(!r.settled)r.abortDone();await Promise.allSettled(reads);await f.cleanup();assertions++;
  }

  // Integrity errors never retry; a clean request can recover afterwards.
  for(const validator of ['etag','date','none']) {
   f=await fixture({validator});
   for(const [index,mode,pattern]of [[10,'short',/Incomplete/],[11,'oversized',/Oversized/],[12,'range',/ranges/],[13,'full',/ranges/],...(validator==='none'?[]:[[14,'changed',/changed/]])]) {
    a=f.read(index);await tick();f.pending(index).release(mode);await rejected(a,pattern);
    equal(f.requests.filter(r=>r.index===index).length,1,'integrity failure has no retry');
    a=f.read(index);await tick();f.pending(index).release();f.verify(await a,index*CHUNK);
   }
   await f.cleanup();assertions++;
  }
  f=await fixture();
  for(const [index,mode,failTwice]of [[10,'transport',false],[11,'body',false],[12,'transport',true],[13,'body',true]]) {
   a=f.read(index);await tick();f.pending(index).release(mode);await tick();f.pending(index).release(failTwice?mode:'good');
   if(failTwice)await rejected(a,/reset/);else f.verify(await a,index*CHUNK);
   equal(f.requests.filter(r=>r.index===index).length,2,'one bounded transport retry');
  }
  // Cancellation is never retried, including when a faulty transport rejects
  // with TypeError after abort rather than AbortError.
  f.stream();a=f.read(1);b=f.read(1);f.disc.close();f.pending(1).release('transport');await rejected(a,/reset/);await rejected(b,/reset/);
  equal(f.requests.filter(r=>r.index===1).length,1,'no retry after abort');await f.cleanup();assertions++;

  f=await fixture();a=f.read(10);await tick();const held=f.pending(10);held.release('cancel-held');await tick();
  check(held.cancelDone,'oversized reader entered asynchronous cancellation');f.disc.close();
  equal(f.disc.cachedBytes,CHUNK,'close retains buffer while reader cancellation is pending');held.cancelDone();
  await rejected(a,/Oversized/);await f.cleanup();assertions++;

  // Exact >4GiB, cross-boundary and final short-chunk reads, plus synchronous
  // native cached copies that leave destination untouched on a miss.
  const size=5*1024**3+123;f=await fixture({size});const offset=2**32+CHUNK-16;
  a=f.disc.read(offset,64);await tick();f.pending(Math.floor(offset/CHUNK)).release();await tick();f.pending(Math.floor(offset/CHUNK)+1).release();f.verify(await a,offset);
  const heap=new Uint8Array(96).fill(255);equal(f.disc.copyCached(offset,64,heap,16),64,'synchronous cached cross-boundary read');
  f.verify(heap.subarray(16,80),offset);check(heap.subarray(0,16).every(v=>v===255)&&heap.subarray(80).every(v=>v===255),'copy bounds');
  heap.fill(255);equal(f.disc.copyCached(90*CHUNK,64,heap,16),null,'cache miss');check(heap.every(v=>v===255),'cache miss does not partially write');
  a=f.disc.read(size-3,16);await tick();const final=f.pending(Math.floor((size-3)/CHUNK));equal(final.last,size-1,'last byte range');final.release();f.verify(await a,size-3,3);
  equal((await f.disc.read(size,16)).length,0,'EOF read');equal((await f.disc.read(size+10,16)).length,0,'beyond EOF read');
  await rejected(f.disc.read(0,CHUNK+1),/Invalid/);await f.cleanup();assertions++;
  return {scenarios:assertions,budgetBytes:LIMIT*CHUNK};
 } finally {if(current)await current.cleanup();globalThis.fetch=originalFetch;}
}
