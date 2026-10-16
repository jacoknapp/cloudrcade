import {DiscRangeCache,writeStreamStats} from './range-cache.mjs';

export function createRangeHandler({createCache=options=>new DiscRangeCache(options),
  schedule=setTimeout,cancel=clearTimeout}={}) {
  let cache,background;
  return async ({data}) => {
    cancel(background);
    const control=new Int32Array(data.control),bytes=new Uint8Array(data.buffer);
    cache ||= createCache({chunkSize:bytes.length,maxChunks:data.maxChunks,
      timeoutMs:data.timeoutMs,onStats:stats=>writeStreamStats(data.stats,stats)});
    let state=1,length;
    try {const result=await cache.read(data);bytes.set(result);length=result.length;}
    catch(error){state=-1;const message=new TextEncoder().encode(error.message||'Game stream failed.');
      length=Math.min(message.length,bytes.length);bytes.set(message.subarray(0,length));}
    Atomics.store(control,1,length);Atomics.store(control,0,state);Atomics.notify(control,0);
    // Wake Dolphin before allocating/fetching speculative data. A task (rather
    // than a microtask) also lets queued foreground reads supersede read-ahead.
    if(state===1)background=schedule(()=>{background=undefined;cache.prefetch(data);},0);
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  const read=createRangeHandler();
  self.onmessage=({data:{port}})=>{port.onmessage=read;port.postMessage({ready:true});};
}
