import {jitCacheProfile} from './jit-cache-profile.mjs';
const INPUT_FIELDS = ['mask','stickX','stickY','cStickX','cStickY','triggerLeft','triggerRight','analogA','analogB'];
// CloudRcade GameCube session. The upstream Dolphin runtime is GPL-2.0-or-later.
export function requireCapabilities(scope = globalThis) {
  if (!scope.isSecureContext || !scope.crossOriginIsolated ||
      typeof scope.SharedArrayBuffer !== 'function' || typeof scope.Worker !== 'function') {
    throw new Error('GameCube requires HTTPS or localhost, cross-origin isolation and shared-memory workers.');
  }
  if (!scope.navigator?.gpu) throw new Error('GameCube requires browser WebGPU support.');
}

export async function requireHardwareGpu(scope = globalThis) {
  const adapter = await scope.navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if (!adapter) throw new Error('The browser could not access the device GPU.');
  const info = adapter.info || await adapter.requestAdapterInfo?.();
  if (info?.isFallbackAdapter || adapter.isFallbackAdapter ||
      /swiftshader|llvmpipe|lavapipe|software/i.test(info?.description || '')) {
    throw new Error('GameCube requires the device GPU; software WebGPU adapters are unsupported.');
  }
}

export async function inspectDisc(file) {
  if (!file || !/\.(iso|gcm)$/i.test(file.name || '')) {
    throw new Error('Choose a GameCube ISO or GCM disc image.');
  }
  // Read only the header. A multi-gigabyte disc must never be copied into MEMFS.
  const bytes = new Uint8Array(await file.slice(0, 0x20).arrayBuffer());
  if (bytes.length !== 0x20 || new DataView(bytes.buffer).getUint32(0x1c) !== 0xc2339f3d) {
    throw new Error('This image has no GameCube disc header.');
  }
  if (new DataView(bytes.buffer).getUint32(0x18) === 0x5d1c9ea3) {
    throw new Error('Wii discs are outside this GameCube experiment.');
  }
  const gameId = String.fromCharCode(...bytes.slice(0, 6));
  if (!/^[A-Z0-9]{6}$/.test(gameId)) throw new Error('Invalid GameCube disc identity.');
  return {gameId, size: file.size};
}

export class GameCubeSession {
  constructor({scope = globalThis, canvas, createAdapter, onStatus = () => {}, onTelemetry = () => {}, onFatal = () => {}, timeoutMs = 60000, nativeTimingEnabled = false} = {}) {
    this.scope = scope;
    this.createAdapter = createAdapter || (async options => {
      const {UpstreamWorkerAdapter} = await import('./vendor/src/upstream-worker-adapter.js');
      return new UpstreamWorkerAdapter(options);
    });
    this.onStatus = onStatus;
    this.onTelemetry = onTelemetry;
    this.onFatal = onFatal;
    this.canvas = canvas;
    this.timeoutMs = timeoutMs;
    this.nativeTimingEnabled = Boolean(nativeTimingEnabled);
    this.frameSkip = 1;
    this.adapter = null;
    this.initializing = null;
    this.closed = false;
    this.booted = false;
    this.booting = false;
    this.paused = false;
    this.pauseRequested = false;
    this.transition = Promise.resolve();
    this.lastInput = null;
    this.pollPending = false;
    this.lastPollAt = -Infinity;
    this.progressFrame = null;
    this.progressAt = null;
  }

