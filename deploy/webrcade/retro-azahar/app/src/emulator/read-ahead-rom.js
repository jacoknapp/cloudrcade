import { LazyRom, CHUNK_SIZE, MAX_CHUNKS } from './lazyrom';

// Speculative binary reads are scoped to 3DS; other cores keep the demand reader.
export class ReadAheadRom extends LazyRom {
  constructor(url, size) {
    super(url, size);
    this.pending = null;
    this.lastReadChunk = -2;
    this.failedPrefetch = -1;
    this.closed = false;
    this.prefetched = new Set();
    this.readAheadStats = { misses: 0, prefetched: 0, prefetchHits: 0 };
  }
  trim(limit) {
    while (this.chunks.size > limit) {
      const index = this.chunks.keys().next().value;
      this.chunks.delete(index);
      this.prefetched.delete(index);
    }
  }

  cancelPrefetch() {
    const pending = this.pending;
    this.pending = null;
    if (pending) pending.controller.abort();
  }

  prefetch(index) {
    if (this.closed || typeof fetch !== 'function' || typeof AbortController !== 'function' ||
        index * CHUNK_SIZE >= this.size || this.chunks.has(index) ||
        index === this.failedPrefetch || this.pending) return;
    const first = index * CHUNK_SIZE;
    const last = Math.min(first + CHUNK_SIZE, this.size) - 1;
    const pending = { index, controller: new AbortController() };
    // Reserve the in-flight chunk inside the same eight-chunk memory budget.
    this.trim(MAX_CHUNKS - 1);
    this.pending = pending;
    fetch(this.url, { headers: { Range: `bytes=${first}-${last}` },
      signal: pending.controller.signal }).then(async (response) => {
      if (response.status !== 206 ||
          response.headers.get('Content-Range') !== `bytes ${first}-${last}/${this.size}`) {
        pending.controller.abort();
        throw new Error('Invalid read-ahead range');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== last - first + 1) throw new Error('Short read-ahead range');
      if (this.pending !== pending || this.closed) return;
      this.pending = null;
      this.chunks.set(index, bytes);
      this.prefetched.add(index);
      this.readAheadStats.prefetched++;
    }).catch(() => {
      // Speculation never changes demand-read errors or retries a bad range
      // every frame. A cancelled/stale request cannot modify the current one.
      if (this.pending === pending) {
        this.pending = null;
        this.failedPrefetch = index;
      }
    });
  }

  close() {
    this.closed = true;
    this.cancelPrefetch();
    this.chunks.clear();
    this.prefetched.clear();
  }

  getChunk(index) {
    if (this.closed) throw new Error('Game data is closed');
    let chunk = this.chunks.get(index);
    if (chunk) {
      this.chunks.delete(index);
      if (this.prefetched.delete(index)) this.readAheadStats.prefetchHits++;
    } else {
      // A demand read must not wait for an asynchronous request. Reclaim its
      // reservation before using the existing synchronous fallback.
      if (this.pending && this.pending.index === index) this.cancelPrefetch();
      // Evict before fetching so a miss does not temporarily exceed the budget.
      this.trim(MAX_CHUNKS - (this.pending ? 1 : 0) - 1);
      this.readAheadStats.misses++;
      chunk = this.fetchChunk(index);
    }
    this.chunks.set(index, chunk);
    return chunk;
  }

  read(buffer, offset, length, position) {
    if (position >= this.size) return 0;
    const total = Math.min(length, this.size - position);
    let done = 0;
    while (done < total) {
      const at = position + done;
      const index = Math.floor(at / CHUNK_SIZE);
      const within = at - index * CHUNK_SIZE;
      const chunk = this.getChunk(index);
      const count = Math.min(total - done, chunk.length - within);
      buffer.set(chunk.subarray(within, within + count), offset + done);
      done += count;
    }
    if (total > 0) {
      const first = Math.floor(position / CHUNK_SIZE);
      const last = Math.floor((position + total - 1) / CHUNK_SIZE);
      if (first === this.lastReadChunk || first === this.lastReadChunk + 1 || last > first) {
        this.prefetch(last + 1);
      } else if (this.pending && this.pending.index !== last + 1) {
        this.cancelPrefetch();
      }
      this.lastReadChunk = last;
    }
    return total;
  }

}
