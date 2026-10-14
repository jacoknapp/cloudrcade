// Frame progress, rather than scene-dependent FPS, determines a JIT freeze.
export class JitLivenessGuard {
  constructor(stallMs = 5000) { this.stallMs = stallMs; this.reset(); }
  reset() { this.frame = null; this.progressAt = null; }
  stalled(frame, now) {
    if (!Number.isFinite(frame) || !Number.isFinite(now)) return false;
    if (this.frame !== frame || this.progressAt === null || now < this.progressAt) {
      this.frame = frame; this.progressAt = now; return false;
    }
    return now - this.progressAt >= this.stallMs;
  }
}
