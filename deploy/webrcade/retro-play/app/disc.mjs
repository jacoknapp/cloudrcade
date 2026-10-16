// Bounded, asynchronous disc access. Native code never downloads a whole DVD.
// Small files/seeks must not wait for an unrelated 2 MiB body. Retain the same
// 16 MiB cache and a 2 MiB read-ahead horizon for sustained streaming.
export const CHUNK = 512 * 1024, LIMIT = 32, AHEAD = 4, THRESHOLD = 128 * 1024 * 1024;
const MAX_READ = 2 * 1024 * 1024;
const checkedSize = size => {
 if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Invalid PS2 disc size.');
 return size;
};
export async function remoteDisc(value, {signal} = {}) {
 const url = new URL(value, location.href);
 if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid PS2 disc URL.');
 const abort = new AbortController();
 const cancel = () => abort.abort(); signal?.addEventListener('abort', cancel, {once:true});
 if (signal?.aborted) abort.abort();
 let head,size;const headTimer=setTimeout(cancel,30000);
 try{head=await fetch(url.href, {method:'HEAD', signal:abort.signal, credentials:'same-origin'});
  if (!head.ok) throw new Error('Unable to inspect the PS2 disc.');
  size=checkedSize(Number(head.headers.get('Content-Length')));
 }catch(error){signal?.removeEventListener('abort',cancel);abort.abort();throw error;}
 finally{clearTimeout(headTimer);}
 const etag = head.headers.get('ETag');
 const validator = etag && !etag.startsWith('W/') ? etag : head.headers.get('Last-Modified');
 // Pending buffers share the LRU budget with ready data. Aborted requests keep
 // their slot until the reader settles, so seeks cannot multiply memory use.
 const cache = new Map(); let disposed = false, transferred = 0, previousEnd = -1, aheadFrom = -1, aheadDepth = 0, sequentialBytes = 0;
 function discard(index,entry) {
  entry.abort.abort();
  if(entry.ready)cache.delete(index);
 }
 function cancelAhead(index) {
  const pending=[];
  for(const [at,entry]of cache)if(entry.speculative&&(at<index||at>index+AHEAD)) {
   discard(at,entry);pending.push(entry.promise.catch(()=>{}));
  }
  return pending;
 }
 function entryFor(index,speculative) {
  if(disposed||index*CHUNK>=size)return null;
  const existing=cache.get(index);
  if(existing)return existing.abort.signal.aborted?null:existing;
  if(cache.size>=LIMIT) {
   const victim=[...cache].find(([,entry])=>entry.ready);
   if(!victim)return null;
   discard(...victim);
  }
  const start=index*CHUNK, end=Math.min(size-1,start+CHUNK-1);
  const entry={bytes:new Uint8Array(end-start+1),abort:new AbortController(),ready:false,speculative};
  cache.set(index,entry);
  const cancelEntry=()=>entry.abort.abort();
  abort.signal.addEventListener('abort',cancelEntry,{once:true});
  if(abort.signal.aborted)cancelEntry();
  const timer=setTimeout(cancelEntry,30000);
  const headers={Range:`bytes=${start}-${end}`}; if(validator)headers['If-Range']=validator;
  const fetchChunk=async()=>{
  const response=await fetch(url.href,{headers,signal:entry.abort.signal,credentials:'same-origin'});
  if(response.status!==206 || response.headers.get('Content-Range')!==`bytes ${start}-${end}/${size}`) {
   await response.body?.cancel(); throw new Error('PS2 disc server must return exact HTTP byte ranges.');
  }
  if(validator && (etag && !etag.startsWith('W/') ? response.headers.get('ETag') : response.headers.get('Last-Modified'))!==validator) {
   await response.body?.cancel(); throw new Error('PS2 disc changed during play.');
  }
  // Read a strict byte budget even when an external server lies about length.
  const expected=end-start+1, bytes=entry.bytes, reader=response.body.getReader();let length=0;
  try { for(;;) { const {value,done}=await reader.read();if(done)break;
   if(length+value.length>expected)throw new Error('Oversized PS2 disc range.');
   bytes.set(value,length);length+=value.length;
  }} finally { await reader.cancel().catch(()=>{}); }
  if(length!==expected)throw new Error('Incomplete PS2 disc range.');
  return length;
  };
  entry.promise=(async()=>{
  try{
  const length=await fetchChunk().catch(error=>{
   // HTTP/2 resets and interrupted bodies are transport TypeErrors. Retry once
   // within the original timeout; never retry cancellation or invalid data.
   if(entry.abort.signal.aborted||!(error instanceof TypeError))throw error;
   return fetchChunk();
  });
  if(disposed||entry.abort.signal.aborted)throw new Error('PS2 disc read cancelled.');
  transferred+=length;
  entry.ready=true;return entry.bytes;
  }catch(error){if(cache.get(index)===entry)cache.delete(index);throw error;}
  finally{clearTimeout(timer);abort.signal.removeEventListener('abort',cancelEntry);}
  })();
  // Failed speculation is retried on demand, never an unhandled fatal error.
  entry.promise.catch(()=>{});
  return entry;
 }
 async function chunk(index) {
  if(disposed)throw new Error('PS2 disc is closed.');
  const cancelled=cancelAhead(index);
  if(cancelled.length)await Promise.all(cancelled);
  if(disposed)throw new Error('PS2 disc is closed.');
  let entry=entryFor(index,false);
  if(!entry) {
   await Promise.all([...cache.values()].filter(e=>e.abort.signal.aborted).map(e=>e.promise.catch(()=>{})));
   entry=entryFor(index,false);
  }
  if(!entry)throw new Error('PS2 disc cache has no demand slot.');
  entry.speculative=false;cache.delete(index);cache.set(index,entry);
  return entry.promise;
 }
 function consumed(offset,end) {
  if(end<=offset)return;
  const index=Math.floor((end-1)/CHUNK),sequential=previousEnd===offset;
  if(!sequential||Math.floor((previousEnd-1)/CHUNK)!==index)cancelAhead(index);
  sequentialBytes=sequential?sequentialBytes+end-offset:end-offset;
  previousEnd=end;
  // Small metadata/file reads often consist of adjacent sectors too. Require a
  // sustained 256KiB stream before one range of look-ahead, and 512KiB of
  // sequential demand before four. This avoids amplifying startup downloads.
  if(!sequential){aheadFrom=-1;aheadDepth=0;}
  const depth=sequentialBytes>=CHUNK?AHEAD:1;
  if(sequential&&sequentialBytes>=256*1024&&(aheadFrom!==index||aheadDepth<depth)){
   aheadFrom=index;aheadDepth=depth;for(let ahead=1;ahead<=depth;ahead++)entryFor(index+ahead,true);
  }
 }
 const disc={name:decodeURIComponent(url.pathname.split('/').pop()),size,url:url.href,streamed:true,
  get cachedBytes(){return [...cache.values()].reduce((total,entry)=>total+entry.bytes.length,0);},
  get transferred(){return transferred;},
  // Copy cached sectors directly into the current native heap. Check the whole
  // range first so a miss never leaves a partially copied result.
  copyCached(offset,length,heap,pointer){
   if(disposed)throw new Error('PS2 disc is closed.');
   if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<0||length>MAX_READ)throw new Error('Invalid PS2 disc read.');
   const end=Math.min(size,offset+length);
   for(let cursor=offset;cursor<end;cursor=(Math.floor(cursor/CHUNK)+1)*CHUNK)if(!cache.get(Math.floor(cursor/CHUNK))?.ready)return null;
   for(let cursor=offset;cursor<end;){const index=Math.floor(cursor/CHUNK),entry=cache.get(index),bytes=entry.bytes,from=cursor%CHUNK,count=Math.min(end-cursor,bytes.length-from);heap.set(bytes.subarray(from,from+count),pointer+cursor-offset);entry.speculative=false;cache.delete(index);cache.set(index,entry);cursor+=count;}
   consumed(offset,end);
   return Math.max(0,end-offset);
  },
  async read(offset,length){
   if(disposed)throw new Error('PS2 disc is closed.');
   if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<0||length>CHUNK)throw new Error('Invalid PS2 disc read.');
   const end=Math.min(size,offset+length),out=new Uint8Array(Math.max(0,end-offset));
   for(let cursor=offset;cursor<end;){const index=Math.floor(cursor/CHUNK),bytes=await chunk(index),from=cursor%CHUNK,count=Math.min(end-cursor,bytes.length-from);out.set(bytes.subarray(from,from+count),cursor-offset);cursor+=count;}
   consumed(offset,end);return out;
  },
  close(){disposed=true;abort.abort();cache.clear();signal?.removeEventListener('abort',cancel);},
 };
 // Probe before native boot so a server ignoring Range cannot block a core thread.
 try { await disc.read(0,Math.min(4096,size)); } catch(error) {disc.close();throw error;}
 return disc;
}

