/* One coordinator per player tab; the game iframe shares its browser storage. */
(() => {
  'use strict';
  const prefix = window.WrcadCloudConfig?.storagePrefix || 'webrcade';
  const cloud = window.WrcadCloud;
  const ENABLED = prefix + '.touch.enabled.v1', FADE = prefix + '.touch.translucence.v1', LAYOUTS = prefix + '.touch.layouts.v1';
  const MUTED = prefix + '.touch.muted.v1';
  const DS_VIEW = prefix + '.touch.ds-view.v1';
  const N3DS_VIEW = prefix + '.touch.3ds-view.v1';
  const DOCK_SIDE = prefix + '.touch.dock-side.v1';
  const PREFIX = prefix + '.touch.sync.v1.';
  let running = null, timer = null;
  cloud.controlsStatus = 'Controller settings saved on this browser.';
  function validate(units) {
    const result = {};
    if (!units || typeof units !== 'object' || Array.isArray(units)) return result;
    for (const [key, value] of Object.entries(units).slice(0, 256)) {
      if (['enabled', 'muted'].includes(key) && typeof value === 'boolean') result[key] = value;
      else if (key === 'dockSide' && ['left', 'right'].includes(value)) result[key] = value;
      else if (key === 'dsView' && Number.isInteger(value) && value >= 0 && value <= 5) result[key] = value;
      else if (key === 'n3dsView' && ['stacked', 'side', 'top', 'touch'].includes(value)) result[key] = value;
      else if (key === 'translucence' && Number.isFinite(value) && value >= 0 && value <= 80) result[key] = value;
      else if (/^layout:[a-z0-9-]+:(portrait|landscape)$/.test(key) && value && typeof value === 'object' && !Array.isArray(value)) {
        const layout = {};
        for (const [id, point] of Object.entries(value).slice(0, 64)) {
          if (/^(button-\d+|axis-[01],-?1|menu|dock|stick|stick-left|stick-right|dpad)$/.test(id) &&
              Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)) layout[id] = point.map(n => Math.max(0, Math.min(1, n)));
        }
        result[key] = layout;
      }
    }
    return result;
  }
  function localUnits() {
    const values = {};
    const enabled = localStorage.getItem(ENABLED), fade = localStorage.getItem(FADE);
    if (enabled !== null) values.enabled = enabled !== 'false';
    if (fade !== null) values.translucence = Number(fade);
    const muted = localStorage.getItem(MUTED);
    if (muted !== null) values.muted = muted === 'true';
    const dockSide = localStorage.getItem(DOCK_SIDE);
    if (dockSide !== null) values.dockSide = dockSide;
    const dsView = localStorage.getItem(DS_VIEW);
    if (dsView !== null) values.dsView = Number(dsView);
    const n3dsView = localStorage.getItem(N3DS_VIEW);
    if (n3dsView !== null) values.n3dsView = n3dsView;
    try { for (const [key, value] of Object.entries(JSON.parse(localStorage.getItem(LAYOUTS)) || {})) values['layout:' + key] = value; } catch (_) {}
    return validate(values);
  }
  function state(uid) {
    try {
      const value = JSON.parse(localStorage.getItem(PREFIX + uid));
      return {initialized: value?.initialized === true, pending: validate(value?.pending)};
    } catch (_) { return {initialized:false, pending:{}}; }
  }
  function announce(event, detail) {
    for (const target of [window, ...Array.from(window.frames)]) {
      try { target.dispatchEvent(new target.CustomEvent(event, {detail})); } catch (_) {}
    }
  }
  function status(message) {
    cloud.controlsStatus = message;
    announce('wrcad:controls-status', message);
  }
  function apply(units) {
    const current = localUnits();
    const canonical = value => value && typeof value === 'object' ?
      JSON.stringify(value, Object.keys(value).sort()) : JSON.stringify(value);
    if (!Object.entries(units).some(([key, value]) => canonical(value) !== canonical(current[key]))) return;
    const layouts = {};
    // Preserve local-only platforms when importing an existing cloud profile.
    try { Object.assign(layouts, JSON.parse(localStorage.getItem(LAYOUTS)) || {}); } catch (_) {}
    if ('enabled' in units) localStorage.setItem(ENABLED, String(units.enabled));
    if ('muted' in units) localStorage.setItem(MUTED, String(units.muted));
    if ('dockSide' in units) localStorage.setItem(DOCK_SIDE, units.dockSide);
    if ('dsView' in units) localStorage.setItem(DS_VIEW, String(units.dsView));
    if ('n3dsView' in units) localStorage.setItem(N3DS_VIEW, units.n3dsView);
    if ('translucence' in units) localStorage.setItem(FADE, String(units.translucence));
    for (const [key, value] of Object.entries(units)) if (key.startsWith('layout:')) layouts[key.slice(7)] = value;
    localStorage.setItem(LAYOUTS, JSON.stringify(layouts));
    announce('wrcad:controls-loaded');
  }
  function schedule(delay = 700) { clearTimeout(timer); timer = setTimeout(() => cloud.syncControls(), delay); }
  cloud.controlsChanged = patch => {
    const uid = cloud.controlsAccount();
    if (!uid) { status('Controller settings saved on this browser.'); return; }
    try {
      const current = state(uid);
      current.pending = {...current.pending, ...validate(patch)};
      localStorage.setItem(PREFIX + uid, JSON.stringify(current));
      status('Controller settings syncing…'); schedule();
    } catch (_) { status('Controller settings could not be saved in this browser.'); }
  };
  cloud.syncControls = () => {
    if (running) return running;
    const uid = cloud.controlsAccount();
    if (!uid) { status('Controller settings saved on this browser.'); return Promise.resolve(); }
    running = (async () => {
      status('Controller settings syncing…');
      for (let attempt = 0; attempt < 3; attempt++) {
        let remote = {};
        try {
          const doc = await cloud.loadControls();
          if (doc?.version !== 1 || !doc.settings || typeof doc.settings !== 'object') throw new Error('Unsupported controller profile');
          remote = validate(doc.settings);
        } catch (error) { if (error.status !== 404) throw error; }
        if (cloud.controlsAccount() !== uid) return;
        const current = state(uid), patch = current.pending;
        // First connection imports cloud values; existing local layouts seed only
        // missing platforms. Later saves send only explicitly edited units.
        const merged = {...(current.initialized ? {} : localUnits()), ...remote, ...patch};
        try {
          if (JSON.stringify(merged) !== JSON.stringify(remote)) await cloud.saveControls({version:1, settings:merged});
        } catch (error) { if (error.status === 409) continue; throw error; }
        if (cloud.controlsAccount() !== uid) return;
        const latest = state(uid);
        for (const [key, value] of Object.entries(patch)) {
          if (JSON.stringify(latest.pending[key]) === JSON.stringify(value)) delete latest.pending[key];
        }
        latest.initialized = true;
        localStorage.setItem(PREFIX + uid, JSON.stringify(latest));
        apply({...merged, ...latest.pending});
        if (Object.keys(latest.pending).length) { schedule(); return; }
        status('Controller settings saved to Nextcloud.');
        return;
      }
      throw new Error('Controller settings changed during sync');
    })().catch(() => {
      status('Saved on this browser. Nextcloud sync will retry.');
      schedule(30000);
    }).finally(() => { running = null; });
    return running;
  };
  window.addEventListener('storage', e => {
    if (e.key === prefix + '.nextcloud.connection.v1' || e.key === PREFIX + cloud.controlsAccount()) schedule();
  });
  window.addEventListener('online', () => schedule(0));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
  cloud.syncControls();
})();
