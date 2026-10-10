// On-screen performance readout, switched on from the library's Experimental
// Settings. It answers where a slow frame goes on the device itself: emulation
// (frame time), blocking graphics calls, or neither (frames wait on the browser).

const KEY = 'wrcad.3ds.perf.v1';

// Graphics calls that can stall the page while the GPU process catches up,
// grouped by what the readout reports. Draw calls are counted, never timed.
const TIMED = {
  readback: ['readPixels', 'getError', 'finish', 'getBufferSubData', 'clientWaitSync'],
  upload: ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'bufferData',
    'bufferSubData', 'compressedTexImage2D'],
  shader: ['compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter'],
};
const DRAWS = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced',
  'drawRangeElements'];

export function perfEnabled() {
  try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
}

export class PerfReadout {
  constructor(revision, unfinished) {
    this.revision = revision;
    // GPU cost probes deliberately stall a sampled frame. Keep the ordinary
    // readout smooth; enable these only for a targeted graphics investigation.
    try { this.gpuProbes = localStorage.getItem('wrcad.3ds.perf.gpu-probes.v1') === '1'; }
    catch (e) { this.gpuProbes = false; }
    // What the previous run was doing if it ended without finishing it.
    this.unfinished = unfinished;
    this.reset();
    this.calls = {};
    for (const group of Object.keys(TIMED)) this.calls[group] = { count: 0, time: 0 };
    this.draws = 0;
    this.started = 0;
    this.timers = { count: 0, asked: 0, ran: 0 };
    this.frames = { count: 0, ran: 0 };
    this.late = 0;
    this.bytes = 0;
    this.sampling = false;
    this.sample = null;
    this.lastSample = 0;
    this.handlers = {};
    this.drawTime = 0;
    this.schedule();
    this.listen();
  }

