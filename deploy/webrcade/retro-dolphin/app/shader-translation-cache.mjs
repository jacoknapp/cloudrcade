// Local, disposable translated WGSL only. Account/save storage is never used.
export const SHADER_CACHE_LIMITS = Object.freeze({entries:256, bytes:8*1024*1024,
  totalBytes:32*1024*1024, games:4});
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
const schema = 1;
const validIdentity = (build, game) => /^[a-f0-9]{64}$/.test(build) && /^[A-Z0-9]{6}$/.test(game);
const identity = (build, game) => `gc-wgsl-v${schema}/${build}/${game}`;
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2,'0')).join('');

export function validShaderRecords(records) {
  if (!Array.isArray(records) || records.length > SHADER_CACHE_LIMITS.entries) return false;
  let bytes = 0;
  for (const record of records) {
    if (!record || !Number.isInteger(record.stage) || record.stage < 0 || record.stage > 3 ||
        !Number.isInteger(record.variant) || record.variant < 0 || record.variant > 1 ||
        typeof record.source !== 'string' || typeof record.wgsl !== 'string' || !record.wgsl ||
        record.source.includes('\0') || record.wgsl.includes('\0') ||
        record.source.length > SHADER_CACHE_LIMITS.bytes || record.wgsl.length > SHADER_CACHE_LIMITS.bytes)
      return false;
    bytes += encoder.encode(record.source).length + encoder.encode(record.wgsl).length;
    if (bytes > SHADER_CACHE_LIMITS.bytes) return false;
  }
  return true;
}

export async function encodeShaderSnapshot(build, game, records) {
  if (!validIdentity(build, game) || !validShaderRecords(records)) return null;
  const bytes = encoder.encode(JSON.stringify({schema, build, game, records}));
  if (bytes.length > SHADER_CACHE_LIMITS.bytes) return null;
  return {key:identity(build,game), schema, build, game, size:bytes.length,
    hash:await digest(bytes), used:Date.now(), blob:new Blob([bytes])};
}

export async function decodeShaderSnapshot(record, build, game) {
  if (!validIdentity(build,game) || !record || record.key !== identity(build,game) ||
      record.schema !== schema || record.build !== build || record.game !== game ||
      !Number.isInteger(record.size) || record.size <= 0 || record.size > SHADER_CACHE_LIMITS.bytes ||
      !(record.blob instanceof Blob) || record.blob.size !== record.size ||
      !/^[a-f0-9]{64}$/.test(record.hash)) return null;
  // IndexedDB returns a Blob handle. Check its length before allocating bytes,
  // hashing or parsing, so a corrupt oversized value cannot expand a snapshot.
  try {
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    if (await digest(bytes) !== record.hash) return null;
    const value = JSON.parse(decoder.decode(bytes));
    return value.schema === schema && value.build === build && value.game === game &&
      validShaderRecords(value.records) ? value.records : null;
  } catch { return null; }
}

const request = req => new Promise((resolve,reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const completed = tx => new Promise((resolve,reject) => {
  tx.oncomplete = resolve;
  tx.onerror = tx.onabort = () => reject(tx.error || new Error('Shader cache transaction aborted'));
});

export class ShaderSnapshotStorage {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; }
  async open() {
    if (!this.indexedDB) throw new Error('IndexedDB unavailable');
    const opening = this.indexedDB.open('cloudrcade-gc-wgsl-v1', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('snapshots', {keyPath:'key'});
    const db = await request(opening);
    db.onversionchange = () => db.close();
    return db;
  }
  async get(key) {
    const db = await this.open();
    try {
      const tx = db.transaction('snapshots','readonly'), done = completed(tx);
      const [result] = await Promise.all([request(tx.objectStore('snapshots').get(key)),done]);
      return result;
    } finally { db.close(); }
  }
  async put(record) {
    const db = await this.open();
    try {
      // A single serial readwrite transaction enforces the shared budget even
      // across tabs. Blob handles remain unmaterialized during pruning.
      const tx = db.transaction('snapshots','readwrite'), done = completed(tx);
      const store = tx.objectStore('snapshots');
      store.put(record);
      const scan = new Promise((resolve,reject) => {
        const cursor = store.openCursor(), keep = [];
        let bytes = 0;
        cursor.onerror = () => reject(cursor.error);
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) { resolve(); return; }
          const row = item.value;
          if (row?.schema !== schema || !(row.blob instanceof Blob) ||
              !validIdentity(row.build,row.game) || row.key !== identity(row.build,row.game) ||
              !Number.isInteger(row.size) || row.size <= 0 || row.size > SHADER_CACHE_LIMITS.bytes ||
              row.blob.size !== row.size || !Number.isFinite(row.used)) item.delete();
          else {
            keep.push(row); bytes += row.size;
            keep.sort((a,b) => b.used - a.used);
            while (keep.length > SHADER_CACHE_LIMITS.games || bytes > SHADER_CACHE_LIMITS.totalBytes) {
              const removed = keep.pop(); bytes -= removed.size; store.delete(removed.key);
            }
          }
          item.continue();
        };
      });
      await Promise.all([scan,done]);
    } finally { db.close(); }
  }
}

