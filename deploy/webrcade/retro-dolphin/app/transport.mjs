import {inspectDisc} from './session.mjs';
import {discValidator} from './range-fetch.mjs';

// Above 50 MB, never fetch the whole image or allocate it in the WASM heap.
export const STREAM_THRESHOLD = 50_000_000;
function rangeInfo(response, first, last) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
  if (response.status !== 206 || !match || +match[1] !== first || +match[2] !== last ||
      !Number.isSafeInteger(+match[3]) || +match[3] <= last) {
    response.body?.cancel().catch(() => {});
    throw new Error('The game server must return exact HTTP byte ranges with Content-Range.');
  }
  return +match[3];
}
async function readBounded(response, size) {
  const reader = response.body.getReader();
  const parts = []; let length = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > size) throw new Error('Game server returned too many bytes.');
      parts.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  if (length !== size) throw new Error('Short read of game data.');
  return parts;
}

export async function remoteDisc(value, {baseUrl = globalThis.location?.href, fetcher = fetch, signal, timeoutMs = 60000} = {}) {
  const url = new URL(value, baseUrl);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP or HTTPS game URL without embedded credentials.');
  }
  const name = decodeURIComponent(url.pathname.split('/').pop());
  if (!/\.(iso|gcm)$/i.test(name)) throw new Error('Choose a GameCube ISO or GCM URL.');
  const abort = new AbortController();
  const cancel = () => abort.abort(signal.reason);
  signal?.addEventListener('abort',cancel,{once:true});
  if (signal?.aborted) cancel();
  const timer = setTimeout(()=>abort.abort(new Error('Game URL loading timed out.')),timeoutMs);
  try {
    const request = {headers:{Range:'bytes=0-31'}, credentials:'same-origin',cache:'no-store',signal:abort.signal};
    const response = await fetcher(url.href, request);
    const size = rangeInfo(response,0,31);
    const validator = discValidator(response.headers);
    const header = new Blob(await readBounded(response,32));
    const info = await inspectDisc({name,size,slice:()=>header});
    if (size > STREAM_THRESHOLD && !validator) throw new Error('Streamed games require an exposed strong ETag or Last-Modified header.');
    if (size > STREAM_THRESHOLD) return {...info,name,url:url.href,remote:true,validator,
      header:new Uint8Array(await header.arrayBuffer())};
    const full = await fetcher(url.href,{...request,headers:{Range:`bytes=0-${size-1}`,...(validator ? {'If-Range':validator.value} : {})}});
    if (rangeInfo(full,0,size-1) !== size || (validator && full.headers.get(validator.header) !== validator.value)) {
      await full.body?.cancel();
      throw new Error('The disc changed while loading.');
    }
    return new File(await readBounded(full,size),name,{type:'application/octet-stream'});
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',cancel); }
}
