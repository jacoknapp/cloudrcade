import {fetchDiscRange} from './range-fetch.mjs';

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  const read = async ({data}) => {
    const control = new Int32Array(data.control), bytes = new Uint8Array(data.buffer);
    const abort = new AbortController();
    const timer = setTimeout(()=>abort.abort(),data.timeoutMs);
    let state = 1, length;
    try { length = await fetchDiscRange(data,bytes,{signal:abort.signal}); }
    catch (error) {
      state = -1;
      const message = new TextEncoder().encode(error.message || 'Game stream failed.');
      length = Math.min(message.length,bytes.length);
      bytes.set(message.subarray(0,length));
    } finally { clearTimeout(timer); }
    Atomics.store(control,1,length);
    Atomics.store(control,0,state);
    Atomics.notify(control,0);
  };
  self.onmessage = ({data:{port}}) => {
    port.onmessage = read;
    port.postMessage({ready:true});
  };
}
