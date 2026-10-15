// Bounded, asynchronous disc access. Native code never downloads a whole DVD.
export const CHUNK = 2 * 1024 * 1024, LIMIT = 8, THRESHOLD = 128 * 1024 * 1024;
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
 const cache = new Map(); let disposed = false, transferred = 0;
 async function chunk(index) {
  if (disposed) throw new Error('PS2 disc is closed.');
  if (cache.has(index)) { const bytes = cache.get(index); cache.delete(index); cache.set(index, bytes); return bytes; }
  const start=index*CHUNK, end=Math.min(size-1,start+CHUNK-1);
  const headers={Range:`bytes=${start}-${end}`}; if(validator)headers['If-Range']=validator;
  const timer=setTimeout(cancel,30000);
  try{
  const response=await fetch(url.href,{headers,signal:abort.signal,credentials:'same-origin'});
  if(response.status!==206 || response.headers.get('Content-Range')!==`bytes ${start}-${end}/${size}`) {
   await response.body?.cancel(); throw new Error('PS2 disc server must return exact HTTP byte ranges.');
  }
  if(validator && (etag && !etag.startsWith('W/') ? response.headers.get('ETag') : response.headers.get('Last-Modified'))!==validator) {
   await response.body?.cancel(); throw new Error('PS2 disc changed during play.');
  }
  // Read a strict byte budget even when an external server lies about length.
  const expected=end-start+1, bytes=new Uint8Array(expected), reader=response.body.getReader();let length=0;
  try { for(;;) { const {value,done}=await reader.read();if(done)break;
   if(length+value.length>expected)throw new Error('Oversized PS2 disc range.');
   bytes.set(value,length);length+=value.length;
  }} finally { await reader.cancel().catch(()=>{}); }
  if(length!==expected)throw new Error('Incomplete PS2 disc range.');
  if(disposed)throw new Error('PS2 disc is closed.');
  transferred+=length;
  while(cache.size>=LIMIT)cache.delete(cache.keys().next().value);
  cache.set(index,bytes);return bytes;
  }finally{clearTimeout(timer);}
 }
 const disc={name:decodeURIComponent(url.pathname.split('/').pop()),size,url:url.href,streamed:true,
  get cachedBytes(){return [...cache.values()].reduce((total,bytes)=>total+bytes.length,0);},
  get transferred(){return transferred;},
  async read(offset,length){
   if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<0||length>CHUNK)throw new Error('Invalid PS2 disc read.');
   const end=Math.min(size,offset+length),out=new Uint8Array(Math.max(0,end-offset));
   for(let cursor=offset;cursor<end;){const index=Math.floor(cursor/CHUNK),bytes=await chunk(index),from=cursor%CHUNK,count=Math.min(end-cursor,bytes.length-from);out.set(bytes.subarray(from,from+count),cursor-offset);cursor+=count;}
   return out;
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
  // Native requests can exceed a chunk; retain only the bounded chunk cache and
  // copy each requested subsection straight into the current WASM heap view.
  (async()=>{
   let count=0;
   while(count<length && offset+count<this.disc.size){
    if(this.closed)throw new Error('PS2 disc is closed.');
    const bytes=await this.disc.read(offset+count,Math.min(CHUNK,length-count));
    if(!bytes.length)break;
    this.module.HEAPU8.set(bytes,pointer+count);count+=bytes.length;
   }
   this.count=count;
  })().catch(error=>{this.count=-1;this.onError(error);}).finally(()=>{this.done=true;});
 }
 close(){this.closed=true;this.disc.close();this.count=-1;this.done=true;}
}
