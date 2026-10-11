// Reuse exactly the existing disk reader's chunk size, LRU policy and mount.
import {LazyRom, CHUNK_SIZE, MAX_CHUNKS} from './lazyrom.mjs';
import {RangeReader} from './range-reader.mjs';
export {CHUNK_SIZE, MAX_CHUNKS};

export class RemoteDisc extends LazyRom {
  constructor(url,size,validator,reader = new RangeReader(CHUNK_SIZE)) {
    super(url,size); this.validator = validator; this.reader = reader;
    this.requests = 0; this.bytesFetched = 0;
  }
  fetchRange(first,last) {
    const bytes = this.reader.read({url:this.url,size:this.size,first,last,validator:this.validator});
    this.requests++; this.bytesFetched += bytes.length;
    return bytes;
  }
  close() { this.chunks.clear(); this.reader.close(); }
  stats() {
    return {chunkSize:CHUNK_SIZE, maxChunks:MAX_CHUNKS, cachedChunks:this.chunks.size,
      cachedBytes:Array.from(this.chunks.values()).reduce((total,chunk)=>total+chunk.byteLength,0),
      requests:this.requests,bytesFetched:this.bytesFetched,size:this.size,
      fileContentsBuffered:!!this.node?.contents};
  }
}
