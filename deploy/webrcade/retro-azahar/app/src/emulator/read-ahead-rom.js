import { LazyRom, CHUNK_SIZE, MAX_CHUNKS } from './lazyrom';

// Speculative binary reads are scoped to 3DS; other cores keep the demand reader.
const READ_AHEAD_DISTANCE = CHUNK_SIZE / 4;
const MAX_FORWARD_GAP = 64 * 1024;
const GAME_ID_BYTES = 64 * 1024;

async function fetchRange(url, size, first, last, signal, allowHiddenRange = false) {
  const response = await fetch(url, { headers: { Range: `bytes=${first}-${last}` }, signal });
  const range = response.headers.get('Content-Range');
  if (response.status !== 206 ||
      (range !== `bytes ${first}-${last}/${size}` && !(allowHiddenRange && range === null))) {
    if (response.body) await response.body.cancel();
    throw new Error('The server did not return the requested range of this game.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== last - first + 1) throw new Error('Short game data range');
  return bytes;
}

export class ReadAheadRom extends LazyRom {
  constructor(url, size) {
    super(url, size);
    this.pending = null;
    this.previousReadStart = -1;
    this.previousReadEnd = -1;
    this.failedPrefetch = -1;
    this.closed = false;
    this.lastDemandIndex = -1;
    this.headerController = null;
    this.prefetched = new Set();
    this.readAheadStats = { misses: 0, prefetched: 0, prefetchHits: 0 };
  }

  // Use a binary request for the first chunk before the core starts reading.
  // The launcher hashes just the original 64 KiB to locate the game's saves.
  async readHeader() {
    if (this.closed) throw new Error('Game data is closed');
    const initialSize = Math.min(this.size, CHUNK_SIZE);
    const idSize = Math.min(this.size, GAME_ID_BYTES);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    this.headerController = controller;
    const signal = controller ? controller.signal : undefined;
    try {
      const bytes = await fetchRange(this.url, this.size, 0, initialSize - 1, signal);
      if (this.closed) throw new Error('Game data is closed');
      this.chunks.set(0, bytes);
      this.lastDemandIndex = 0;
      return bytes.slice(0, idSize);
    } catch (error) {
      if (this.closed) throw error;
      // Some hosts cap ranges or hide Content-Range across origins. Keep the
      // original short request available, without caching its result as a chunk.
      const header = await fetchRange(this.url, this.size, 0, idSize - 1, signal, true);
      if (this.closed) throw new Error('Game data is closed');
      return header;
    } finally {
      this.headerController = null;
    }
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
    fetchRange(this.url, this.size, first, last, pending.controller.signal).then((bytes) => {
      if (this.pending !== pending || this.closed) return;
      this.pending = null;
      this.chunks.set(index, bytes);
      this.lastDemandIndex = -1; // The completed prefetch is now newest.
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
    if (this.headerController) this.headerController.abort();
    this.cancelPrefetch();
    this.chunks.clear();
    this.prefetched.clear();
  }

  getChunk(index) {
    if (this.closed) throw new Error('Game data is closed');
    let chunk = this.chunks.get(index);
    if (chunk) {
      if (index === this.lastDemandIndex) return chunk;
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
    this.lastDemandIndex = index;
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
      const end = position + total;
      const nextChunk = Math.ceil(end / CHUNK_SIZE);
      const forward = this.previousReadStart >= 0 && position >= this.previousReadStart &&
        position <= this.previousReadEnd + MAX_FORWARD_GAP && end > this.previousReadEnd;
      if (this.pending && this.pending.index !== nextChunk) this.cancelPrefetch();
      if (forward && nextChunk * CHUNK_SIZE - end <= READ_AHEAD_DISTANCE) {
        this.prefetch(nextChunk);
      }
      this.previousReadStart = position;
      this.previousReadEnd = end;
    }
    return total;
  }

}
