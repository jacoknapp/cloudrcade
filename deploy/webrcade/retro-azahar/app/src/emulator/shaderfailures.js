// Persistent, per-game compiler reports. Captured only on failure; no draw hooks.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_REPORTS = 32;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE = 256 * 1024;
const MAX_SESSIONS = 16;
const FILE = 'shader-failures.json';

// Low-level cloud methods can use an isolated error callback without hiding
// an overlapping real game-save error on the shared manager.
export const quietCloudManager = (manager) => {
  // Nextcloud's low-level methods already throw without invoking callbacks.
  // Keep the original receiver: the bridge binds its account by object identity.
  const bridge = typeof window !== 'undefined' && window.WrcadCloud;
  if (bridge && bridge.stats.saves > 0) return manager;
  const quiet = Object.create(manager);
  quiet.errorCallback = null;
  return quiet;
};

export const decodeFailureReports = (bytes) => {
  try {
    const value = JSON.parse(decoder.decode(bytes));
    return value.schema === 1 && Array.isArray(value.reports) ? value : null;
  } catch (e) { return null; }
};

export const mergeFailureReports = (mine, other) => {
  if (!mine) return other;
  if (!other || other.game !== mine.game) return mine;
  const reports = new Map();
  for (const report of [...mine.reports, ...other.reports]) {
    if (!report || typeof report.id !== 'string' || !Array.isArray(report.sessions)) continue;
    const previous = reports.get(report.id);
    const sessions = new Map();
    for (const sample of [...(previous ? previous.sessions : []), ...report.sessions]) {
      const before = sessions.get(sample.id);
      sessions.set(sample.id, before ? {
        id: sample.id, count: Math.max(before.count, sample.count),
        first: Math.min(before.first, sample.first), last: Math.max(before.last, sample.last),
      } : sample);
    }
    reports.set(report.id, {
      ...report,
      first: Math.min(report.first, previous ? previous.first : report.first),
      last: Math.max(report.last, previous ? previous.last : report.last),
      sessions: [...sessions.values()].sort((a, b) => b.last - a.last).slice(0, MAX_SESSIONS),
    });
  }
  const merged = { schema: 1, game: mine.game, reports: [...reports.values()]
    .sort((a, b) => b.last - a.last).slice(0, MAX_REPORTS) };
  while (merged.reports.length && encoder.encode(JSON.stringify(merged)).length > MAX_BYTES) {
    merged.reports.pop();
  }
  return merged;
};

export class ShaderFailureTracker {
  constructor(emulator, core) {
    this.emulator = emulator;
    this.core = core;
    this.session = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.pending = [];
    this.counts = new Map();
  }

  async restore() {
    try {
      this.document = decodeFailureReports(await this.emulator.getStorage().get(
        `/wrc/3ds-shader-failures/${this.emulator.uid}`));
    } catch (e) { /* storage unavailable */ }
  }

  capture(failure, module) {
    if (!this.device) {
      const gl = module.ctx;
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      this.device = {
        vendor: gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
        renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        userAgent: navigator.userAgent,
      };
    }
    // Bound pending input too if a driver rejects many pairs at once.
    if (this.pending.length < MAX_REPORTS) {
      this.pending.push({ ...failure, time: Date.now() });
    }
    if (!this.timer) this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, 1000);
  }

  async flush() {
    if (this.task) return this.task;
    this.task = this.persist();
    try { await this.task; } finally {
      this.task = null;
      if (this.pending.length && !this.timer && !this.closing) this.timer = setTimeout(() => {
        this.timer = null;
        this.flush().catch(() => {});
      }, 1000);
    }
  }

  async persist() {
    const emulator = this.emulator;
    if (!emulator.uid || (!this.pending.length && !this.document)) return;
    const key = `/wrc/3ds-shader-failures/${emulator.uid}`;
    if (!this.document) {
      this.document = decodeFailureReports(await emulator.getStorage().get(key)) ||
        { schema: 1, game: emulator.uid, reports: [] };
    }
    while (this.pending.length) {
      const failure = this.pending[0];
      const shaders = failure.shaders.map((shader) => ({
        ...shader, source: shader.source.slice(0, MAX_SOURCE),
        originalLength: shader.source.length, truncated: shader.source.length > MAX_SOURCE,
      }));
      const signature = JSON.stringify({ core: this.core, device: this.device,
        shaders: failure.shaders.map((shader) => ({ type: shader.type, source: shader.source })), log: failure.log });
      const hash = await crypto.subtle.digest('SHA-256', encoder.encode(signature));
      const id = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const before = this.counts.get(id);
      const sample = { id: this.session, count: (before ? before.count : 0) + 1,
        first: before ? before.first : failure.time, last: failure.time };
      this.counts.set(id, sample);
      this.document = mergeFailureReports(this.document, { schema: 1, game: emulator.uid, reports: [{
        id, core: this.core, title: emulator.getTitle(), device: this.device,
        log: failure.log, shaders, diagnostic: !!emulator.renderingDiagnostic,
        first: sample.first, last: sample.last, sessions: [sample],
      }] });
      this.pending.shift();
    }
    const bytes = encoder.encode(JSON.stringify(this.document));
    await emulator.getStorage().put(key, bytes);
    // An upload failure remains dirty and is retried on pause/exit or next run.
    const manager = quietCloudManager(emulator.getSaveManager());
    if (await manager.isCloudEnabled(null)) {
      const cloudPath = `${emulator.saveStatePrefix}shader-failures`;
      if (this.cloudBytes === decoder.decode(bytes)) return;
      let remote = null;
      try {
        const files = await manager.loadCloud(cloudPath);
        const file = files.find((entry) => entry.name === FILE);
        if (file) remote = decodeFailureReports(file.content);
      } catch (e) { /* no remote report or temporarily offline */ }
      const merged = mergeFailureReports(this.document, remote);
      const content = encoder.encode(JSON.stringify(merged));
      await manager.saveCloud(cloudPath, [{ name: FILE, content }]);
      this.document = merged;
      await emulator.getStorage().put(key, content);
      this.cloudBytes = decoder.decode(content);
    }
  }

  async close() {
    this.closing = true;
    clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
    // Capture may have arrived during an upload.
    if (this.pending.length) await this.flush();
  }
}
