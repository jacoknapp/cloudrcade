// Network I/O stays asynchronous here; the Dolphin worker waits on shared memory.
// Reject headers before reading a body, including a server's full-file response.
export function discValidator(headers) {
  const etag = headers.get('ETag');
  if (etag && /^"[^"\r\n]*"$/.test(etag)) return {header:'ETag',value:etag};
  const modified = headers.get('Last-Modified');
  if (modified && Number.isFinite(Date.parse(modified))) return {header:'Last-Modified',value:modified};
  return null;
}
export async function fetchDiscRange({url,size,first,last,validator}, target, {fetcher = fetch, signal} = {}) {
  const response = await fetcher(url,{headers:{Range:`bytes=${first}-${last}`,'If-Range':validator.value},
    credentials:'same-origin',cache:'no-store',signal});
  if (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${first}-${last}/${size}` ||
      response.headers.get(validator.header) !== validator.value) {
    await response.body?.cancel();
    throw new Error('Game stream changed or returned an invalid HTTP byte range.');
  }
  const expected = last-first+1;
  if (expected > target.length) { await response.body?.cancel(); throw new Error('Game range exceeds the disk buffer.'); }
  const reader = response.body.getReader(); let length = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      if (length + value.length > expected) throw new Error('Game stream exceeded the requested range.');
      target.set(value,length); length += value.length;
    }
    if (length !== expected) throw new Error('Short read of streamed game data.');
    return length;
  } catch (error) { await reader.cancel().catch(()=>{}); throw error; }
  finally { reader.releaseLock(); }
}
