// Read-only file backed by HTTP range requests, for games too large to hold in memory.
//
// The Emscripten file system runs on the browser thread, so chunks are fetched with
// synchronous requests; those cannot return binary data, hence the x-user-defined decoding.

const CHUNK_SIZE = 2 * 1024 * 1024;
const MAX_CHUNKS = 8; // At most 16 MiB, including on phones.

export class LazyRom {
  constructor(url, size) {
    this.url = url;
    this.size = size;
    this.chunks = new Map(); // insertion order doubles as LRU order
  }

  // One request for the bytes first..last. Null when the browser did not return
  // exactly those bytes.
  fetchRange(first, last) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', this.url, false);
    xhr.setRequestHeader('Range', `bytes=${first}-${last}`);
    xhr.overrideMimeType('text/plain; charset=x-user-defined');
    xhr.send(null);
    if (xhr.status !== 206) {
      throw new Error(`Unexpected status ${xhr.status} reading game data`);
    }
    const text = xhr.responseText;
    if (text.length !== last - first + 1) return null;
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      bytes[i] = text.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  fetchChunk(index) {
    const first = index * CHUNK_SIZE;
    const last = Math.min(first + CHUNK_SIZE, this.size) - 1;
    // A response that happens to start with a byte-order mark (FE FF, FF FE,
    // EF BB BF) is decoded as Unicode whatever charset was asked for, and comes
    // back with the wrong length. Start such a chunk a few bytes early instead.
    for (let lead = 0; lead <= Math.min(first, 3); lead++) {
      const bytes = this.fetchRange(first - lead, last);
      if (bytes) return lead ? bytes.subarray(lead) : bytes;
    }
    throw new Error('Short read of game data');
  }

  getChunk(index) {
    let chunk = this.chunks.get(index);
    if (chunk) {
      this.chunks.delete(index);
    } else {
      // Evict before fetching so a miss does not temporarily exceed the budget.
      if (this.chunks.size >= MAX_CHUNKS) {
        this.chunks.delete(this.chunks.keys().next().value);
      }
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
    return total;
  }

  // Replaces `path` with a file whose contents come from this object.
  mount(FS, path) {
    try { FS.unlink(path); } catch (e) { /* not there */ }
    const slash = path.lastIndexOf('/');
    const node = FS.createFile(path.substring(0, slash), path.substring(slash + 1), {}, true, false);
    const size = this.size;
    node.contents = null;
    Object.defineProperty(node, 'usedBytes', { get: () => size, set: () => {} });
    const stream_ops = Object.assign({}, node.stream_ops);
    stream_ops.read = (stream, buffer, offset, length, position) =>
      this.read(buffer, offset, length, position);
    stream_ops.write = () => { throw new FS.ErrnoError(30 /* EROFS */); };
    stream_ops.mmap = () => { throw new FS.ErrnoError(48 /* ENODEV */); };
    node.stream_ops = stream_ops;
    return node;
  }
}
