// GameCube-only readout. Reuses the existing worker poll; no GPU probes or
// browser animation counters. The Experimental Settings switch controls it.
export const PERF_KEY = 'wrcad.gamecube.perf.v1';
export function perfEnabled(storage) {
  try { return (storage || globalThis.localStorage).getItem(PERF_KEY) !== '0'; } catch { return true; }
}
function heapDetails(heap) {
  if (!heap) return [];
  const mib = bytes => (bytes/1048576).toFixed(1);
  return [
    `Native malloc: ${mib(heap.inUseBytes)} MiB in use · ${mib(heap.reusableBytes)} MiB reusable (sampled while paused)`,
    `Heap extent: ${mib(heap.extentBytes)}/${mib(heap.reservedBytes)} MiB (includes static/allocator space)`,
    `Heap inspection: ${heap.queryMs.toFixed(1)} ms while paused; no allocator scan during gameplay`
  ];
}

export class GameCubePerf {
  constructor(element) { this.element = element; this.previous = null; this.paused = false; this.details='Waiting for a performance sample.';this.lastFrame=null;this.targetFps=null; }
  setGameId(id) { this.targetFps = ({GMSE01:30,GMSJ01:30,GMSP01:25})[id] ?? null; }
  setHeapSample(heap) {
    const lines=this.details.split('\n').filter(line=>!/^Native malloc:|^Heap extent:|^Heap inspection:/.test(line));
    const index=lines.findIndex(line=>line.startsWith('Core allocation:'));
    lines.splice(index<0?lines.length:index,0,...heapDetails(heap));
    this.details=lines.join('\n');
  }
  reset(paused = false) {
    this.previous = null; this.paused = paused;
    this.element.textContent = paused ? 'GameCube paused' : 'GameCube measuring…';
  }
  sample(frame) {
    if (this.paused || ![frame.capturedAtMs, frame.frame, frame.coreTicks,
      frame.coreTicksPerSecond].every(Number.isFinite) || frame.coreTicksPerSecond <= 0) return;
    this.lastFrame=frame;
    const previous = this.previous;
    if (!previous || frame.loadedCheckpointGeneration !== previous.loadedCheckpointGeneration ||
      frame.frame < previous.frame || frame.coreTicks < previous.coreTicks ||
      frame.gamecubeDiagnostics?.render?.epoch !== previous.gamecubeDiagnostics?.render?.epoch ||
      (frame.gamecubeDiagnostics?.render?.frames ?? 0) < (previous.gamecubeDiagnostics?.render?.frames ?? 0)) {
      this.previous = frame; this.element.textContent = 'GameCube measuring…'; return;
    }
    const seconds = (frame.capturedAtMs - previous.capturedAtMs) / 1000;
    if (seconds < .75) return;
    this.previous = frame;
    const callbacks = (frame.frame - previous.frame) / seconds;
    const speed = (frame.coreTicks - previous.coreTicks) / frame.coreTicksPerSecond / seconds * 100;
    const d=frame.gamecubeDiagnostics || {},old=previous.gamecubeDiagnostics || {};
    const fps = Number.isFinite(d.render?.frames) && Number.isFinite(old.render?.frames)
      ? (d.render.frames-old.render.frames)/seconds : null;
    const resources=d.resources || frame.gpuResources;
    const delta=(key)=>Math.max(0,(d.stream?.[key]||0)-(old.stream?.[key]||0));
    const number=value=>Number.isFinite(value)?value.toFixed(1):'unavailable';
    const replayMs=d.replay&&old.replay?Math.max(0,d.replay.totalMs-old.replay.totalMs)/seconds:null;
    this.details=[
      `Rendered: ${number(fps)} fps · ${Math.round(speed)}% normal speed`,
      this.targetFps === null ? 'Target: game-native frame rate · 100% normal speed' : `Target: ${this.targetFps} rendered fps · 100% normal speed`,
      `Video callbacks: ${callbacks.toFixed(1)}/s (console video timing)`,
      `Presentation ceiling: ${d.fpsLimit ?? 60}/s`,
      `Frame gaps: p95 ${number(d.render?.p95Ms)} ms · max ${number(d.render?.maxMs)} ms (last 1s, ${d.render?.samples ?? 0} intervals)`,
      `Last rendered frame: ${number(d.render?.ageMs)} ms ago`,
      'Rendered FPS counts successful GPU submissions; pixel uniqueness and GPU completion time are not sampled.',
      `Replay JS: ${number(replayMs)} ms/s · lifetime longest drain ${number(d.replay?.maxMs)} ms`,
      `GPU backlog: ${d.backlog ?? 'unavailable'} commands · status round trip ${number(frame.hostPollMs)} ms`,
      `GPU execution time: unavailable (no GPU timing/readback probes)`,
      `CPU/JIT: ${d.jit || 'unavailable'} · ${d.compiled ?? 'unavailable'} compiled blocks`,
      `Shaders: ${resources?.shaderOk ?? 'unavailable'} ready / ${resources?.shaderFail ?? 'unavailable'} failed`,
      `GPU resources: ${resources?.textures ?? 'unavailable'} textures · ${resources?.bindGroups ?? 'unavailable'} bindings`,
      `Render misses: ${d.missingPipelines ?? 'unavailable'} pipelines / ${d.missingBindings ?? 'unavailable'} bindings · skipped draws ${d.skippedDraws ?? 'unavailable'} (lifetime)`,
      d.stream ? `Disc wait: ${number(delta('waitMs')/seconds)} ms/s · lifetime longest ${number(d.stream.waitMaxMs)} ms` : 'Disc: local file (network cache unused)',
      d.stream ? `Disc cache: ${d.stream.cachedChunks}/8 chunks · ${(d.stream.cachedBytes/1048576).toFixed(1)}/16 MiB · ${d.stream.pending} fetching` : '',
      d.stream ? `Reads this sample: ${delta('hits')} ready / ${delta('misses')} waited · ${delta('prefetchHits')} read-ahead hits` : '',
      d.stream ? `Network: ${(delta('bytesFetched')/1048576/seconds).toFixed(2)} MiB/s · ${delta('requests')} requests · ${d.stream.prefetchErrors} speculative errors (lifetime)` : '',
      ...heapDetails(d.heap),
      `Core allocation: ${Math.round(frame.heapBytes/1048576)} MiB (browser/GPU memory excluded)`,
      `Window: ${seconds.toFixed(1)} seconds of active play. Captured before pause.`,
      'Disc wait and replay JS can overlap CPU work. They are not additive CPU/GPU percentages.'
    ].filter(Boolean).join('\n');
    // Ticks measure emulated time, so 30 fps games need no guessed 60 fps target.
    this.element.textContent = `GameCube ${number(fps)} rendered fps  ${Math.round(speed)}% speed\n` +
      (this.targetFps === null ? '' : `Target ${this.targetFps} fps · 100% speed\n`) +
      `WebGPU · ${frame.renderWidth || frame.width}×${frame.renderHeight || frame.height} · ${Math.round(frame.heapBytes / 1048576)} MiB`;
  }
}

export function createPerfReadout(document = globalThis.document) {
  const element = document.createElement('pre'); element.id = 'gamecube-perf';
  element.setAttribute('aria-label', 'GameCube performance');
  element.style.cssText = 'position:fixed;left:env(safe-area-inset-left,0px);top:env(safe-area-inset-top,0px);' +
    'z-index:2147483646;margin:0;padding:3px 5px;font:10px/1.25 ui-monospace,Menlo,monospace;' +
    'color:#7CFC00;background:rgba(0,0,0,.72);pointer-events:none;white-space:pre;text-align:left';
  document.body.appendChild(element);
  const readout = new GameCubePerf(element); readout.reset(); return readout;
}
