import {readStreamStats,STREAM_FIELDS} from './range-cache.mjs';
// Only constructed inside Dolphin's worker. Atomics.wait never blocks the UI.
export class RangeReader {
  constructor(chunkSize, timeoutMs = 60000, maxChunks = 8) {
    this.timeoutMs = timeoutMs;this.maxChunks=maxChunks;this.waitMs=0;this.waitMaxMs=0;
    this.metrics = new SharedArrayBuffer(8+STREAM_FIELDS.length*8);
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
      buffer:this.bytes.buffer,control:this.control.buffer,stats:this.metrics,maxChunks:this.maxChunks});
    const started=performance.now();
    const result = Atomics.wait(this.control,0,0,this.timeoutMs);
    const waited=performance.now()-started;this.waitMs+=waited;this.waitMaxMs=Math.max(this.waitMaxMs,waited);
    if (result === 'timed-out') { this.close(); throw new Error('Game stream timed out.'); }
    const length = Atomics.load(this.control,1);
    if (Atomics.load(this.control,0) !== 1) {
      const message = new TextDecoder().decode(this.bytes.slice(0,length));
      this.close(); throw new Error(message);
    }
    // read() consumes this view before the next synchronous request.
    return this.bytes.subarray(0,length);
  }
  stats() {this.snapshot=readStreamStats(this.metrics,this.snapshot);return {...this.snapshot,...(!this.worker?{cachedChunks:0,cachedBytes:0,pending:0}:{}),waitMs:this.waitMs,waitMaxMs:this.waitMaxMs};}
  close() { this.port.close(); this.worker?.terminate(); this.worker = null; }
}