  async bounded(operation) {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('GameCube core timed out.')), this.timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }

  async initialize() {
    if (this.closed) throw new Error('GameCube session is closed.');
    requireCapabilities(this.scope);
    if (!this.initializing) this.initializing = (async () => {
      await this.bounded(requireHardwareGpu(this.scope));
      if (this.closed) throw new Error('GameCube session is closed.');
      if (typeof this.canvas?.transferControlToOffscreen !== 'function') {
        throw new Error('GameCube requires an OffscreenCanvas for browser GPU rendering.');
      }
      const creating = Promise.resolve(this.createAdapter({onStatus: this.onStatus,
        videoBackend: 'WebGPU-Real', presenterBackend: 'webgpu',
        transferCanvas:()=>this.canvas.transferControlToOffscreen(),
        cpuThread: true, cpuCore: 'cached', ppcWasmJit: true,
        ppcWasmJitTier: 'guarded', ppcWasmJitForce: false, ppcWasmJitWarmupFrames: 120,
        // The hardware command ring presents at native resolution. Minimize
        // its unused legacy CPU XFB notification image, not the GPU render.
        presentationScale: 0.25, emulationSpeed: 1,
        // GameCube-only native device-GPU path. Keep diagnostic GPU probes off.
        // Direct queue uploads reuse bounded host scratch and avoid the three
        // 16 MiB GPU staging buffers and asynchronous remap dependency.
        wgpuGeometryPack: true, wgpuUploadTransport: 'queue',
        // Skip comparisons only when a fresh uniform upload is mandatory.
        wgpuUniformFast: true,
        wgpuReplayPump: true, wgpuDiagnosticQuiet: true,
        noJitCache: true, collectMetrics: false})).then(adapter => {
        if (this.closed) {
          adapter.worker?.terminate();
          throw new Error('GameCube session is closed.');
        }
        return adapter;
      });
      const adapter = await this.bounded(creating);
      this.adapter = adapter;
      const applyFrame = adapter.applyFrame.bind(adapter);
      adapter.applyFrame = response => {
        if (this.closed) return;
        if (response.runtimeFailure) { this.fail(new Error(response.runtimeFailure)); return; }
        if (this.booted && !this.paused && Number.isFinite(response.frame)) {
          const now = performance.now();
          if (response.frame !== this.progressFrame || this.progressAt === null) {
            this.progressFrame = response.frame; this.progressAt = now;
          } else if (now - this.progressAt >= this.timeoutMs) {
            this.fail(new Error('GameCube stopped producing frames.')); return;
          }
        }
        applyFrame(response);
        if (!this.closed) this.onTelemetry({...response,hostPollMs:this.lastPollMs || 0});
      };
      // The GPU presents directly; status polling does not need a 4 Hz cadence.
      adapter.telemetryIntervalMs = 1000;
      await this.bounded(adapter.load());
      if (this.closed) throw new Error('GameCube session is closed.');
      this.jitCache = await this.bounded(adapter.request('jitCacheProfile',
        {profile:jitCacheProfile(this.scope.navigator)}));
      if (this.closed) throw new Error('GameCube session is closed.');
      if (this.frameSkip !== 1) await this.bounded(adapter.request('frameSkip',{divisor:this.frameSkip}));
      if (this.nativeTimingEnabled) await this.bounded(adapter.request('nativeTiming',{enabled:true}));
      adapter.worker?.addEventListener?.('error', event => this.fail(new Error(event.message || 'GameCube worker failed.')));
      adapter.worker?.addEventListener?.('messageerror', () => this.fail(new Error('GameCube worker communication failed.')));
      adapter.worker?.addEventListener?.('message', event => {
        if (event.data?.type === 'gamecube-fatal') this.fail(new Error(event.data.message || 'GameCube core failed.'));
      });
      adapter.setAudioMuted(true);
      return adapter;
    })();
    try { return await this.initializing; }
    catch (error) { this.dispose(); throw error; }
  }

  async boot(file, beforeBoot = async () => {}) {
    if (this.booted || this.booting) throw new Error('Close this session before loading another disc.');
    this.booting = true;
    try {
      const disc = await inspectDisc(file.remote ? {...file,slice:()=>new Blob([file.header])} : file);
      const adapter = await this.initialize();
      await beforeBoot(adapter, disc);
      let metadata;
      if (file.remote) {
        metadata = await this.bounded(adapter.request('mountUrl',{url:file.url,name:file.name,size:file.size,validator:file.validator}));
        adapter.applyMetadata(metadata); adapter.applyFrame(metadata);
      } else metadata = await this.bounded(adapter.mountGame(file));
      if (this.closed) throw new Error('GameCube session is closed.');
      if (!metadata.fullCore || !metadata.coreBoot?.accepted) {
        throw new Error('Dolphin could inspect the disc but did not boot it.');
      }
      const started = await this.bounded(adapter.request('start'));
      if (this.closed) throw new Error('GameCube session is closed.');
      adapter.applyFrame(started);
      if (this.closed) throw new Error('GameCube session failed during startup.');
      this.booted = true;
      this.paused = false;
      return {...disc, ...metadata};
    } catch (error) { this.dispose(); throw error; }
    finally { this.booting = false; }
  }

  setInput(state) {
    if (!this.booted || this.paused || this.closed) return;
    const previous = this.lastInput;
    let changed = !previous;
    if (previous) for (const field of INPUT_FIELDS) {
      if (previous[field] !== state[field]) { changed = true; break; }
    }
    if (!changed) return;
    if (!previous) this.lastInput = {};
    for (const field of INPUT_FIELDS) this.lastInput[field] = state[field];
    this.adapter.setInputState(state);
  }
  async setFrameSkip(divisor) {
    const adapter=this.adapter;
    if(adapter?.loaded) await this.bounded(adapter.request('frameSkip',{divisor}));
    this.frameSkip=divisor;
  }
  async pause() {
    if (!this.booted || this.closed) return;
    if (this.pauseRequested) return this.transition;
    this.pauseRequested = true;
    this.lastInput = null;
    this.adapter.setInputState({mask: 0, stickX: 128, stickY: 128,
      cStickX: 128, cStickY: 128, triggerLeft: 0, triggerRight: 0, analogA: 0, analogB: 0});
    this.paused = true;
    return this.changeState('pause');
  }
  async resume() {
    if (this.booted && !this.closed) {
      this.pauseRequested = false;
      return this.changeState('start');
    }
  }
  changeState(type) {
    const adapter = this.adapter;
    this.transition = this.transition.then(async () => {
      if (this.closed || this.adapter !== adapter) return;
      try {
        const result = await this.bounded(adapter.request(type));
        if (this.closed) return;
        if (type === 'start') {
          if (!this.pauseRequested) this.paused = false;
          this.lastPollAt = -Infinity;
          this.progressAt = null;
        }
        return result;
      } catch (error) { this.fail(error); throw error; }
    });
    return this.transition;
  }
  poll() {
    if (!this.booted || this.closed || this.paused || this.pollPending) return;
    const now = performance.now();
    if (now - this.lastPollAt < 1000) return;
    this.lastPollAt = now; this.pollPending = true;
    const adapter = this.adapter;
    void this.bounded(Promise.resolve().then(() => adapter.request('runFrame'))).then(frame => {
      this.lastPollMs=performance.now()-now;
      if (!this.closed && !this.paused) adapter.applyFrame(frame);
    }).catch(error => this.fail(error)).finally(() => { this.pollPending = false; });
  }
  fail(error) {
    if (this.closed) return;
    this.dispose();
    this.onFatal(error instanceof Error ? error : new Error(String(error)));
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.booted = false;
    if (this.adapter) {
      this.adapter.rejectAll('GameCube session closed.');
      this.adapter.worker?.terminate();
      this.adapter.worker = null;
      this.adapter.loaded = false;
      this.adapter.frameData = null;
      this.adapter = null;
    }
  }
}
