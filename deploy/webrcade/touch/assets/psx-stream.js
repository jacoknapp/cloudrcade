// PlayStation-only HTTP disc reader. Saves keep the feed's original UID.
// Loaded before the pinned emulator bundle; hooks are checked by the generator.
(function () {
  'use strict';
  const CHUNK_SIZE = 2 * 1024 * 1024;
  const MAX_CHUNKS = 8;

  function validRange(status, header, first, last, size) {
    return status === 206 && header === `bytes ${first}-${last}/${size}`;
  }

  class Disc {
    constructor(url, size) {
      this.url = url;
      this.size = size;
      this.chunks = new Map();
      this.requests = 0;
      this.bytesFetched = 0;
    }

    fetchRange(first, last) {
      // Emscripten FS reads are synchronous. Main-thread sync XHR cannot use
      // arraybuffer, so decode each byte through x-user-defined instead.
      const xhr = new XMLHttpRequest();
      xhr.open('GET', this.url, false);
      xhr.setRequestHeader('Range', `bytes=${first}-${last}`);
      xhr.overrideMimeType('text/plain; charset=x-user-defined');
      xhr.send(null);
      if (!validRange(xhr.status, xhr.getResponseHeader('Content-Range'), first, last, this.size)) {
        throw new Error('PlayStation disc streaming failed. Reconnect or sign in again.');
      }
      this.requests++;
      const text = xhr.responseText;
      this.bytesFetched += last - first + 1;
      if (text.length !== last - first + 1) return null;
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
      return bytes;
    }

    getChunk(index) {
      let bytes = this.chunks.get(index);
      if (bytes) {
        this.chunks.delete(index);
      } else {
        if (this.chunks.size >= MAX_CHUNKS) this.chunks.delete(this.chunks.keys().next().value);
        const first = index * CHUNK_SIZE;
        const last = Math.min(first + CHUNK_SIZE, this.size) - 1;
        // Unicode BOM sniffing can override x-user-defined. Include up to
        // three preceding bytes to move a BOM away from the response start.
        for (let lead = 0; lead <= Math.min(first, 3); lead++) {
          bytes = this.fetchRange(first - lead, last);
          if (bytes) {
            if (lead) bytes = bytes.subarray(lead);
            break;
          }
        }
        if (!bytes) throw new Error('Short read of PlayStation disc data.');
      }
      this.chunks.set(index, bytes);
      return bytes;
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
      return total;
    }

    mount(FS, path) {
      try { FS.unlink(path); } catch (e) { /* new game */ }
      const slash = path.lastIndexOf('/');
      const node = FS.createFile(path.substring(0, slash), path.substring(slash + 1), {}, true, false);
      node.contents = null;
      Object.defineProperty(node, 'usedBytes', { get: () => this.size, set: () => {} });
      node.stream_ops = Object.assign({}, node.stream_ops, {
        read: (stream, buffer, offset, length, position) => this.read(buffer, offset, length, position),
        write: () => { throw new FS.ErrnoError(30); },
        mmap: () => { throw new FS.ErrnoError(48); },
      });
      return node;
    }
  }

  async function fetchDisc(fetcher, app, discUrl) {
    app.wrcadPendingDisc = null;
    if (!discUrl) return fetcher.fetch();
    const url = new URL(discUrl, location.href);
    // Direct local disc files support authenticated same-origin ranges. Keep
    // upstream download/proxy handling for archives and third-party feeds.
    if (url.origin !== location.origin || !/\.(chd|pbp)$/i.test(url.pathname)) return fetcher.fetch();
    let head;
    try { head = await fetch(url.href, { method: 'HEAD' }); } catch (e) { return fetcher.fetch(); }
    const size = Number(head.headers.get('Content-Length'));
    if (head.status !== 200 || head.redirected || head.headers.get('Accept-Ranges') !== 'bytes' ||
        !Number.isSafeInteger(size) || size <= 0 ||
        !/application\/octet-stream/i.test(head.headers.get('Content-Type') || '') ||
        head.headers.get('Content-Encoding')) return fetcher.fetch();
    // HEAD avoids a full GET (and an unintended service-worker full-disc copy).
    // Validate a real range before committing to this mode.
    const disc = new Disc(url.href, size);
    const last = Math.min(CHUNK_SIZE, size) - 1;
    const first = await fetch(url.href, { headers: { Range: `bytes=0-${last}` } });
    if (!validRange(first.status, first.headers.get('Content-Range'), 0, last, size)) {
      if (first.body) await first.body.cancel().catch(() => {});
      throw new Error('The server did not return the requested PlayStation disc range.');
    }
    const bytes = new Uint8Array(await first.arrayBuffer());
    if (bytes.length !== last + 1) throw new Error('Short read of PlayStation disc data.');
    disc.chunks.set(0, bytes);
    disc.requests = 1;
    disc.bytesFetched = bytes.length;
    app.wrcadPendingDisc = { response: head, disc };
    return head;
  }

  function attach(app, emulator) {
    const buffer = app.fetchResponseBuffer;
    app.fetchResponseBuffer = function (response, ...args) {
      const pending = this.wrcadPendingDisc;
      if (!pending || pending.response !== response) return buffer.call(this, response, ...args);
      emulator.wrcadLazyDisc = pending.disc;
      this.wrcadPendingDisc = null;
      // Disc IDs come from the feed, never from this placeholder. The normal
      // startup still writes BIOS, loads memory cards, and chooses CHD/PBP.
      return Promise.resolve(new Uint8Array([0]));
    };
    const exit = app.onPreExit;
    app.onPreExit = async function (...args) {
      try { return await exit.apply(this, args); }
      finally { if (emulator.wrcadLazyDisc) emulator.wrcadLazyDisc.chunks.clear(); }
    };
    return emulator;
  }

  window.WrcadPsxStreaming = { attach, fetchDisc, Disc };
}());
