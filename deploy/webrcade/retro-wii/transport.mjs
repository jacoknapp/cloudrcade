import {inspectDisc} from './disc.mjs';
import {discValidator} from './range-fetch.mjs';

export const STREAM_THRESHOLD = 50_000_000;
async function readBounded(response, size) {
  const reader = response.body.getReader(), parts = []; let length = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > size) throw new Error('Game server returned too many bytes.');
      parts.push(value);
    }
    if (length !== size) throw new Error('Short read of game data.');
    return new Blob(parts);
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
}
export async function remoteDisc(value, {baseUrl = globalThis.location?.href, fetcher = fetch, signal, timeoutMs = 60000} = {}) {
  const url = new URL(value, baseUrl);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use an HTTP or HTTPS game URL without embedded credentials.');
  const name = decodeURIComponent(url.pathname.split('/').pop());
  if (!/\.(iso|wbfs|ciso)$/i.test(name)) throw new Error('Choose a Wii ISO, WBFS or CISO URL.');
  const abort = new AbortController(), cancel = () => abort.abort(signal.reason);
  signal?.addEventListener('abort',cancel,{once:true});
  if (signal?.aborted) cancel();
  const timer = setTimeout(()=>abort.abort(new Error('Game URL loading timed out.')),timeoutMs);
  let size, validator;
  async function range(first, last) {
    const response = await fetcher(url.href,{headers:{Range:`bytes=${first}-${last}`,
      ...(validator ? {'If-Range':validator.value} : {})},credentials:'same-origin',cache:'no-store',signal:abort.signal});
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
    const total = match ? Number(match[3]) : NaN;
    if (response.status !== 206 || !match || Number(match[1]) !== first || Number(match[2]) !== last ||
        !Number.isSafeInteger(total) || total <= last) {
      await response.body?.cancel();
      throw new Error('The game server must return exact HTTP byte ranges with Content-Range.');
    }
    if (size !== undefined && (size !== total || (validator && response.headers.get(validator.header) !== validator.value))) {
      await response.body?.cancel();
      throw new Error('The disc changed while loading.');
    }
    size = total;
    if (validator === undefined) validator = discValidator(response.headers);
    return readBounded(response,last-first+1);
  }
  try {
    const first = await range(0,31);
    if (size > STREAM_THRESHOLD && !validator)
      throw new Error('Streamed games require an exposed strong ETag or Last-Modified header.');
    const file = {name,size,slice:(start,end)=>({arrayBuffer:async()=>
      (start === 0 && end === 32 ? first : await range(start,end-1)).arrayBuffer()})};
    const disc = await inspectDisc(file);
    if (size > STREAM_THRESHOLD) return {...disc,disc,name,url:url.href,remote:true,validator};
    return new File([await range(0,size-1)],name,{type:'application/octet-stream'});
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',cancel); }
}