export function localDisc(file) {
 checkedSize(file.size);
 return {name:file.name,size:file.size,streamed:false,async read(offset,length){return new Uint8Array(await file.slice(offset,offset+length).arrayBuffer());},close(){}};
}

export class DiscDevice {
 constructor(module,disc,onError){this.module=module;this.disc=disc;this.onError=onError;this.done=true;this.count=0;this.closed=false;}
 getFileSize(){return this.disc.size;}
 isDone(){return this.done;}
 result(){return this.count;}
 read(pointer,offset,length){
  this.done=false;this.count=0;
  const timing=this.module.cloudTimings,epoch=timing?.epoch,start=timing?.begin()??null;
  // Native code polls immediately after this main-thread callback returns.
  // Ready data must finish synchronously: a Promise.finally would otherwise
  // make the worker poll/yield while the requested bytes are already in RAM.
  try{
   if(!this.closed&&length<=MAX_READ){
    const cached=this.disc.copyCached?.(offset,length,this.module.HEAPU8,pointer);
    if(cached!=null){this.count=cached;this.done=true;if(start!==null)timing.record('disc',start,epoch);return;}
   }
  }catch(error){this.count=-1;this.done=true;if(start!==null)timing.record('disc',start,epoch);if(!this.closed)this.onError(error);return;}
  // Native requests can exceed a chunk; retain only the bounded chunk cache and
  // copy each requested subsection straight into the current WASM heap view.
  (async()=>{
   let count=0;
   while(count<length && offset+count<this.disc.size){
    if(this.closed)throw new Error('PS2 disc is closed.');
    const amount=Math.min(CHUNK,length-count),cached=this.disc.copyCached?.(offset+count,amount,this.module.HEAPU8,pointer+count);
    if(cached!=null){if(!cached)break;count+=cached;continue;}
    const bytes=await this.disc.read(offset+count,amount);
    if(this.closed)throw new Error('PS2 disc is closed.');
    if(!bytes.length)break;
    this.module.HEAPU8.set(bytes,pointer+count);count+=bytes.length;
   }
   this.count=count;
  })().catch(error=>{this.count=-1;if(!this.closed)this.onError(error);}).finally(()=>{if(start!==null)timing.record('disc',start,epoch);this.done=true;});
 }
 close(){this.closed=true;this.disc.close();this.count=-1;this.done=true;}
}
