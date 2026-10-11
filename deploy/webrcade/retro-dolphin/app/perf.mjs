// GameCube-only readout. Reuses the existing worker poll; no GPU probes or
// browser animation counters. The Experimental Settings switch controls it.
export const PERF_KEY = 'wrcad.gamecube.perf.v1';
export function perfEnabled(storage) {
  try { return (storage || globalThis.localStorage).getItem(PERF_KEY) !== '0'; } catch { return true; }
}

export class GameCubePerf {
  constructor(element) { this.element = element; this.previous = null; this.paused = false; }
  reset(paused = false) {
    this.previous = null; this.paused = paused;
    this.element.textContent = paused ? 'GameCube paused' : 'GameCube measuring…';
  }
  sample(frame) {
    if (this.paused || ![frame.capturedAtMs, frame.frame, frame.coreTicks,
      frame.coreTicksPerSecond].every(Number.isFinite) || frame.coreTicksPerSecond <= 0) return;
    const previous = this.previous;
    if (!previous || frame.loadedCheckpointGeneration !== previous.loadedCheckpointGeneration ||
      frame.frame < previous.frame || frame.coreTicks < previous.coreTicks) {
      this.previous = frame; this.element.textContent = 'GameCube measuring…'; return;
    }
    const seconds = (frame.capturedAtMs - previous.capturedAtMs) / 1000;
    if (seconds < .75) return;
    this.previous = frame;
    const fps = (frame.frame - previous.frame) / seconds;
    const speed = (frame.coreTicks - previous.coreTicks) / frame.coreTicksPerSecond / seconds * 100;
    // Ticks measure emulated time, so 30 fps games need no guessed 60 fps target.
    this.element.textContent = `GameCube ${fps.toFixed(1)} core fps  ${Math.round(speed)}% speed\n` +
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
