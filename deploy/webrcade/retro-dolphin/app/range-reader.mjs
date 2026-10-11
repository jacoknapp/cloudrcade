// Only constructed inside Dolphin's worker. Atomics.wait never blocks the UI.
export class RangeReader {
  constructor(chunkSize, timeoutMs = 60000) {
    this.timeoutMs = timeoutMs;
    this.bytes = new Uint8Array(new SharedArrayBuffer(chunkSize));
    this.control = new Int32Array(new SharedArrayBuffer(8));
    this.initialized = false;
    this.worker = new Worker(new URL('./range-worker.mjs',import.meta.url),{type:'module'});
    // Await startup before blocking, then use a direct MessagePort: nested
    // Worker.postMessage delivery can depend on the blocked parent's event loop.
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.worker.postMessage({port:channel.port2},[channel.port2]);
    this.ready = new Promise((resolve,reject)=>{
      const timer = setTimeout(()=>{this.close(); reject(new Error('Game stream initialization timed out.'));},timeoutMs);
      this.port.onmessage = () => { clearTimeout(timer); this.initialized = true; resolve(); };
      this.worker.onerror = () => { clearTimeout(timer); this.close(); reject(new Error('Game stream worker failed to load.')); };
    });
  }
  read(request) {
    if (!this.worker) throw new Error('Game stream is closed.');
    if (!this.initialized) throw new Error('Wait for the game stream worker before reading.');
    Atomics.store(this.control,0,0);
    this.port.postMessage({...request,timeoutMs:this.timeoutMs,
      buffer:this.bytes.buffer,control:this.control.buffer});
    const result = Atomics.wait(this.control,0,0,this.timeoutMs);
    if (result === 'timed-out') { this.close(); throw new Error('Game stream timed out.'); }
    const length = Atomics.load(this.control,1);
    if (Atomics.load(this.control,0) !== 1) {
      const message = new TextDecoder().decode(this.bytes.slice(0,length));
      this.close(); throw new Error(message);
    }
    return this.bytes.slice(0,length);
  }
  close() { this.port.close(); this.worker?.terminate(); this.worker = null; }
}
