// Run against the patched RetroArch Web Audio library from build.sh.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setImmediate: settlePromises } = require('node:timers/promises');
const vm = require('node:vm');

const sourcePath = 'emscripten/library_rwebaudio.js';
const candidatePath = process.argv[2] || (process.env.WEBRCADE_BUILD_ROOT
  && path.join(process.env.WEBRCADE_BUILD_ROOT, 'RetroArch', sourcePath));
assert(candidatePath, 'Pass the patched RetroArch emscripten/library_rwebaudio.js or set WEBRCADE_BUILD_ROOT');
const candidate = fs.readFileSync(candidatePath, 'utf8');
const audioPatch = path.resolve(__dirname,
  '../deploy/webrcade/retro-azahar/patches/retroarch-3ds-audio-queue.patch');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'webrcade-3ds-audio-'));
let release;
try {
  fs.mkdirSync(path.join(scratch, path.dirname(sourcePath)));
  fs.writeFileSync(path.join(scratch, sourcePath), candidate);
  execFileSync('git', ['apply', '--reverse', audioPatch], { cwd: scratch });
  release = fs.readFileSync(path.join(scratch, sourcePath), 'utf8');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

function harness(source, { chrome = false, sampleRate = 48000, readyState = 'running' } = {}) {
  const frames = sampleRate / 100;
  const samples = new Float32Array(frames * 2);
  const starts = [];
  let wall = 0;
  let library;
  const listeners = new Map();

  class Context {
    constructor(state = 'running') {
      this.state = state;
      this.sampleRate = sampleRate;
      this.destination = {};
      this.currentTime = 0;
      this.resumeCalls = 0;
    }
    addEventListener(event, listener) { listeners.set(event, listener); }
    removeEventListener(event) { listeners.delete(event); }
    changeState(state, notify = true) {
      this.state = state;
      if (notify) listeners.get('statechange')();
    }
    close() { this.state = 'closed'; return Promise.resolve(); }
    resume() {
      ++this.resumeCalls;
      return Promise.reject(new Error('A gesture is required'));
    }
    createBuffer(channels, size, rate) {
      assert.equal(channels, 2);
      assert.equal(size, frames);
      assert.equal(rate, sampleRate);
      const pcm = Array.from({ length: channels }, () => new Float32Array(size));
      return { pcm, duration: size / rate, getChannelData: channel => pcm[channel] };
    }
    createBufferSource() {
      return {
        connect: destination => assert.equal(destination, this.destination),
        start(time) {
          assert.equal(this.playbackRate, undefined);
          assert.equal(arguments.length, 1);
          const [left, right] = this.buffer.pcm;
          assert.deepEqual(left, samples.subarray(0, frames));
          assert.deepEqual(right, samples.subarray(frames));
          starts.push({ time, end: time + this.buffer.duration, audioTime: context.currentTime, id: left[0] });
        },
      };
    }
  }

  const ready = new Context(readyState);
  const sandbox = {
    window: { AudioContext: Context, readyAudioContext: ready },
    performance: { now: () => wall * 1000 },
    HEAPF32: samples,
    _platform_emscripten_get_browser: () => Number(chrome),
    autoAddDeps() {},
    addToLibrary(value) { library = value; },
  };
  vm.runInNewContext(source, sandbox);
  for (const [name, value] of Object.entries(library)) {
    sandbox[name.startsWith('$') ? name.slice(1) : '_' + name] = value;
  }
  assert.equal(library.RWebAudioInit(64), 1);
  const context = sandbox.RWA.context;
  return {
    context, frames, starts, ready,
    available: library.RWebAudioWriteAvailFrames,
    capacity: library.RWebAudioBufferSizeFrames,
    resume: library.RWebAudioResumeCtx,
    close: library.RWebAudioFree,
    nonblock: library.RWebAudioSetNonblockState,
    tick(time, audioTime = time, recalibrate = true) {
      wall = time;
      context.currentTime = audioTime;
      if (recalibrate) library.RWebAudioRecalibrateTime();
    },
    write(id) {
      for (let i = 0; i < frames; ++i) {
        samples[i] = id + i / frames;
        samples[frames + i] = -id - i / frames;
      }
      return library.RWebAudioQueueBuffer(frames, 0, frames * Float32Array.BYTES_PER_ELEMENT);
    },
  };
}

function checkTimeline(starts) {
  let end = starts[0].time;
  let gaps = 0;
  let silence = 0;
  for (const event of starts) {
    const gap = event.time - end;
    assert(gap >= -1e-9, 'scheduled buffers must not overlap');
    assert(event.time >= event.audioTime - 1e-9, 'start must be on the live context timeline');
    if (gap > 1e-9) {
      ++gaps;
      silence += gap * 1000;
    }
    end = event.end;
  }
  return { gaps, silence: Number(silence.toFixed(3)) };
}

function feed(source, arrivals, options) {
  const queue = harness(source, options);
  arrivals.forEach((now, index) => {
    queue.tick(now);
    assert.equal(queue.write(index + 1), queue.frames);
  });
  assert.deepEqual(queue.starts.map(event => event.id), arrivals.map((_, index) => index + 1));
  return checkTimeline(queue.starts);
}

function paced(source, options) {
  const queue = harness(source, options);
  const cap = 0.064 + (options.chrome ? 0 : 0.010);
  let wallMs = 0;
  let written = 0;
  for (let frame = 0; frame < 180; ++frame) {
    // The next native frame starts when the audio queue accepts more samples.
    const deadline = wallMs + 100;
    while (queue.available() === 0 && wallMs < deadline) queue.tick(++wallMs / 1000);
    assert(queue.available() > 0, 'backpressure must release as the audio clock advances');
    queue.tick((wallMs += 2) / 1000);
    for (let i = 0; i < (frame % 3 ? 2 : 1); ++i) {
      assert.equal(queue.write(++written), queue.frames);
    }
    const last = queue.starts.at(-1);
    assert(last.end - queue.context.currentTime < cap + .020001);
  }
  assert.deepEqual(checkTimeline(queue.starts), { gaps: 0, silence: 0 });
  return wallMs;
}

(async () => {
  const arrivals = [0, .024, .029, .040, .048, .055, .069, .074];
  assert.deepEqual(feed(release, arrivals, {}), { gaps: 1, silence: 14 });
  assert.deepEqual(feed(candidate, arrivals, {}), { gaps: 0, silence: 0 });

  // Simulate a producer with isolated 170 ms and 260 ms stalls, as observed in
  // the game's slower windows. A scheduling fix cannot invent missing audio.
  const weak = [0, .120, .240, .410, .530, .790, .910];
  for (const chrome of [true, false]) {
    for (const sampleRate of [44100, 48000]) {
      const options = { chrome, sampleRate };
      assert.deepEqual(feed(candidate, weak, options), feed(release, weak, options));
      assert.deepEqual(feed(candidate, Array.from({ length: 100 }, (_, i) => i / 100), options),
        { gaps: 0, silence: 0 });
      assert(Math.abs(paced(candidate, options) - paced(release, options)) <= 1,
        'an adequate producer should retain the same audio-paced throughput');
    }
  }

  const fast = harness(candidate);
  fast.nonblock(true);
  const accepted = Array.from({ length: 20 }, (_, i) => fast.write(i + 1)).filter(Boolean);
  assert.equal(accepted.length, 5);
  assert.equal(fast.context.resumeCalls, 0);
  assert.deepEqual(fast.starts.map(event => event.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(checkTimeline(fast.starts), { gaps: 0, silence: 0 });

  for (const source of [release, candidate]) {
    const queue = harness(source);
    for (let id = 1; id <= 8; ++id) queue.write(id);
    // Interrupt playback before the browser dispatches the state change.
    queue.context.changeState('interrupted', source === release);
    queue.tick(.020, .004, false);
    if (source === candidate) {
      assert.equal(queue.available(), queue.capacity());
      assert.equal(queue.write(9), 0);
      assert.equal(queue.write(9), 0);
      assert.equal(queue.context.resumeCalls, 1);
      await settlePromises();
      assert.equal(queue.resume(), false);
      assert.equal(queue.context.resumeCalls, 2);
      await settlePromises();
    }
    // Simulate the first write after audio restarts, prior to the next normal
    // RetroArch recalibration. A two-second suspension advanced only wall time.
    queue.tick(2, .004, false);
    queue.context.changeState('running', source === release);
    const previous = queue.starts.at(-1);
    assert.equal(queue.write(9), queue.frames);
    const gap = queue.starts.at(-1).time - previous.end;
    if (source === release) assert(gap > 1.9);
    else assert(Math.abs(gap) < 1e-9);
  }

  const ahead = harness(candidate);
  ahead.write(1);
  ahead.tick(.023, .034, false);
  assert.equal(ahead.write(2), ahead.frames);
  checkTimeline(ahead.starts);

  const closed = harness(candidate, { readyState: 'closed' });
  assert.notEqual(closed.context, closed.ready);
  closed.close();
  assert.equal(closed.context.state, 'closed');
  assert.equal(closed.resume(), false);
  assert.equal(closed.context.resumeCalls, 0);

  console.log('PASS release/candidate Web Audio queue: 14 ms false gap removed; PCM, rate, pacing, overrun and suspension checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
