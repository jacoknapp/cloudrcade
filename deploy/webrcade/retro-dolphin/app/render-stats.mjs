// Successful WebGPU submissions, not VI callbacks or pixel-change guesses.
// Fixed storage and no GPU readbacks; quantiles are computed at the 1 Hz poll.
export class RenderStats {
  constructor() {
    this.frames = 0; this.epoch = 0;
    this.times = new Float64Array(256); this.gaps = new Float64Array(256);
    this.reset();
  }
  reset() { this.epoch++; this.size = 0; this.cursor = 0; this.last = null; }
  presented(now) {
    this.frames++;
    if (this.last !== null) {
      this.times[this.cursor] = now;
      this.gaps[this.cursor] = Math.max(0, now - this.last);
      this.cursor = (this.cursor + 1) % this.times.length;
      this.size = Math.min(this.size + 1, this.times.length);
    }
    this.last = now;
  }
  snapshot(now) {
    const gaps = [];
    for (let i = 0; i < this.size; i++)
      if (this.times[i] > now - 1000 && this.times[i] <= now) gaps.push(this.gaps[i]);
    gaps.sort((a,b) => a-b);
    return {frames:this.frames, epoch:this.epoch, samples:gaps.length, windowMs:1000,
      p95Ms:gaps.length ? gaps[Math.ceil(gaps.length * .95)-1] : null,
      maxMs:gaps.length ? gaps[gaps.length-1] : null,
      ageMs:this.last === null ? null : Math.max(0, now-this.last)};
  }
}
