import {fetchDiscRange} from './range-fetch.mjs';
// GameCube owns its complete disk cache here. Pending fetch buffers count
// against the same eight-entry budget as completed data; no second UI cache.
export class DiscRangeCache {
  constructor({chunkSize, maxChunks, fetcher, timeoutMs = 60000, onStats = () => {}}) {
    this.chunkSize=chunkSize;this.maxChunks=maxChunks;this.fetcher=fetcher;
    this.timeoutMs=timeoutMs;this.onStats=onStats;this.entries=new Map();this.retired=new Set();this.closed=false;
    this.counters={requests:0,bytesFetched:0,hits:0,misses:0,prefetchHits:0,prefetchErrors:0,networkMs:0};
  }
  report() {
    const allocated=[...this.entries.values(),...this.retired];
    this.onStats({...this.counters,cachedChunks:allocated.length,
      cachedBytes:allocated.reduce((sum,e)=>sum+e.bytes.byteLength,0),
      pending:allocated.filter(e=>!e.ready).length});
  }
  discard(index) {
    const entry=this.entries.get(index);if(!entry)return;
    this.entries.delete(index);
    // An aborted fetch still owns its buffer until its reader settles.
    if(!entry.ready)this.retired.add(entry);
    entry.abort.abort();return entry.promise.catch(()=>{});
  }
  entry(request, index, speculative) {
    const first=index*this.chunkSize,last=Math.min(first+this.chunkSize,request.size)-1;
    if(first>=request.size)return null;
    let entry=this.entries.get(index);
    if(entry)return entry;
    // Leave one slot for demand even while canceled background reads drain.
    const pending=[...this.entries.values()].filter(e=>!e.ready).length+this.retired.size;
    if(speculative&&pending>=this.maxChunks-1)return null;
    while(this.entries.size+this.retired.size>=this.maxChunks) {
      // Demand reads move their entry to the end; evict the oldest completed
      // entry. Future read-ahead is useful work: evicting it first leaves old
      // demand chunks resident and repeatedly downloads the next disc chunks.
      // Unrelated speculative entries are already cancelled when a seek begins.
      const victim=[...this.entries].find(([,e])=>e.ready);
      if(!victim)return null;
      this.discard(victim[0]);
    }
    entry={bytes:new Uint8Array(last-first+1),abort:new AbortController(),ready:false,speculative};
    this.entries.set(index,entry);this.counters.requests++;
    const started=performance.now(),timer=setTimeout(()=>entry.abort.abort(),request.timeoutMs||this.timeoutMs);
    const fetchChunk=()=>fetchDiscRange({...request,first,last},entry.bytes,
      {fetcher:this.fetcher,signal:entry.abort.signal,priority:entry.speculative?'low':'high'});
    entry.promise=fetchChunk().catch(error=>{
      // Browsers report a transient transport/body failure as TypeError. Retry
      // once within the original timeout, with the same range and validator.
      // Cancellation and changed/invalid disc responses must still fail closed.
      if(entry.abort.signal.aborted||!(error instanceof TypeError))throw error;
      this.counters.requests++;this.report();return fetchChunk();
    }).then(length=>{
        if(entry.abort.signal.aborted)throw new DOMException('Game read canceled.','AbortError');
        entry.ready=true;this.counters.bytesFetched+=length;
        this.counters.networkMs+=performance.now()-started;return entry.bytes;
      }).catch(error=>{
        if(this.entries.get(index)===entry)this.entries.delete(index);
        if(entry.speculative&&!entry.abort.signal.aborted)this.counters.prefetchErrors++;
        throw error;
      }).finally(()=>{clearTimeout(timer);this.retired.delete(entry);this.report();});
    // Speculative failures are retried as demands, never unhandled or fatal.
    entry.promise.catch(()=>{});this.report();return entry;
  }
  async read(request) {
    if(this.closed)throw new Error('Game stream is closed.');
    const identity=JSON.stringify([request.url,request.size,request.validator]);
    if(this.identity&&this.identity!==identity)throw new Error('Game stream identity changed.');
    this.identity=identity;
    const index=Math.floor(request.first/this.chunkSize);
    if(request.first<0||request.last<request.first||request.last>=Math.min((index+1)*this.chunkSize,request.size))
      throw new Error('Game range exceeds the disk buffer.');
    // A seek abandons unrelated speculative work; foreground reads come first.
    for(const [at,e] of this.entries)if(e.speculative&&(at<index||at>index+2))this.discard(at);
    let entry=this.entries.get(index);
    if(entry?.ready){this.counters.hits++;if(entry.speculative)this.counters.prefetchHits++;}
    else this.counters.misses++;
    entry ||= this.entry(request,index,false);
    // Normally a seek can start immediately. Only wait for cancellation when
    // rapid seeks have exhausted the actual allocation budget.
    while(!entry&&this.retired.size&&!this.closed){
      await Promise.race([...this.retired].map(e=>e.promise.catch(()=>{})));
      if(!this.closed)entry=this.entry(request,index,false);
    }
    if(!entry)throw new Error('Game stream cache has no demand slot.');
    entry.speculative=false;
    this.entries.delete(index);this.entries.set(index,entry);
    const bytes=await entry.promise;
    if(this.closed)throw new Error('Game stream is closed.');
    this.report();return bytes.subarray(request.first-index*this.chunkSize,request.last-index*this.chunkSize+1);
  }
  prefetch(request) {
    if(this.closed)return;
    const index=Math.floor(request.first/this.chunkSize);
    for(let ahead=1;ahead<=2;ahead++)this.entry(request,index+ahead,true);
  }
  close(){this.closed=true;for(const index of this.entries.keys())this.discard(index);this.report();}
}

export const STREAM_FIELDS=['requests','bytesFetched','hits','misses','prefetchHits','prefetchErrors',
  'networkMs','cachedChunks','cachedBytes','pending'];
// Float64 values are read behind a short sequence lock. They are diagnostics
// only; a poll racing an update keeps its previous snapshot.
export function writeStreamStats(buffer, stats) {
  const seq=new Int32Array(buffer,0,1),values=new Float64Array(buffer,8);
  Atomics.add(seq,0,1);STREAM_FIELDS.forEach((key,i)=>values[i]=stats[key]||0);Atomics.add(seq,0,1);
}
export function readStreamStats(buffer, previous={}) {
  const seq=new Int32Array(buffer,0,1),values=new Float64Array(buffer,8),before=Atomics.load(seq,0);
  if(before%2)return previous;
  const snapshot=Object.fromEntries(STREAM_FIELDS.map((key,i)=>[key,values[i]]));
  return before===Atomics.load(seq,0)?snapshot:previous;
}
