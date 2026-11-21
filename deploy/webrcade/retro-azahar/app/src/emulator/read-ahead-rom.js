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
const MAX_READ_HINTS = 64;
const MAX_RECENT_ANCHORS = 16;
const MAX_WARM_RANGES = 6;
const MAX_BURST_RANGES = 3;
const MAX_BURST_PAGES = 10;
const BURST_WINDOW_MS = 1800;
const MIN_BURST_TOTAL_MS = 12;
const WARM_REUSE_WINDOW_MS = 45000;
const MIN_WARM_WAIT_MS = 12;
const MAX_RANGES_PER_HINT = 2;
const MAX_HINT_ATTEMPTS = MAX_READ_HINTS * MAX_RANGES_PER_HINT;
const MIN_HINT_LEAD_MS = 40;
const MAX_HINT_LEAD_MS = 2400;

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
    this.warmPages = new Set();
    this.warmUntil = -1;
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
      let index = this.chunks.keys().next().value;
      // Recently learned cold reads can otherwise be evicted by asset loading
      // before the player reaches them. Keep at most 54 warmed pages in the
      // shared cache through the initial play window.
      if (this.warmPages.has(index)) {
        for (const candidate of this.chunks.keys()) {
          if (!this.warmPages.has(candidate)) {
            index = candidate;
            break;
          }
        }
      }
      this.chunks.delete(index);
      this.prefetched.delete(index);
      this.warmPages.delete(index);
    }
  }

  cancelPrefetch() {
    const pending = this.pending;
    this.pending = null;
    if (pending) pending.controller.abort();
  }

  prefetch(index, pages = STREAM_PAGES, learned = null, warm = false) {
    if (this.closed || typeof fetch !== 'function' || typeof AbortController !== 'function' ||
        index * PAGE_SIZE >= this.size || this.chunks.has(index) ||
        index === this.failedPrefetch || this.pending) return;
    const first = index * PAGE_SIZE;
    const lastPage = this.lastUncachedPage(index, index + pages - 1);
    const last = Math.min((lastPage + 1) * PAGE_SIZE, this.size) - 1;
    const pending = { index, lastPage, learned, controller: new AbortController() };
    // Reserve the entire in-flight range inside the same 16 MiB budget.
    this.trim(MAX_PAGES - (lastPage - index + 1));
    this.pending = pending;
    fetchRange(this.url, this.size, first, last, pending.controller.signal).then((bytes) => {
      if (this.pending !== pending || this.closed) return;
      this.pending = null;
      this.storePages(index, bytes);
      const retainWarm = warm && (this.warmUntil < 0 || this.frameTime < this.warmUntil);
      for (let i = index; i <= lastPage; i++) {
        this.prefetched.add(i);
        if (retainWarm) this.warmPages.add(i);
      }
      this.readAheadStats.prefetched++;
      if (learned?.length) this.prefetchLearned(learned, warm);
    }).catch(() => {
      // Speculation never changes demand-read errors or retries a bad range
      // every frame. A cancelled/stale request cannot modify the current one.
      if (this.pending === pending) {
        this.pending = null;
        this.failedPrefetch = index;
      }
    });
    return true;
  }

  enableReadHints(uid, storage) {
    if (typeof uid !== 'string' || !/^[0-9a-f]{32}$/i.test(uid) || !storage) return;
    this.hintStorage = storage;
    this.hintKey = `wrcad.3ds.rom-hints.v2.${uid}.${this.size}`;
    this.readHints = new Map();
    this.recentAnchors = [];
    this.attemptedHints = new Set();
    this.startingHints = new Set();
    this.hintAttempts = 0;
    this.frameTime = -1;
    this.warmKey = `${this.hintKey}.warm.v1`;
    this.warmRanges = [];
    this.startingWarmRanges = new Map();
    this.usedWarmRanges = new Set();
    this.burstKey = `${this.hintKey}.burst.v1`;
    this.burstRanges = [];
    this.startingBursts = new Map();
    this.usedBurstRanges = new Set();
    try {
      const text = storage.getItem(this.warmKey);
      const ranges = text && text.length <= 512 ? JSON.parse(text) : [];
      if (Array.isArray(ranges) && ranges.length <= MAX_WARM_RANGES) {
        this.warmRanges = ranges.filter(range => Array.isArray(range) && range.length === 3 &&
          range.every(Number.isSafeInteger) && range[0] >= 0 && range[1] > 0 &&
          range[1] <= STREAM_PAGES && range[0] + range[1] <= Math.ceil(this.size / PAGE_SIZE) &&
          range[2] >= MIN_WARM_WAIT_MS && range[2] <= 2000);
        for (const range of this.warmRanges) this.startingWarmRanges.set(range[0], range);
      }
    } catch (error) { /* Warm hints are optional. */ }
    try {
      const text = storage.getItem(this.burstKey);
      const ranges = text && text.length <= 512 ? JSON.parse(text) : [];
      if (Array.isArray(ranges) && ranges.length <= MAX_BURST_RANGES) {
        for (const range of ranges) {
          if (Array.isArray(range) && range.length === 2 && range.every(Number.isSafeInteger) &&
              range[0] >= 0 && range[1] > 0 && range[1] <= MAX_BURST_PAGES &&
              range[0] + range[1] <= Math.ceil(this.size / PAGE_SIZE)) {
            this.startingBursts.set(range[0], range);
          }
        }
      }
    } catch (error) { /* Burst hints are optional. */ }
    // A foreground miss cancels the in-flight request and its continuation.
    this.prefetchLearned([...this.warmRanges, ...this.startingBursts.values()], true);
    this.warmRanges.sort((a, b) => b[2] - a[2]);
    try {
      const text = storage.getItem(this.hintKey);
      const rows = text && text.length <= 8192 ? JSON.parse(text) : [];
      if (!Array.isArray(rows) || rows.length > MAX_READ_HINTS) return;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 3) continue;
        const [before, after, ranges] = row;
        if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || !Array.isArray(ranges) ||
            ranges.length < 1 || ranges.length > MAX_RANGES_PER_HINT) continue;
        if (before >= 0 && before < this.size && after >= 0 && after < this.size &&
            before !== after && ranges.every(range => Array.isArray(range) && range.length === 2 &&
              range.every(Number.isSafeInteger) && range[0] >= 0 &&
              (range[0] + range[1] - 1) * PAGE_SIZE < this.size && range[1] >= 1 && range[1] <= 2)) {
          const key = `${before}:${after}`;
          this.readHints.set(key, row);
          this.startingHints.add(key);
        }
      }
    } catch (error) { /* Hints are optional on storage failures. */ }
  }

  markReadAheadFrame(time) {
    this.frameTime = time;
    this.anchorRecorded = false;
    if (this.warmPages.size) {
      if (this.warmUntil < 0) this.warmUntil = time + WARM_REUSE_WINDOW_MS;
      if (time >= this.warmUntil) this.warmPages.clear();
    }
  }

  prefetchLearned(ranges, warm = false) {
    for (let i = 0; i < ranges.length && (warm || this.hintAttempts < MAX_HINT_ATTEMPTS); i++) {
      const [page, count] = ranges[i];
      if (this.prefetch(page, count, ranges.slice(i + 1), warm)) {
        if (!warm) this.hintAttempts++;
        return true;
      }
    }
    return false;
  }

  rememberWarmRange(page, count, elapsed) {
    let ms = Math.min(Math.round(elapsed), 2000);
    if (ms < MIN_WARM_WAIT_MS) return;
    const previous = this.warmRanges.findIndex(range => range[0] === page);
    if (previous >= 0) {
      if (this.warmRanges[previous][1] >= count && this.warmRanges[previous][2] >= ms) return;
      const entry = this.warmRanges[previous];
      this.warmRanges.splice(previous, 1);
      count = Math.max(count, entry[1]);
      ms = Math.max(ms, entry[2]);
    } else if (this.warmRanges.length === MAX_WARM_RANGES && this.warmRanges.at(-1)[2] >= ms) {
      return;
    }
    this.warmRanges.push([page, count, ms]);
    this.warmRanges.sort((a, b) => b[2] - a[2]);
    this.warmRanges.length = Math.min(this.warmRanges.length, MAX_WARM_RANGES);
    this.warmChanged = true;
  }

  rememberBurst(page, count, elapsed) {
    if (elapsed < 4 || count > MAX_BURST_PAGES) return;
    const end = page + count;
    const previous = this.recentDemandBurst;
    const first = previous ? Math.min(page, previous.first) : page;
    const last = previous ? Math.max(end, previous.end) : end;
    if (!previous || this.frameTime - previous.time > BURST_WINDOW_MS ||
        last - first > MAX_BURST_PAGES || page > previous.end + 2 || end + 2 < previous.first) {
      this.recentDemandBurst = { first: page, end, time: this.frameTime, elapsed };
      return;
    }
    previous.first = first;
    previous.end = last;
    previous.elapsed += elapsed;
    if (previous.elapsed >= MIN_BURST_TOTAL_MS) {
      this.burstRanges = this.burstRanges.filter(([base, pages]) => base + pages <= first || base >= last);
      this.burstRanges.push([first, last - first]);
      if (this.burstRanges.length > MAX_BURST_RANGES) this.burstRanges.shift();
    }
  }

  observeShortRead(position, firstMissing, pages) {
    if (!this.readHints || this.frameTime < 0) return;
    if (firstMissing >= 0) {
      for (let i = this.recentAnchors.length - 1; i >= 0; i--) {
        const anchor = this.recentAnchors[i];
        const lead = this.frameTime - anchor.time;
        if (lead < MIN_HINT_LEAD_MS) continue;
        if (lead > MAX_HINT_LEAD_MS) break;
        if (this.startingHints.has(anchor.key) || anchor.misses >= MAX_RANGES_PER_HINT) break;
        let known = this.readHints.get(anchor.key);
        if (!known) {
          if (this.readHints.size === MAX_READ_HINTS) this.readHints.delete(this.readHints.keys().next().value);
          known = [anchor.before, anchor.after, []];
          this.readHints.set(anchor.key, known);
        }
        const range = known[2][anchor.misses++];
        if (range && (range[0] !== firstMissing || range[1] !== pages)) {
          this.readHints.delete(anchor.key);
          anchor.misses = MAX_RANGES_PER_HINT;
          this.hintsChanged = true;
        } else if (!range) {
          known[2].push([firstMissing, pages]);
          this.hintsChanged = true;
        }
        // Prefer the nearest anchor that left time for a fetch to complete.
        break;
      }
    }
    if (this.anchorRecorded || this.previousReadStart < 0 || position === this.previousReadStart) return;
    this.anchorRecorded = true;
    const before = this.previousReadStart;
    const key = `${before}:${position}`;
    if (this.recentAnchors.length === MAX_RECENT_ANCHORS) this.recentAnchors.shift();
    this.recentAnchors.push({ key, before, after: position, time: this.frameTime, misses: 0 });
    const hint = this.readHints.get(key);
    if (hint && this.startingHints.has(key) && !this.attemptedHints.has(key) &&
        this.prefetchLearned(hint[2])) {
      this.attemptedHints.add(key);
    }
  }

  close() {
    this.closed = true;
    if (this.headerController) this.headerController.abort();
    this.cancelPrefetch();
    this.chunks.clear();
    this.prefetched.clear();
    this.warmPages.clear();
    if (this.warmChanged) {
      this.warmChanged = false;
      try {
        // A range that served a demand read is more reliable than a new
        // candidate that might only reflect a single slow request.
        const known = new Map(this.warmRanges.map(range => [range[0], range]));
        const confirmed = [];
        for (const page of this.usedWarmRanges) {
          confirmed.push(known.get(page) || this.startingWarmRanges.get(page));
          known.delete(page);
        }
        const next = [...confirmed, ...known.values()].slice(0, MAX_WARM_RANGES);
        this.hintStorage.setItem(this.warmKey, JSON.stringify(next));
      } catch (error) { /* Warm hints are optional. */ }
    }
    if (this.burstRanges?.length) {
      const learned = this.burstRanges;
      this.burstRanges = [];
      try {
        const known = new Map(learned.map(range => [range[0], range]));
        const confirmed = [];
        for (const page of this.usedBurstRanges) {
          confirmed.push(known.get(page) || this.startingBursts.get(page));
          known.delete(page);
        }
        const recent = [...known.values()].reverse();
        const bursts = [...confirmed, ...recent].slice(0, MAX_BURST_RANGES);
        this.hintStorage.setItem(this.burstKey, JSON.stringify(bursts));
      } catch (error) { /* Burst hints are optional. */ }
    }
    if (this.hintsChanged) {
      this.hintsChanged = false;
      try {
        this.hintStorage.setItem(this.hintKey, JSON.stringify([...this.readHints.values()]));
      } catch (error) { /* Hints are optional on storage failures. */ }
    }
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
      if (this.prefetched.delete(index)) {
        this.readAheadStats.prefetchHits++;
        if (this.warmPages.has(index)) {
          if (this.startingWarmRanges.has(index)) this.usedWarmRanges.add(index);
          if (this.startingBursts.has(index)) this.usedBurstRanges.add(index);
        }
      }
    } else {
      // A demand read must not wait for an asynchronous request. Reclaim its
      // reservation before using the existing synchronous fallback.
      // Sparse reads fetch one page. A large read can demand up to 2 MiB
      // in one round trip. Stop at a cached page to avoid fetching it twice.
      const last = this.lastUncachedPage(index, lastNeeded);
      if (this.pending && (this.pending.learned ||
          (this.pending.index <= last && this.pending.lastPage >= index))) {
        this.cancelPrefetch();
      }
      const reserved = this.pending ? this.pending.lastPage - this.pending.index + 1 : 0;
      this.trim(MAX_PAGES - reserved - (last - index + 1));
      this.readAheadStats.misses++;
      const warmStart = this.warmRanges && this.frameTime >= 0 ? performance.now() : -1;
      if (last === index) {
        chunk = this.fetchChunk(index);
      } else {
        const firstByte = index * PAGE_SIZE;
        const bytes = this.fetchBytes(firstByte, Math.min((last + 1) * PAGE_SIZE, this.size) - 1);
        this.storePages(index, bytes);
        chunk = this.chunks.get(index);
        this.chunks.delete(index);
      }
      if (warmStart >= 0) {
        const elapsed = performance.now() - warmStart;
        this.rememberWarmRange(index, Math.min(last - index + 1, STREAM_PAGES), elapsed);
        this.rememberBurst(index, last - index + 1, elapsed);
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
    if (total > 0 && !forward && this.pending && !this.pending.learned) this.cancelPrefetch();
    let firstMissing = -1;
    const shortRead = this.readHints && this.frameTime >= 0 && total > 0 && total <= PAGE_SIZE;
    if (shortRead && !forward) {
      const firstPage = Math.floor(position / PAGE_SIZE);
      if (!this.chunks.has(firstPage)) firstMissing = firstPage;
      else if (!this.chunks.has(lastNeeded)) firstMissing = lastNeeded;
    }
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
      if (forward) {
        const next = Math.ceil(end / STREAM_SIZE) * STREAM_PAGES;
        if (next * PAGE_SIZE - end <= READ_AHEAD_DISTANCE && next * PAGE_SIZE < this.size) {
          if (this.pending?.learned && !this.chunks.has(next) &&
              (next < this.pending.index || next > this.pending.lastPage)) this.cancelPrefetch();
          this.prefetch(next);
        }
      }
      if (shortRead) this.observeShortRead(position, firstMissing, lastNeeded - firstMissing + 1);
      this.previousReadStart = position;
      this.previousReadEnd = end;
    }
    return total;
  }

}