function bounded(operation, ms=1500) {
  let timer;
  return Promise.race([operation, new Promise((_,reject) => {
    timer = setTimeout(() => reject(new Error('Shader cache timed out')),ms);
  })]).finally(() => clearTimeout(timer));
}

export class PersistentShaderTranslations {
  constructor(module, build, game, storage = new ShaderSnapshotStorage()) {
    this.module = module; this.build = build; this.game = game; this.storage = storage;
    this.ready = false; this.pending = false; this.lastAttempt = 0; this.revision = 0;
    this.stats = {loaded:0,written:0,errors:0,loadMs:0,lastWriteMs:0,native:null};
  }
  async load() {
    if (!validIdentity(this.build,this.game) || !this.module._DolphinWeb_ImportShaderTranslation ||
        !this.module._DolphinWeb_ShaderTranslationRevision || !this.module._DolphinWeb_ExportShaderTranslations) return;
    const started = performance.now();
    try {
      const record = await bounded(this.storage.get(identity(this.build,this.game)));
      const records = await decodeShaderSnapshot(record,this.build,this.game);
      if (records) for (const row of records) {
        const source = encoder.encode(row.source), wgsl = encoder.encode(row.wgsl);
        const pointer = this.module._malloc(source.length + wgsl.length + 1);
        if (!pointer) break;
        try {
          this.module.HEAPU8.set(source,pointer);
          this.module.HEAPU8.set(wgsl,pointer+source.length);
          if (this.module._DolphinWeb_ImportShaderTranslation(row.stage,row.variant,
              pointer,source.length,pointer+source.length,wgsl.length)) this.stats.loaded++;
        } finally { this.module._free(pointer); }
      }
    } catch { this.stats.errors++; return; }
    finally { this.stats.loadMs = performance.now() - started; }
    this.revision = this.module._DolphinWeb_ShaderTranslationRevision();
    this.ready = true;
  }
  checkpoint(now = performance.now()) {
    try {
      this.module._DolphinWeb_GetShaderTranslationStats?.();
      if (this.module._cloudrcadeShaderCacheStats) this.stats.native = this.module._cloudrcadeShaderCacheStats;
    } catch { this.stats.errors++; this.ready = false; return; }
    if (!this.ready || this.pending || now - this.lastAttempt < 10000) return;
    const revision = this.module._DolphinWeb_ShaderTranslationRevision();
    if (revision === this.revision) return;
    this.lastAttempt = now; this.pending = true;
    // Export only changed bounded strings; GPU modules/pipelines remain owned
    // by the active device and are created normally when the ring needs them.
    let records;
    try {
      this.module._DolphinWeb_ExportShaderTranslations();
      records = this.module._cloudrcadeShaderSnapshot;
      delete this.module._cloudrcadeShaderSnapshot;
    } catch { this.stats.errors++; this.pending = false; this.ready = false; return; }
    void (async () => {
      const started = performance.now();
      try {
        const record = await encodeShaderSnapshot(this.build,this.game,records);
        if (record) {
          await bounded(this.storage.put(record));
          this.revision = revision; this.stats.written++;
        }
      } catch { this.stats.errors++; this.ready = false; }
      finally { this.pending = false; this.stats.lastWriteMs = performance.now() - started; }
    })();
  }
}
