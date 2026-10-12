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
  read(buffer,offset,length,position) {
    if(!this.reader.stats)return super.read(buffer,offset,length,position);
    if(position>=this.size)return 0;
    const total=Math.min(length,this.size-position);let done=0;
    while(done<total){
      const first=position+done;
      const count=Math.min(total-done,CHUNK_SIZE-first%CHUNK_SIZE);
      // Copy only the bytes Dolphin asked for across shared staging. A tiny
      // cached filesystem read must not copy an entire2MiB chunk again.
      const bytes=this.fetchRange(first,first+count-1);
      buffer.set(bytes,offset+done);done+=count;
    }
    return total;
  }
  getChunk(index) {
    // Production cache lives only in the fetch worker. The shared staging view
    // is copied into Dolphin's read destination before another chunk is requested.
    if(this.reader.stats)return this.fetchChunk(index);
    return super.getChunk(index); // Embedded/test readers retain the shared LRU.
  }
  close() { this.chunks.clear(); this.reader.close(); }
  stats() {
    const cached=this.reader.stats?.();
    return {...cached,chunkSize:CHUNK_SIZE, maxChunks:MAX_CHUNKS, cachedChunks:cached?.cachedChunks ?? this.chunks.size,
      cachedBytes:cached?.cachedBytes ?? Array.from(this.chunks.values()).reduce((total,chunk)=>total+chunk.byteLength,0),
      requests:cached?.requests ?? this.requests,bytesFetched:cached?.bytesFetched ?? this.bytesFetched,size:this.size,
      fileContentsBuffered:!!this.node?.contents};
  }
}
