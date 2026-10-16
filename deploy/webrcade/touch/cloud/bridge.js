/* Cloud storage adapter for the pinned webRcade 0.2.3 module interfaces. */
(() => {
  'use strict';
  const prefix = window.WrcadCloudConfig?.storagePrefix || 'webrcade';
  const dropbox = window.WrcadDropbox;
  const provider = dropbox?.selected() || 'nextcloud';
  const providerName = provider === 'dropbox' ? 'Dropbox' : 'Nextcloud';
  const KEY = provider === 'dropbox' ? dropbox.key : prefix + '.nextcloud.connection.v1';
  const API = '/cloud-saves/api.php';
  const CONFIG_KEY = prefix + '.nextcloud.config.v1';
  let config = {enabled:false, autoRedirect:false, accessAllowed:false, server:''};
  try { config = window.WrcadCloudConfig || JSON.parse(localStorage.getItem(CONFIG_KEY)) || config; } catch (_) {}
  if (window.WrcadCloudConfig) try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch (_) {}
  if (provider === 'dropbox') config = {...config, enabled:Boolean(config.dropbox?.enabled), accessAllowed:true, autoRedirect:false,
    server:'dropbox:' + config.dropbox?.appKey, legacyServer:'', saveFolder:'', message:'Dropbox has not been enabled on this site.'};
  let connection = null, csrf = null, bootstrap = null;
  const AUTO_ATTEMPT = KEY + '.attempt', AUTO_PAUSED = KEY + '.paused';
  const versions = new Map(), blocked = new Set(), installed = new WeakSet();
  const owners = new WeakMap(), queues = new Map();
  const LOCAL_META = prefix + '-local-sync.json', LEGACY_OWNER = prefix + '.saves.legacy-owner.v1';
  const stats = {settings: 0, storage: 0, saves: 0, resources: 0};
  function readConnection() {
    if (provider === 'dropbox') { connection = dropbox.read(); return; }
    try {
      const value = JSON.parse(localStorage.getItem(KEY));
      connection = value && ['login','password','uid'].every(key => typeof value[key] === 'string' && value[key]) &&
        (value.server || config.legacyServer) === config.server ? value : null;
    } catch (_) { connection = null; }
  }
  readConnection();
  // Claim pre-upgrade, unscoped backups only once, for the browser's existing
  // profile. Subsequent accounts must never inherit that profile's saves.
  try {
    if (provider === 'nextcloud' && localStorage.getItem(LEGACY_OWNER) === null)
      localStorage.setItem(LEGACY_OWNER, JSON.stringify(connection?.uid || null));
  } catch (_) { /* Without a durable owner, do not import unscoped backups. */ }
  function account() { readConnection(); return (!dropbox || dropbox.selected() === provider) ? connection?.uid || null : null; }
  function requireAccount(uid) {
    if (!uid || account() !== uid) throw new Error('Cloud account changed. Reopen the game before using cloud saves. Your local progress has been kept for the original account.');
  }
  function owner(manager) {
    if (!owners.has(manager)) owners.set(manager, account());
    return owners.get(manager);
  }
  function localPath(uid, path) { return '/' + prefix + '-local-v3/' + encodeURIComponent(JSON.stringify([config.server, uid])) + '/' + path.replace(/^\/+/, ''); }
  function versionKey(uid, path) { return JSON.stringify([uid, path]); }
  function locked(key, operation) {
    if (window.navigator?.locks) return navigator.locks.request(prefix + '-save:' + key, operation);
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    queues.set(key, next);
    return next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
  }
  window.addEventListener('storage', e => {
    if (e.key === KEY || e.key === dropbox?.providerKey) { readConnection(); versions.clear(); blocked.clear(); }
  });
  function headers(auth) {
    if (!auth) return {};
    const basic = btoa(unescape(encodeURIComponent(auth.login + ':' + auth.password)));
    return {'X-Nextcloud-Authorization': `Basic ${basic}`, 'X-Nextcloud-User': encodeURIComponent(auth.uid),
      'X-Nextcloud-Server':config.server};
  }
  async function request(action, {method = 'GET', path, body, extra = {}, retried = false, uid = account(), timeoutMs = 0} = {}) {
    if (action !== 'status') requireAccount(uid);
    if (provider === 'dropbox') {
      const response = await dropbox.request(action, {method, path, body, extra, uid, timeoutMs});
      requireAccount(uid);
      return response;
    }
    const auth = connection;
    // Opt-in per save manager; existing cores retain their request policy.
    const signal = Number.isFinite(timeoutMs) && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    // A game can outlive its PHP session. Refresh before sending a large save
    // body, rather than discovering an expired token after the upload.
    if (!csrf || method === 'PUT' && !retried) {
      bootstrap ||= fetch(API + '?action=status', {cache: 'no-store', signal}).then(async response => {
        if (!response.ok) throw new Error('Cloud connection unavailable. Please try again.');
        const value = await response.json();
        if (typeof value.csrf !== 'string' || !value.csrf) throw new Error('Cloud session unavailable. Please refresh the page and try again.');
        csrf = value.csrf;
      }).finally(() => { bootstrap = null; });
      await bootstrap;
    }
    requireAccount(uid);
    const url = API + '?action=' + action + (path ? '&path=' + encodeURIComponent(path) : '');
    const response = await fetch(url, {method, body, cache: 'no-store', signal, headers: {...headers(auth), 'X-CSRF-Token': csrf, ...extra}});
    requireAccount(uid);
    if (response.status === 403 && !retried) {
      const detail = await response.clone().json().catch(() => null);
      // An access denial or rejected Origin cannot be repaired with a new
      // CSRF token. Retain the provider's explanation instead of resending.
      if (detail?.code !== 'csrf_invalid' && detail?.error !== 'Refresh the page and try again.') {
        const error = new Error(detail?.error || 'Cloud upload was denied (HTTP 403). Refresh the page and check your cloud connection.');
        error.status = 403; throw error;
      }
      csrf = null;
      return request(action, {method, path, body, extra, retried:true, uid, timeoutMs});
    }
    if (!response.ok) {
      let message = providerName + ' could not complete the save operation.';
      try { message = (await response.json()).error || message; } catch (_) {}
      const error = new Error(message); error.status = response.status;
      throw error;
    }
    return response;
  }
  function enabled() { return Boolean(config.enabled && config.accessAllowed && account()); }
  function notice(message) {
    if (window !== window.top) return;
    const show = () => {
      let panel = document.getElementById('wrcad-nextcloud-notice');
      if (panel) return;
      panel = document.createElement('div'); panel.id = 'wrcad-nextcloud-notice'; panel.setAttribute('role', 'status');
      panel.style.cssText = 'position:fixed;z-index:2147483647;top:max(12px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:min(620px,calc(100% - 32px));box-sizing:border-box;padding:14px 44px 14px 18px;border:1px solid #69dec8;border-radius:10px;background:#090e19;color:#ecf3ff;font:15px/1.5 system-ui;box-shadow:0 4px 24px #0008';
      panel.append(document.createTextNode(message));
      const dismiss = document.createElement('button'); dismiss.textContent = '×';
      dismiss.setAttribute('aria-label','Dismiss cloud storage message');
      dismiss.style.cssText = 'position:absolute;right:10px;top:8px;background:none;border:0;color:inherit;font:24px system-ui;cursor:pointer';
      dismiss.onclick = () => panel.remove(); panel.append(dismiss); document.body.append(panel);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, {once:true}); else show();
  }
  function connect(returnUri, automatic = false) {
    if (!config.enabled || !config.accessAllowed) { notice(config.message); return Promise.resolve(); }
    localStorage.removeItem(AUTO_PAUSED);
    const url = new URL('/cloud-saves/', location.origin);
    url.searchParams.set(automatic ? 'auto' : 'connect', '1');
    url.searchParams.set('provider', provider);
    url.searchParams.set('return', returnUri || window.top.location.href);
    window.top.location.assign(url.href);
    return Promise.resolve();
  }
  async function unlink() {
    const uid = account();
    try { if (connection) await request('unlink', {method:'POST'}); }
    finally {
      if (account() === uid) {
        localStorage.setItem(AUTO_PAUSED, 'true');
        localStorage.removeItem(KEY);
      }
      readConnection(); versions.clear(); blocked.clear(); window.WrcadRecent?.sync();
    }
  }
  async function autoConnect() {
    if (!config.enabled || !config.autoRedirect) return;
    if (window !== window.top || window.navigator?.onLine === false) return;
    try {
      if (localStorage.getItem(AUTO_PAUSED) === 'true' || sessionStorage.getItem(AUTO_ATTEMPT)) return;
      if (!config.accessAllowed) { notice(config.message); return; }
      // A cached offline page must remain playable even when onLine reports true.
      const signal = AbortSignal.timeout(5000);
      const status = await fetch(API + '?action=status', {cache:'no-store', signal});
      if (!status.ok) return;
      const data = await status.json(); csrf = data.csrf;
      if (!csrf) return;
      if (data.config && (!data.config.enabled || !data.config.autoRedirect || data.config.server !== config.server)) return;
      if (data.config && !data.config.accessAllowed) { notice(data.config.message); return; }
      if (localStorage.getItem(AUTO_PAUSED) === 'true' || sessionStorage.getItem(AUTO_ATTEMPT)) return;
      if (account()) {
        const saved = localStorage.getItem(KEY);
        const response = await fetch(API + '?action=verify', {method:'POST', cache:'no-store', signal,
          headers:{...headers(connection), 'X-CSRF-Token':csrf}});
        if (response.status === 403 && localStorage.getItem(KEY) === saved) {
          const error = await response.json().catch(() => ({}));
          if (error.code === 'access_denied') { config = {...config, accessAllowed:false}; notice(error.error || config.message); }
          return;
        }
        // A late rejection of an old token must not remove another tab's login.
        if (response.status !== 401 || localStorage.getItem(KEY) !== saved) return;
        localStorage.removeItem(KEY); readConnection();
      }
      sessionStorage.setItem(AUTO_ATTEMPT, 'true');
      connect(undefined, true);
      // Settings load waits here, so a game cannot start with an unowned save
      // manager while this tab is leaving to establish the account.
      await new Promise(() => {});
    } catch (_) { /* Offline or unavailable login must not prevent local play. */ }
  }
  const startup = autoConnect();
  async function download(path, uid = account(), timeoutMs = 0) {
    const key = versionKey(uid, path);
    try {
      const response = await request('file', {path, uid, timeoutMs});
      const blob = await response.blob(); requireAccount(uid);
      versions.set(key, response.headers.get('ETag'));
      blocked.delete(key);
      return blob;
    } catch (e) {
      if (e.status === 404) { versions.set(key, null); blocked.delete(key); }
      else blocked.add(key);
      throw e;
    }
  }
  async function upload(blob, path, uid = account(), condition, timeoutMs = 0, uploadTimeoutMs) {
    requireAccount(uid);
    const key = versionKey(uid, path);
    if (condition === undefined) {
      if (blocked.has(key)) throw new Error('This save could not be loaded from ' + providerName + '. Reopen the game after reconnecting. Your local copy has been kept.');
      if (!versions.has(key)) {
        try {
          const response = await request('file', {method:'HEAD', path, uid, timeoutMs});
          versions.set(key, response.headers.get('ETag'));
        } catch (e) { if (e.status === 404) versions.set(key, null); else throw e; }
      }
      condition = versions.get(key);
    }
    const response = await request('file', {method:'PUT', path, body:blob, uid,
      timeoutMs:provider === 'nextcloud' ? uploadTimeoutMs ?? timeoutMs : timeoutMs,
      extra: condition ? {'If-Match':condition} : {'If-None-Match':'*'}});
    if (response.headers.get('ETag')) versions.set(key, response.headers.get('ETag'));
    else versions.delete(key);
    return true;
  }
  async function remove(path, uid = account()) {
    const key = versionKey(uid, path);
    try { await request('file', {method:'DELETE', path, uid, extra:versions.get(key) ? {'If-Match':versions.get(key)} : {}}); }
    catch (e) { if (e.status !== 404) throw e; }
    versions.set(key, null); blocked.delete(key);
    return true;
  }
  function installSaves(value) {
    const proto = value.prototype, rawLoad = proto.loadLocal, rawSave = proto.saveLocal;
    const warn = (manager, error) => manager.errorCallback?.(error.message);
    async function read(manager, path) {
      const uid = owner(manager), scoped = localPath(uid, path);
      let files = await rawLoad.call(manager, scoped);
      if (!files && (config.server === config.legacyServer || uid === null)) {
        const previous = '/' + prefix + '-local-v2/' + encodeURIComponent(JSON.stringify(uid)) + '/' + path.replace(/^\/+/, '');
        files = await rawLoad.call(manager, previous);
        if (files) await rawSave.call(manager, scoped, files);
      }
      if (!files) {
        let legacyOwner;
        try { legacyOwner = localStorage.getItem(LEGACY_OWNER); } catch (_) {}
        if (legacyOwner === JSON.stringify(uid) && (config.server === config.legacyServer || uid === null)) {
          files = await rawLoad.call(manager, path);
          // Preserve the original ZIP. Migration happens only into its owner's namespace.
          if (files) await rawSave.call(manager, scoped, files);
        }
      }
      const meta = files?.find(file => file.name === LOCAL_META);
      let sync = null;
      if (meta) {
        const content = meta.content instanceof Blob ? await meta.content.text() : new TextDecoder().decode(meta.content);
        // Never silently discard the dirty marker on an unreadable local record.
        sync = JSON.parse(content);
        if (sync.version !== 1 || typeof sync.dirty !== 'boolean') throw new Error('Local save recovery metadata is unreadable. The saved copy has been kept.');
      }
      return {files: files?.filter(file => file.name !== LOCAL_META) || null, sync};
    }
    async function write(manager, path, files, sync) {
      await rawSave.call(manager, localPath(owner(manager), path), [
        ...files.filter(file => file.name !== LOCAL_META),
        {name:LOCAL_META, content:new TextEncoder().encode(JSON.stringify({version:1, ...sync}))}
      ]);
    }
    async function fingerprint(files) {
      // ZIP timestamps and webRcade's info.txt change on every serialization.
      // Compare only the actual save files, including the RTC sidecar.
      const entries = await Promise.all(files.filter(file => !['info.txt', LOCAL_META].includes(file.name)).map(async file => {
        const bytes = await new Blob([file.content]).arrayBuffer();
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        return [file.name, Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')];
      }));
      entries.sort((a, b) => {
        const left = JSON.stringify(a), right = JSON.stringify(b);
        return left < right ? -1 : left > right ? 1 : 0;
      });
      return JSON.stringify(entries);
    }
    async function flush(manager, path, record) {
      const uid = owner(manager); requireAccount(uid);
      const zipPath = manager.getZipFileName(path);
      const key = versionKey(uid, zipPath), digest = await fingerprint(record.files);
      const conflict = () => Object.assign(new Error('This save changed on another device. Cloud upload was stopped and your local copy has been kept.'), {status:409});
      const remoteRecord = async () => {
        const files = await manager.getFiles(await download(zipPath, uid, manager.cloudRequestTimeoutMs));
        requireAccount(uid);
        return {digest:await fingerprint(files), base:versions.get(key)};
      };
      const clean = base => write(manager, path, record.files, {dirty:false, base:base ?? null});
      if (record.sync.attempt) {
        // An earlier PUT may have committed without its response reaching us.
        // Resolve that attempt before replacing it with newer local progress.
        try {
          const remote = await remoteRecord();
          if (remote.digest === digest) { await clean(remote.base); return; }
          if (!remote.base || (remote.digest !== record.sync.attempt && remote.base !== record.sync.base)) throw conflict();
          record.sync.base = remote.base;
        } catch (e) {
          if (e.status !== 404 || record.sync.base != null) throw e;
          // A first upload that never reached the server is safe to retry.
        }
      }
      record.sync = {dirty:true, base:record.sync.base ?? null, attempt:digest};
      await write(manager, path, record.files, record.sync);
      const zip = await manager.createZip(record.files);
      try { await upload(zip, zipPath, uid, record.sync.base, manager.cloudRequestTimeoutMs, manager.cloudUploadTimeoutMs); }
      catch (e) {
        if (e.status !== 409) throw e;
        // Also recover pre-upgrade pending records without an attempt marker.
        const remote = await remoteRecord();
        if (remote.digest !== digest) throw e;
      }
      await clean(versions.get(key));
    }
    proto.loadLocal = async function(path) { return (await read(this, path)).files; };
    proto.saveLocal = async function(path, files) {
      return locked(localPath(owner(this), path), async () => {
        const previous = await read(this, path);
        await write(this, path, files, {dirty:true, base:previous.sync?.base ?? versions.get(versionKey(owner(this), this.getZipFileName(path))) ?? null,
          ...(previous.sync?.dirty && previous.sync.attempt ? {attempt:previous.sync.attempt} : {})});
      });
    };
    proto.isCloudEnabled = async function() { return enabled() && owner(this) === account(); };
    proto.loadCloud = async function(path) {
      const uid = owner(this); requireAccount(uid);
      const files = await this.getFiles(await download(this.getZipFileName(path), uid, this.cloudRequestTimeoutMs));
      requireAccount(uid); return files;
    };
    proto.saveCloud = async function(path, files) {
      const uid = owner(this); requireAccount(uid);
      return upload(await this.createZip(files), this.getZipFileName(path), uid, undefined, this.cloudRequestTimeoutMs, this.cloudUploadTimeoutMs);
    };
    proto.loadCloudSingleFile = function(path) { return download(path, owner(this)); };
    proto.saveCloudSingleFile = function(path, content) { return upload(content, path, owner(this)); };
    proto.deleteCloudSingleFile = function(path) { return remove(path, owner(this)); };
    const originalDelete = proto.delete;
    proto.delete = async function(path, callback) {
      requireAccountIfConnected(this);
      const uid = owner(this);
      if (!enabled()) {
        const localOnly = Object.create(this);
        localOnly.isCloudEnabled = async () => false;
        return originalDelete.call(localOnly, localPath(uid, path), callback);
      }
      try { return await remove(this.getZipFileName(path), uid); }
      catch (e) { warn(this, e); return false; }
      finally { callback?.(null); }
    };
    function requireAccountIfConnected(manager) {
      if (owner(manager) !== account()) throw new Error('Cloud account changed. Reopen the game.');
    }
    const getSlots = proto.getStateSlots;
    proto.getStateSlots = async function(prefix, ...args) {
      requireAccountIfConnected(this);
      const uid = owner(this), slots = await getSlots.call(this, prefix, ...args);
      if (slots) await Promise.all(slots.map(async (slot, index) => {
        if (!slot) return;
        const path = `${prefix}state.${index}.zip`, key = versionKey(uid, path);
        try {
          const response = await request('file', {method:'HEAD', path, uid});
          versions.set(key, response.headers.get('ETag')); blocked.delete(key);
        } catch (e) { if (e.status === 404) versions.set(key, null); else blocked.add(key); }
      }));
      return slots;
    };
    proto.load = function(path, callback) {
      return locked(localPath(owner(this), path), async () => {
        if (this.gameSavesDisabled) return null;
        requireAccountIfConnected(this);
        try {
          let record = await read(this, path), files = record.files;
          if (enabled()) {
            if (record.sync?.dirty) {
              // Resume pending local progress first. Only its original cloud
              // revision may be replaced; conflicting cloud data stays intact.
              try { callback?.('Recovering local progress…'); await flush(this, path, record); }
              catch (e) { warn(this, e); }
            } else {
              try {
                callback?.('Loading from ' + providerName + '…');
                const remote = await this.loadCloud(path);
                const base = versions.get(versionKey(owner(this), this.getZipFileName(path))) ?? null;
                // Old unmarked backups are retained separately during migration.
                await write(this, path, remote, {dirty:false, base}); files = remote;
              } catch (e) {
                requireAccountIfConnected(this);
                if (e.status === 404 && files) {
                  record = {files, sync:{dirty:true, base:null}};
                  await write(this, path, files, record.sync);
                  try { await flush(this, path, record); } catch (error) { warn(this, error); }
                } else if (e.status !== 404) warn(this, e);
              }
            }
          }
          await window.WrcadClock?.restore(this, files);
          return files;
        } finally { callback?.(null); }
      });
    };
    const changed = proto.checkFilesChanged;
    // Opt-in metadata reader for large GameCube snapshots. Never migrate,
    // upload, or replace a save with these intentionally incomplete records.
    proto.inspectSave = function(path) {
      if (!this.getSaveMetadata) throw new Error('Save metadata reader unavailable.');
      return locked(localPath(owner(this), path), async () => {
        requireAccountIfConnected(this);
        const uid=owner(this), reader=Object.create(this);
        owners.set(reader,uid); reader.getFiles=blob=>this.getSaveMetadata(blob);
        const paths=[localPath(uid,path)];
        if(config.server===config.legacyServer||uid===null){
          paths.push('/'+prefix+'-local-v2/'+encodeURIComponent(JSON.stringify(uid))+'/'+path.replace(/^\/+/,''));
          if(localStorage.getItem(LEGACY_OWNER)===JSON.stringify(uid))paths.push(path);
        }
        let files=null;
        for(const candidate of paths){files=await rawLoad.call(reader,candidate);if(files)break;}
        const meta=files?.find(file=>file.name===LOCAL_META);
        const sync=meta?JSON.parse(meta.content instanceof Blob?await meta.content.text():new TextDecoder().decode(meta.content)):null;
        if(sync&&(sync.version!==1||typeof sync.dirty!=='boolean'))throw new Error('Local save recovery metadata is unreadable. The saved copy has been kept.');
        if(enabled()&&!sync?.dirty){
          try{files=await reader.loadCloud(path);}
          catch(error){requireAccountIfConnected(this);if(error.status!==404)warn(this,error);}
        }
        requireAccountIfConnected(this);
        return files?.filter(file=>file.name!==LOCAL_META)||null;
      });
    };
    proto.checkFilesChanged = async function(files) {
      window.WrcadClock?.capture(this, files);
      return changed.call(this, files);
    };
    proto.save = function(path, files, callback) {
      return locked(localPath(owner(this), path), async () => {
        if (this.gameSavesDisabled) return;
        const uid = owner(this), previous = await read(this, path);
        const base = previous.sync?.dirty ? previous.sync.base : versions.get(versionKey(uid, this.getZipFileName(path))) ?? previous.sync?.base;
        const record = {files, sync:{dirty:true, base:base ?? null,
          ...(previous.sync?.dirty && previous.sync.attempt ? {attempt:previous.sync.attempt} : {})}};
        await write(this, path, files, record.sync);
        try {
          requireAccountIfConnected(this);
          if (!enabled()) return true;
          callback?.('Saving to ' + providerName + '…'); await flush(this, path, record); return true;
        } catch (e) { warn(this, e); return false; }
        finally { callback?.(null); }
      });
    };
    proto.saveState = async function(prefix, slot, state, canvas, callback, shot, imageProps, otherProps = {}) {
      const path = `${prefix}state.${slot}`, files = [{name:'state', content:state}];
      await this.saveLocal(path, files);
      try {
        requireAccountIfConnected(this);
        if (!enabled()) return;
        callback?.('Saving to ' + providerName + '…');
        await this.saveCloud(path, files);
        await this.saveCloudSingleFile(path + '.json', JSON.stringify({time:Date.now(), shot:shot || canvas?.toDataURL() || null,
          imageProps:imageProps || {}, ...otherProps}));
      } catch (e) { warn(this, e); }
      finally { callback?.(null); }
    };
  }
  function install(exports) {
    for (const key of Object.keys(exports || {})) {
      let value;
      try { value = exports[key]; } catch (_) { continue; }
      if (!value || !['object','function'].includes(typeof value) || installed.has(value)) continue;
      if (typeof value.isCloudStorageEnabled === 'function' && typeof value.getDbToken === 'function') {
        installed.add(value); stats.settings++;
        const load = value.load;
        value.load = async function(...args) {
          await startup;
          await load.apply(this, args);
          // Remove the obsolete one-shot Nextcloud flag without changing the
          // user's preference for native cloud providers.
          localStorage.removeItem(KEY + '.enable');
        };
      } else if (typeof value.uploadFile === 'function' && typeof value.checkLinkResult === 'function') {
        installed.add(value); stats.storage++;
      } else if (value.prototype?.saveLocal && value.prototype?.getStateSlots) {
        installed.add(value); stats.saves++;
        installSaves(value);
      } else if (typeof value === 'function' && typeof value.getText === 'function' && typeof value.check === 'function') {
        installed.add(value); stats.resources++;
      }
    }
  }
  function attachChunk(name) {
    const bucket = window[name] = window[name] || [];
    const wrapped = new WeakSet();
    function patch(chunk) {
      if (!chunk?.[1] || typeof chunk[1] !== 'object') return;
      for (const id of Object.keys(chunk[1])) {
        const factory = chunk[1][id];
        if (typeof factory !== 'function' || wrapped.has(factory)) continue;
        const wrapper = function(module, exports, require) {
          const result = factory.call(this, module, exports, require);
          install(module.exports);
          return result;
        };
        wrapped.add(wrapper); chunk[1][id] = wrapper;
      }
    }
    for (const chunk of bucket) patch(chunk);
    let push = bucket.push;
    Object.defineProperty(bucket, 'push', {configurable:true,
      get: () => {
        const handler = push;
        return function(...chunks) { chunks.forEach(patch); return handler.apply(this, chunks); };
      },
      set: value => { push = value; }});
  }
  const controlsPath = '/settings/touch-controller.v1.json';
  const recentPath = '/settings/recently-played.v1.json';
  function installUI({react, CloudStorageTab}) {
    if (installed.has(CloudStorageTab)) return;
    installed.add(CloudStorageTab);
    const original = CloudStorageTab.prototype.render;
    CloudStorageTab.prototype.render = function() {
      // Reuse the pinned native fields/buttons, including keyboard/gamepad focus.
      const view = Object.create(this);
      view.props = {...this.props, values:{...this.props.values, cloudStorage:true}};
      const [, [providerRow, status, disableSaves]] = original.call(view);
      this.providerLinkRef ||= react.createRef();
      const row = (template, label, content) => react.cloneElement(template, {},
        react.cloneElement(template.props.children[0], {}, label),
        react.cloneElement(template.props.children[1], {}, content));
      const manage = providerRow.props.children[1].props.children;
      const button = react.cloneElement(manage.props.children, {
        ref:this.providerLinkRef, label:account() ? 'Manage' : 'Link',
        onPad:e => this.context.focusGrid.moveFocus(e.type, this.providerLinkRef),
        onClick:() => {
          if (!account()) { connect(); return; }
          const url = new URL('/cloud-saves/', location.origin);
          url.searchParams.set('provider', provider);
          url.searchParams.set('return', window.top.location.href);
          window.top.location.assign(url.href);
        }
      });
      const linkedProvider = row(providerRow, providerName, react.cloneElement(manage, {}, button));
      const providerStatus = row(status, 'Status', !config.accessAllowed ? config.message : account() ?
        'Connected' + (connection.name ? ' as ' + connection.name : '') + ' · automatic saves' :
        'Disconnected · saves stay on this browser');
      this.gridComps = config.enabled ? [[this.providerLinkRef], [this.disableSavesRef]] : [];
      const rows = config.enabled ? [linkedProvider, providerStatus, disableSaves] : [];
      if (window.WrcadCloudConfig?.dropbox?.enabled || window.WrcadCloudConfig?.enabled) {
        this.providerRef ||= react.createRef();
        const choose = react.cloneElement(manage.props.children, {
          ref:this.providerRef, label:'Choose storage',
          onPad:e => this.context.focusGrid.moveFocus(e.type, this.providerRef),
          onClick:() => {
            const url = new URL('/cloud-saves/', location.origin);
            url.searchParams.set('return', window.top.location.href);
            window.top.location.assign(url.href);
          }
        });
        rows.push(row(providerRow, 'Save destination', react.cloneElement(manage, {}, choose)));
        this.gridComps.push([this.providerRef]);
      }
      if (!rows.length) rows.push(row(status, 'Cloud storage', config.message));
      return rows;
    };
  }
  window.WrcadCloud = {attachChunk, install, installUI, stats, connect, unlink,
    providerName,
    controlsAccount: () => enabled() ? (provider === 'dropbox' ? JSON.stringify([config.server, account()]) : account()) : null,
    loadControls: async () => JSON.parse(await (await download(controlsPath)).text()),
    saveControls: value => upload(JSON.stringify(value), controlsPath),
    loadRecent: async () => JSON.parse(await (await download(recentPath)).text()),
    saveRecent: value => upload(JSON.stringify(value), recentPath)};
  if (window === window.top) {
    try {
      const message = sessionStorage.getItem(KEY + '.notice');
      if (message) { sessionStorage.removeItem(KEY + '.notice'); notice(message); }
    } catch (_) {}
    const script = document.createElement('script');
    script.src = '/cloud-saves/controller-sync.js?v=1';
    document.head.append(script);
    window.WrcadRecent?.sync();
  }
})();
