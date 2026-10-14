// Cap completed hardware submissions without dropping/reordering GX commands.
// Slow frames never accumulate catch-up credits; normal console timing remains
// Dolphin's responsibility (emulationSpeed=1).
export class FrameLimit {
  constructor(fps=60){this.interval=1000/fps;this.next=0;this.frames=0;this.delayed=0;}
  remaining(now){return Math.max(0,this.next-now);}
  // Browser timers truncate fractional milliseconds. Avoid an early wake that
  // immediately schedules another (potentially minimum-4ms) timer.
  timerDelay(now){return Math.ceil(this.remaining(now));}
  presented(now){this.frames++;this.next=now+this.interval;}
  reset(){this.next=0;}
}
