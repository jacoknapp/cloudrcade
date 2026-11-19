import { LazyRom } from './lazyrom';

// Speculative binary reads are scoped to 3DS; other cores keep the demand reader.
export const PAGE_SIZE = 64 * 1024;
export const STREAM_SIZE = 256 * 1024;
const STREAM_PAGES = STREAM_SIZE / PAGE_SIZE;
export const MAX_PAGES = (16 * 1024 * 1024) / PAGE_SIZE;
const MAX_REQUEST_PAGES = (2 * 1024 * 1024) / PAGE_SIZE;
const READ_AHEAD_DISTANCE = STREAM_SIZE / 4;
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
    const initialSize = Math.min(this.size, STREAM_SIZE);
    const idSize = Math.min(this.size, GAME_ID_BYTES);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    this.headerController = controller;
    const signal = controller ? controller.signal : undefined;
    try {
      const bytes = await fetchRange(this.url, this.size, 0, initialSize - 1, signal);
      if (this.closed) throw new Error('Game data is closed');
      this.storePages(0, bytes);
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

  storePages(first, bytes) {
    // Independent backing stores let eviction release individual pages.
    for (let offset = 0; offset < bytes.length; offset += PAGE_SIZE) {
      const page = bytes.length <= PAGE_SIZE ? bytes : bytes.slice(offset, offset + PAGE_SIZE);
      this.chunks.set(first + offset / PAGE_SIZE, page);
    }
    this.lastDemandIndex = -1;
  }

  lastUncachedPage(index, requestedLast) {
    const limit = Math.min(requestedLast, index + MAX_REQUEST_PAGES - 1,
      Math.ceil(this.size / PAGE_SIZE) - 1);
    let last = index;
    while (last < limit && !this.chunks.has(last + 1)) last++;
    return last;
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
        index * PAGE_SIZE >= this.size || this.chunks.has(index) ||
        index === this.failedPrefetch || this.pending) return;
    const first = index * PAGE_SIZE;
    const lastPage = this.lastUncachedPage(index, index + STREAM_PAGES - 1);
    const last = Math.min((lastPage + 1) * PAGE_SIZE, this.size) - 1;
    const pending = { index, lastPage, controller: new AbortController() };
    // Reserve the entire in-flight range inside the same 16 MiB budget.
    this.trim(MAX_PAGES - (lastPage - index + 1));
    this.pending = pending;
    fetchRange(this.url, this.size, first, last, pending.controller.signal).then((bytes) => {
      if (this.pending !== pending || this.closed) return;
      this.pending = null;
      this.storePages(index, bytes);
      for (let i = index; i <= lastPage; i++) this.prefetched.add(i);
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

  fetchChunk(index) {
    const first = index * PAGE_SIZE;
    return this.fetchBytes(first, Math.min(first + PAGE_SIZE, this.size) - 1);
  }

  getChunk(index, lastNeeded = index) {
    if (this.closed) throw new Error('Game data is closed');
    let chunk = this.chunks.get(index);
    if (chunk) {
      if (index === this.lastDemandIndex) return chunk;
      this.chunks.delete(index);
      if (this.prefetched.delete(index)) this.readAheadStats.prefetchHits++;
    } else {
      // A demand read must not wait for an asynchronous request. Reclaim its
      // reservation before using the existing synchronous fallback.
      // Sparse reads fetch one page. A large read can demand up to 2 MiB
      // in one round trip. Stop at a cached page to avoid fetching it twice.
      const last = this.lastUncachedPage(index, lastNeeded);
      if (this.pending && this.pending.index <= last && this.pending.lastPage >= index) {
        this.cancelPrefetch();
      }
      const reserved = this.pending ? this.pending.lastPage - this.pending.index + 1 : 0;
      this.trim(MAX_PAGES - reserved - (last - index + 1));
      this.readAheadStats.misses++;
      if (last === index) {
        chunk = this.fetchChunk(index);
      } else {
        const firstByte = index * PAGE_SIZE;
        const bytes = this.fetchBytes(firstByte, Math.min((last + 1) * PAGE_SIZE, this.size) - 1);
        this.storePages(index, bytes);
        chunk = this.chunks.get(index);
        this.chunks.delete(index);
      }
    }
    this.chunks.set(index, chunk);
    this.lastDemandIndex = index;
    return chunk;
  }

  read(buffer, offset, length, position) {
    if (position >= this.size) return 0;
    const total = Math.min(length, this.size - position);
    const lastNeeded = Math.floor((position + total - 1) / PAGE_SIZE);
    const end = position + total;
    const forward = this.previousReadStart >= 0 && position >= this.previousReadStart &&
      position <= this.previousReadEnd + MAX_FORWARD_GAP && end > this.previousReadEnd;
    const sequential = total > 0 && position === this.previousReadEnd;
    if (total > 0 && !forward && this.pending) this.cancelPrefetch();
    let done = 0;
    while (done < total) {
      const at = position + done;
      const index = Math.floor(at / PAGE_SIZE);
      const within = at - index * PAGE_SIZE;
      // Isolated seeks fetch only the pages the guest requested. Consecutive
      // reads amortize network latency over up to 256 KiB on a cache miss.
      const through = sequential ? Math.max(lastNeeded, index + STREAM_PAGES - 1) : lastNeeded;
      const chunk = this.getChunk(index, through);
      const count = Math.min(total - done, chunk.length - within);
      buffer.set(chunk.subarray(within, within + count), offset + done);
      done += count;
    }
    if (total > 0) {
      if (forward && !this.pending) {
        const next = Math.ceil(end / STREAM_SIZE) * STREAM_PAGES;
        if (next * PAGE_SIZE - end <= READ_AHEAD_DISTANCE) this.prefetch(next);
      }
      this.previousReadStart = position;
      this.previousReadEnd = end;
    }
    return total;
  }

}
