// Reuse exactly the existing disk reader's chunk size, LRU policy and mount.
import {LazyRom, CHUNK_SIZE, MAX_CHUNKS} from './lazyrom.mjs';
export {CHUNK_SIZE, MAX_CHUNKS};

export class RemoteDisc extends LazyRom {
  constructor(url,size) { super(url,size); this.requests = 0; this.bytesFetched = 0; }
  fetchRange(first,last) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET',this.url,false);
    xhr.responseType = 'arraybuffer';
    xhr.setRequestHeader('Range',`bytes=${first}-${last}`);
    xhr.send(null);
    if (xhr.status !== 206 || xhr.getResponseHeader('Content-Range') !== `bytes ${first}-${last}/${this.size}`) {
      throw new Error('Game stream returned an invalid HTTP byte range.');
    }
    const bytes = new Uint8Array(xhr.response);
    if (bytes.length !== last-first+1) throw new Error('Short read of streamed game data.');
    this.requests++; this.bytesFetched += bytes.length;
    return bytes;
  }
  stats() {
    return {chunkSize:CHUNK_SIZE, maxChunks:MAX_CHUNKS, cachedChunks:this.chunks.size,
      cachedBytes:Array.from(this.chunks.values()).reduce((total,chunk)=>total+chunk.byteLength,0),
      requests:this.requests,bytesFetched:this.bytesFetched,size:this.size,
      fileContentsBuffered:!!this.node?.contents};
  }
}