  // Everything else the page runs enters through an event handler: messages
  // from the core's workers, the loop's own wake-up messages, input. Time them
  // all by target and event type; the readout shows the three largest.
  listen() {
    const handlers = this.handlers;
    const timed = (label, callback) => function (...args) {
      const start = performance.now();
      try { return callback.apply(this, args); } finally {
        const entry = handlers[label] || (handlers[label] = { count: 0, time: 0 });
        entry.count++;
        entry.time += performance.now() - start;
      }
    };
    const name = target => (target && target.constructor && target.constructor.name) || 'Target';
    const wrapped = new WeakMap();
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, ...rest) {
      if (typeof listener !== 'function') return add.call(this, type, listener, ...rest);
      if (!wrapped.has(listener)) wrapped.set(listener, timed(`${name(this)}.${type}`, listener));
      return add.call(this, type, wrapped.get(listener), ...rest);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, ...rest) {
      return remove.call(this, type, (listener && wrapped.get(listener)) || listener, ...rest);
    };
    for (const [owner, label] of [[window.Worker, 'Worker'], [window.MessagePort, 'Port']]) {
      const descriptor = owner && Object.getOwnPropertyDescriptor(owner.prototype, 'onmessage');
      if (!descriptor || !descriptor.set) continue;
      Object.defineProperty(owner.prototype, 'onmessage', {
        ...descriptor,
        set(callback) {
          descriptor.set.call(this, typeof callback === 'function' ? timed(`${label}.onmessage`, callback) : callback);
        },
      });
    }
  }

  // The core sleeps by unwinding to a timer and resumes its work inside that
  // timer's callback, outside the main loop hooks. Time every timer and
  // animation-frame callback, so emulation hidden there is counted and a core
  // that is merely waiting shows as many short sleeps with little run time.
  schedule() {
    const timers = this.timers, frames = this.frames;
    const setTimeout = window.setTimeout, requestFrame = window.requestAnimationFrame;
    window.setTimeout = function (callback, delay, ...args) {
      if (typeof callback !== 'function') return setTimeout.call(window, callback, delay, ...args);
      timers.count++;
      timers.asked += Number(delay) || 0;
      return setTimeout.call(window, function (...values) {
        const start = performance.now();
        try { return callback.apply(this, values); } finally { timers.ran += performance.now() - start; }
      }, delay, ...args);
    };
    window.requestAnimationFrame = function (callback) {
      return requestFrame.call(window, function (time) {
        const start = performance.now();
        try { return callback(time); } finally { frames.count++; frames.ran += performance.now() - start; }
      });
    };
    // How late a steady timer fires is the time the page could not respond.
    let expected = performance.now() + 50;
    setInterval(() => {
      const now = performance.now();
      if (now > expected) this.late += now - expected;
      expected = now + 50;
    }, 50);
  }

  reset() {
    this.iterations = 0;
    this.busy = 0;
    this.longest = 0;
  }

  // Main loop hooks; these run around every iteration of the core.
  options(options) {
    const due = options.preMainLoop; // the frame limiter, which may skip an iteration
    options.preMainLoop = () => {
      if (due && due() === false) return false;
      this.started = performance.now();
      // Graphics calls return before the GPU has done the work. Every two
      // seconds, make one frame wait after each call to see what the work costs.
      if (this.gpuProbes && this.finish && this.started - this.lastSample > 2000) {
        this.lastSample = this.started;
        this.sampling = true;
        this.current = { draw: 0, upload: 0, worst: 0, where: '', end: 0, kinds: {} };
        this.finish();
      }
    };
    options.postMainLoop = () => {
      if (this.sampling) {
        this.sampling = false;
        this.current.end = this.wait();
        this.sample = this.current;
        return; // A sampled frame is slowed on purpose; keep it out of the averages.
      }
      const elapsed = performance.now() - this.started;
      this.iterations++;
      this.busy += elapsed;
      if (elapsed > this.longest) this.longest = elapsed;
    };
  }

  kind(label, cost) {
    const kinds = this.current.kinds, entry = kinds[label] || (kinds[label] = { count: 0, time: 0 });
    entry.count++;
    entry.time += cost;
  }

  wait() {
    const start = performance.now();
    this.finish();
    return performance.now() - start;
  }

  // Bytes handed to an upload call: a size, or the data, or the given part of it.
  static size(name, args) {
    if (name === 'bufferData') return typeof args[1] === 'number' ? args[1] : (args[1] && args[1].byteLength) || 0;
    if (name === 'bufferSubData') {
      const data = args[2];
      if (!data) return 0;
      return args.length > 4 && args[4] ? args[4] * (data.BYTES_PER_ELEMENT || 1) : data.byteLength || 0;
    }
    const data = args[args.length - 1];
    return (data && data.byteLength) || 0;
  }

  wrap(context) {
    // `finish` returns at once in Safari, where graphics run in another
    // process. A call that must answer (`getError`) waits for everything queued.
    const finish = context.getError.bind(context), readout = this;
    this.finish = finish;
    const attributes = context.getContextAttributes() || {};
    this.surface = `${context.drawingBufferWidth}x${context.drawingBufferHeight}` +
      (attributes.antialias ? ' aa' : '') + (attributes.preserveDrawingBuffer ? ' keep' : '');
    for (const name of TIMED.upload) {
      const original = context[name];
      if (typeof original !== 'function') continue;
      context[name] = function (...args) {
        readout.bytes += PerfReadout.size(name, args);
        const result = original.apply(this, args);
        if (readout.sampling) {
          const cost = readout.wait();
          readout.current.upload += cost;
          // Texture uploads: tell formats apart, some need converting.
          const format = name.startsWith('tex') ? ` ${(name === 'texImage2D' ? args[2] : args[6] || 0).toString(16)}` : '';
          readout.kind(name.replace('Image', '').replace('Data', '') + format, cost);
        }
        return result;
      };
    }
    for (const [group, names] of Object.entries(TIMED)) {
      const total = this.calls[group];
      for (const name of names) {
        const original = context[name];
        if (typeof original !== 'function') continue;
        context[name] = function (...args) {
          const start = performance.now();
          try { return original.apply(this, args); } finally {
            total.count++;
            total.time += performance.now() - start;
          }
        };
      }
    }
    for (const name of DRAWS) {
      const original = context[name];
      if (typeof original !== 'function') continue;
      context[name] = function (...args) {
        readout.draws++;
        const start = performance.now();
        const result = original.apply(this, args);
        readout.drawTime += performance.now() - start;
        if (readout.sampling) {
          const cost = readout.wait(), sample = readout.current;
          sample.draw += cost;
          readout.kind(`${name.replace('draw', '')} m${args[0]}` + (name.includes('Elements') ? ` t${(args[2] || 0).toString(16)}` : ''), cost);
          if (cost > sample.worst) {
            const view = this.getParameter(this.VIEWPORT);
            sample.worst = cost;
            sample.where = `${view[2]}x${view[3]}` + (this.getParameter(this.FRAMEBUFFER_BINDING) ? '' : ' screen');
          }
        }
        return result;
      };
    }
  }

  start(module) {
    const element = document.createElement('pre');
    element.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;margin:0;' +
      'padding:3px 5px;font:10px/1.25 ui-monospace,Menlo,monospace;color:#7CFC00;' +
      'background:rgba(0,0,0,.72);pointer-events:none;white-space:pre;text-align:left';
    document.body.appendChild(element);
    this.element = element;
    let frames = module._get_current_frame_count(), last = performance.now(), vertex = {};
    this.timer = setInterval(() => {
      if (!this.context && module.ctx) { this.context = module.ctx; this.wrap(module.ctx); }
      const now = performance.now(), seconds = (now - last) / 1000;
      const count = module._get_current_frame_count(), made = count - frames;
      frames = count; last = now;
      const per = value => (made ? value / made : 0);
      const stats = module.nativeVertexStats || {};
      const delta = name => (stats[name] || 0) - (vertex[name] || 0);
      const lines = [
        `3DS ${(made / seconds).toFixed(1)} fps ${Math.round(made / seconds / 59.83 * 100)}%  ${this.revision}`,
        `loops ${Math.round(this.iterations / seconds)}/s  frame ${per(this.busy).toFixed(1)} ms  worst ${this.longest.toFixed(0)}  busy ${Math.round(this.busy / seconds / 10)}%`,
        `draws ${Math.round(per(this.draws))} ${per(this.drawTime).toFixed(1)} ms  gpu ${Math.round(per(delta('gpu')))} cpu ${Math.round(per(delta('lit') + delta('geometry') + delta('failed')))}`,
        ...Object.entries(this.calls).map(([group, total]) =>
          `${group} ${Math.round(per(total.count))}  ${per(total.time).toFixed(1)} ms`),
        `timers ${Math.round(this.timers.count / seconds)}/s  asked ${Math.round(this.timers.asked / seconds)}  ran ${Math.round(this.timers.ran / seconds)} ms`,
        `raf ${Math.round(this.frames.count / seconds)}/s  ran ${Math.round(this.frames.ran / seconds)} ms  late ${Math.round(this.late / seconds)} ms`,
        this.audio(module),
        ...this.top(seconds),
        this.shaders(module),
        `gl ${this.surface || '?'}  sent ${(per(this.bytes) / 1048576).toFixed(2)} MB/f`,
        this.sample ? `gpu draw ${this.sample.draw.toFixed(0)} ms  worst ${this.sample.worst.toFixed(0)} @${this.sample.where}` +
          `  upl ${this.sample.upload.toFixed(0)}  end ${this.sample.end.toFixed(0)}` :
          (this.gpuProbes ? 'gpu sample pending' : 'gpu cost probes off'),
        ...(this.sample ? Object.entries(this.sample.kinds).sort((a, b) => b[1].time - a[1].time).slice(0, 3)
          .map(([label, entry]) => `  ${label} x${entry.count} ${entry.time.toFixed(0)} ms`) : []),
        `heap ${Math.round(module.HEAPU8.length / 1048576)} MB  audio ${module.RWA?.context?.state || 'none'}`,
        ...(this.unfinished ? [`last run died in: ${this.unfinished}`] : []),
      ];
      element.textContent = lines.join('\n');
      vertex = { ...stats };
      this.reset();
      this.draws = 0;
      this.late = 0;
      this.drawTime = 0;
      for (const key of Object.keys(this.handlers)) delete this.handlers[key];
      this.bytes = 0;
      Object.assign(this.timers, { count: 0, asked: 0, ran: 0 });
      Object.assign(this.frames, { count: 0, ran: 0 });
      for (const total of Object.values(this.calls)) { total.count = 0; total.time = 0; }
    }, 1000);
  }

  // The core paces itself against a clock derived from the audio context. Audio
  // queued far ahead of that clock, or a clock apart from the context's own,
  // makes it wait instead of emulating.
  audio(module) {
    const audio = module.RWA, context = audio && audio.context;
    if (!context) return 'audio none';
    const clock = performance.now() / 1000 - audio.currentTimeDiff;
    return `queue ${Math.round((audio.endTime - clock) * 1000)} ms  drift ${Math.round((clock - context.currentTime) * 1000)}` +
      `  ${context.sampleRate} Hz  lat ${audio.latency}`;
  }

  // Programs first needed since the last line (the game waits for each of
  // those), and how many of them were not finished when needed.
  shaders(module) {
    const now = module.wrcShaders || { built: 0, skipped: 0, waited: 0 };
    const was = this.lastShaders || { built: 0, skipped: 0, waited: 0 };
    this.lastShaders = { ...now };
    // `ready` = programs remembered from earlier sessions and rebuilt so far.
    return `programs +${now.built - was.built} (${now.built})  waited ${now.waited - was.waited}` +
      `  ready ${now.rebuilt || 0}/${now.remembered || 0}` +
      `  failed ${(module.wrcShaderFailures || []).length}`;
  }

  top(seconds) {
    const entries = Object.entries(this.handlers).sort((a, b) => b[1].time - a[1].time).slice(0, 3);
    if (!entries.length) return ['events none'];
    return entries.map(([label, entry]) =>
      `${label} ${Math.round(entry.count / seconds)}/s ${Math.round(entry.time / seconds)} ms`);
  }

  stop() {
    clearInterval(this.timer);
    if (this.element) this.element.remove();
  }
}
