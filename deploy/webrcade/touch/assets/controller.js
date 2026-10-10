/* Mobile overlay for the pinned webRcade 0.2.3 controller interface. */
(() => {
  'use strict';
  const prefix = window.WrcadCloudConfig?.storagePrefix || 'webrcade';
  if (!(navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches)) return;
  const KEY = prefix + '.touch.enabled.v1';
  const MUTE_KEY = prefix + '.touch.muted.v1';
  const DS_VIEW_KEY = prefix + '.touch.ds-view.v1';
  const parseDSView = value => /^[0-5]$/.test(String(value)) ? Number(value) : null;
  let dsView = null, dsEmulator = null, dsObserver = null;
  try { dsView = parseDSView(localStorage.getItem(DS_VIEW_KEY)); } catch (_) { /* Use the game's layout. */ }
  const DOCK_SIDE_KEY = prefix + '.touch.dock-side.v1';
  const parseDockSide = value => value === 'left' ? 'left' : 'right';
  let dockSide = 'right';
  try { dockSide = parseDockSide(localStorage.getItem(DOCK_SIDE_KEY)); } catch (_) { /* Default right edge. */ }
  const TRANSLUCENCE_KEY = prefix + '.touch.translucence.v1';
  const parseTranslucence = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(80, Number(value))) : 0;
  let enabled = true;
  let translucence = 0;
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === 'true'; } catch (_) { /* Default sound on. */ }
  // Keep the core's audio clock running: Libretro uses it during initialization.
  // A master gain silences every output (including achievements) without causing
  // the upstream "enable audio" screen to block a game launched while muted.
  const audioGates = new Map();
  const audioNode = window.AudioNode?.prototype;
  if (audioNode) {
    const connect = audioNode.connect, disconnect = audioNode.disconnect;
    audioNode.connect = function(destination, ...args) {
      if (destination === this.context.destination) {
        let gate = audioGates.get(this.context);
        if (!gate) {
          const context = this.context;
          gate = context.createGain(); gate.gain.value = muted ? 0 : 1;
          connect.call(gate, destination);
          audioGates.set(context, gate);
          context.addEventListener('statechange', () => {
            if (context.state === 'closed') audioGates.delete(context);
          });
        }
        connect.call(this, gate, ...args);
        return destination;
      }
      return connect.call(this, destination, ...args);
    };
    audioNode.disconnect = function(...args) {
      if (args[0] === this.context.destination && audioGates.has(this.context)) args[0] = audioGates.get(this.context);
      return disconnect.apply(this, args);
    };
  }
  function applyMute() {
    // Ambient is non-exclusive, so phone music/podcasts can keep playing.
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (_) { /* Older browsers. */ }
    for (const gate of audioGates.values()) gate.gain.value = muted ? 0 : 1;
  }
  applyMute();
  try { enabled = localStorage.getItem(KEY) !== 'false'; } catch (_) { /* Private browsing. */ }
  try { translucence = parseTranslucence(localStorage.getItem(TRANSLUCENCE_KEY)); } catch (_) { /* Use default appearance. */ }
  const host = document.createElement('div');
  host.id = 'wrcad-touch';
  host.hidden = true; // Loading and library pages must not flash the settings tab.
  host.innerHTML = `
    <div class="kt-dock">
      <button class="kt-tab" aria-label="Touch controller settings" aria-expanded="false" aria-controls="kt-drawer">‹</button>
      <section id="kt-drawer" aria-label="Touch controller settings" hidden>
        <strong>Touch controller</strong>
        <button class="kt-toggle kt-switch" role="switch" aria-checked="true"><i></i><span>Controls on</span></button>
        <button class="kt-mute kt-switch" role="switch" aria-checked="false"><i></i><span>Mute audio</span></button>
        <button class="kt-edit" disabled>Edit layout</button>
        <div class="kt-ds-screens" role="group" aria-label="DS screens" hidden>
          <strong>DS screens</strong>
          <button class="kt-ds-cycle">View</button>
          <div><button class="kt-ds-single">Single screen</button><button class="kt-ds-dual">Dual screens</button></div>
        </div>
        <div class="kt-3ds-screens" role="group" aria-label="3DS screens" hidden>
          <strong>3DS screens</strong>
          <button class="kt-3ds-cycle">View</button>
        </div>
        <div class="kt-translucence">
          <div class="kt-translucence-label"><label for="kt-translucence">Translucence</label><output for="kt-translucence">0%</output></div>
          <input id="kt-translucence" type="range" min="0" max="80" step="5" value="0">
        </div>
        <button class="kt-close">Close panel ›</button>
      </section>
    </div>
    <div class="kt-editor" hidden>
      <span>Drag buttons to move them</span>
      <div><button class="kt-save">Save</button><button class="kt-cancel">Cancel</button><button class="kt-reset">Reset</button></div>
    </div>
    <div class="kt-pad" aria-label="Touch game controller" hidden>
      <div class="kt-shoulders"><button data-cid="8">L</button><button data-cid="10">L2</button><button data-cid="11">R2</button><button data-cid="9">R</button></div>
      <div class="kt-stick" role="group" aria-label="Directional pad: drag in any direction"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><i></i></div>
      <div class="kt-center"><button data-cid="12">Select</button><button class="kt-menu">Menu</button><button data-cid="13">Start</button></div>
      <div class="kt-actions"><button data-cid="7">Y</button><button data-cid="6">X</button><button data-cid="5">B</button><button data-cid="4">A</button></div>
      <div class="kt-cbuttons" hidden><button data-axis="1,-1">C▲</button><button data-axis="0,-1">C◀</button><button data-axis="0,1">C▶</button><button data-axis="1,1">C▼</button></div>
    </div>`;
  document.body.append(host);
  const $ = s => host.querySelector(s);
  const tab = $('.kt-tab'), drawer = $('#kt-drawer'), toggle = $('.kt-toggle'), pad = $('.kt-pad');
  const stick = $('.kt-stick');
  const dsCycle = $('.kt-ds-cycle');
  const cloud = () => { try { return window.top.WrcadCloud || window.WrcadCloud; } catch (_) { return window.WrcadCloud; } };
  const saveControls = patch => cloud()?.controlsChanged?.(patch);
  const drawMute = () => $('.kt-mute').setAttribute('aria-checked', String(muted));
  $('.kt-mute').addEventListener('click', () => {
    muted = !muted; applyMute(); drawMute();
    try { localStorage.setItem(MUTE_KEY, String(muted)); } catch (_) { /* Session choice works. */ }
    saveControls({muted});
  });
  drawMute();
  function drawTranslucence() {
    host.style.setProperty('--kt-control-opacity', String(Math.max(.2, 1 - translucence / 100)));
    $('#kt-translucence').value = String(translucence);
    $('#kt-translucence').setAttribute('aria-valuetext', `${translucence}% translucent`);
    $('.kt-translucence output').value = `${translucence}%`;
  }
  $('#kt-translucence').addEventListener('input', e => {
    translucence = parseTranslucence(e.target.value);
    drawTranslucence();
    try { localStorage.setItem(TRANSLUCENCE_KEY, String(translucence)); } catch (_) { /* Session preference still works. */ }
    saveControls({translucence});
  });
  // Keep keyboard adjustment local to the slider, away from game shortcuts.
  for (const event of ['keydown', 'keyup']) {
    $('#kt-translucence').addEventListener(event, e => { if (e.key !== 'Escape') e.stopPropagation(); });
  }
  drawTranslucence();
  const pointers = new Map();
  const touchPointers = new Map();
  const held = new Set();
  const axes = [0, 0, 0, 0];
  const patched = new WeakSet();
  const patchedEmulators = new WeakSet();
  const patchedTouches = new WeakSet();
  let touchPauseBlocked = false, touchPauseTimer = null;
  let gameReady = false;
  let activeController = null;
  let drawerOpen = false;
  const emulatorPath = location.pathname.split('/')[3];
  let launchProps = {};
  try {
    launchProps = JSON.parse(decodeURIComponent(atob(new URLSearchParams(location.search).get('props'))));
  } catch (_) { /* Library pages have no launch properties. */ }
  if (!launchProps || typeof launchProps !== 'object') launchProps = {};
  // Default and user-selected cores can share a platform, or even a URL (GB/GBC).
  // Resolve the actual launch type instead of assuming the URL is the console.
  const platformCores = {
    nes: ['nes', 'fceux', 'retro-fceumm'],
    snes: ['snes', 'snes9x', 'retro-snes9x'],
    gb: ['gb', 'vba-m-gb', 'retro-sameboy-gb'],
    gbc: ['gbc', 'vba-m-gbc', 'retro-sameboy-gbc'],
    gba: ['gba', 'vba-m-gba', 'retro-mgba-gba', 'retro-mgba'],
    n64: ['n64', 'parallel-n64', 'retro-parallel-n64'],
    nds: ['nds', 'retro-melonds'],
    '3ds': ['3ds', 'retro-azahar'],
    genesis: ['genesis', 'genplusgx-md', 'retro-genplusgx-md', 'retro-genesis'],
    psx: ['psx', 'beetle-psx'],
    psp: ['psp', 'retro-ppsspp'],
  };
  const core = launchProps?.type || emulatorPath;
  const system = Object.keys(platformCores).find(platform => platformCores[platform].includes(core)) || emulatorPath;
  document.documentElement.classList.toggle('kt-ds-active', system === 'nds');
  const dsScreens = $('.kt-ds-screens');
  // Measures the safe area for screen placement. It lives outside the controller
  // host, which is hidden behind the audio prompt and pause screens and would
  // then measure as empty. DS and 3DS each own one; they share no placement state.
  function safeArea(name) {
    const element = document.createElement('div');
    element.className = name;
    element.setAttribute('aria-hidden', 'true');
    document.body.append(element);
    return element;
  }
  const dsOrigin = system === 'nds' ? safeArea('kt-ds-origin') : null;
  const dsViews = [[2, 'Side by side'], [3, 'Side by side ↔'], [0, 'Vertical'],
    [1, 'Vertical ↕'], [4, 'Top screen'], [5, 'Touchscreen']];
  function alignDSScreens(emulator) {
    const canvas = emulator.canvas;
    if (!canvas) return;
    if (emulator.bookMode || ![0, 1].includes(emulator.getScreenLayout())) {
      // The core's resize has restored its normal size; restore CSS centering
      // as well when leaving either of the vertically stacked views.
      canvas.style.removeProperty('top');
      canvas.style.removeProperty('left');
      return;
    }
    // Fit the native screen ratio into the entire safe area. Starting from the
    // core's already-inset canvas would keep its margins and prevent enlargement.
    const bounds = dsOrigin.getBoundingClientRect();
    const ratio = emulator.getDefaultAspectRatio();
    if (!bounds.width || !bounds.height || !Number.isFinite(ratio) || ratio <= 0) return;
    const width = Math.min(bounds.width, bounds.height * ratio), height = width / ratio;
    canvas.style.setProperty('max-width', 'none', 'important');
    canvas.style.setProperty('max-height', 'none', 'important');
    canvas.style.setProperty('width', `${width}px`, 'important');
    canvas.style.setProperty('height', `${height}px`, 'important');
    canvas.style.setProperty('left', `${bounds.left + bounds.width / 2}px`, 'important');
    canvas.style.setProperty('top', `${bounds.top + height / 2}px`, 'important');
  }
  const n3dsOrigin = system === '3ds' ? safeArea('kt-3ds-origin') : null;
  // The 3DS arrangement is the app's own setting (emulator.getViews/setView);
  // nothing here is shared with the DS views above.
  const N3DS_VIEW_KEY = prefix + '.touch.3ds-view.v1';
  const n3dsScreens = $('.kt-3ds-screens'), n3dsCycle = $('.kt-3ds-cycle');
  function update3DSLabel(emulator) {
    const label = emulator.getViews().find(([id]) => id === emulator.getView())?.[1] || 'View';
    n3dsCycle.textContent = `View: ${label}`;
    n3dsCycle.setAttribute('aria-label', `3DS view: ${label}. Change view`);
  }
  n3dsCycle.addEventListener('click', () => {
    const emulator = window.app?.emulator;
    if (!gameReady || editing || !emulator?.getViews) return;
    const views = emulator.getViews();
    const next = views[(views.findIndex(([id]) => id === emulator.getView()) + 1) % views.length][0];
    clear(); emulator.setView(next);
    saveControls({n3dsView: next});
    update3DSLabel(emulator);
  });
  let n3dsEmulator = null, n3dsObserver = null;
  function align3DSScreens(emulator) {
    const canvas = emulator.canvas;
    if (!canvas) return;
    // The app has just restored the aspect-preserving size. Landscape keeps it;
    // only portrait's explicit positioning needs clearing on every resize.
    for (const name of ['left', 'top']) canvas.style.removeProperty(name);
    if (innerWidth > innerHeight) return;
    const bounds = n3dsOrigin.getBoundingClientRect();
    const ratio = emulator.getDefaultAspectRatio();
    if (!bounds.width || !bounds.height || !Number.isFinite(ratio) || ratio <= 0) return;
    const width = Math.min(bounds.width, bounds.height * ratio), height = width / ratio;
    canvas.style.setProperty('max-width', 'none', 'important');
    canvas.style.setProperty('max-height', 'none', 'important');
    canvas.style.setProperty('width', `${width}px`, 'important');
    canvas.style.setProperty('height', `${height}px`, 'important');
    canvas.style.setProperty('left', `${bounds.left + bounds.width / 2}px`, 'important');
    canvas.style.setProperty('top', `${bounds.top + height / 2}px`, 'important');
  }
  function applyDSView(emulator, value) {
    if (system !== 'nds' || !emulator?.started || value === null) return;
    clear(); emulator.resetToggleLayout(); emulator.setBookMode(false);
    emulator.getPrefs().setScreenLayout(value);
    emulator.updateScreenLayout();
  }
  function rememberDSView(emulator) {
    dsView = emulator.getPrefs().getScreenLayout();
    try { localStorage.setItem(DS_VIEW_KEY, String(dsView)); } catch (_) { /* Session choice works. */ }
    saveControls({dsView});
    updateDSLabel(emulator);
  }
  function updateDSLabel(emulator) {
    const label = dsViews.find(([value]) => value === emulator.getPrefs().getScreenLayout())?.[1] || 'View';
    dsCycle.textContent = `View: ${label}`;
    dsCycle.setAttribute('aria-label', `DS view: ${label}. Change view`);
  }
  dsCycle.addEventListener('click', () => {
    const emulator = window.app?.emulator;
    if (!gameReady || editing) return;
    const index = dsViews.findIndex(([value]) => value === emulator.getPrefs().getScreenLayout());
    dsView = dsViews[(index + 1) % dsViews.length][0];
    applyDSView(emulator, dsView);
    rememberDSView(emulator);
  });
  $('.kt-ds-single').addEventListener('click', () => {
    if (!gameReady || editing) return;
    const emulator = window.app.emulator;
    applyDSView(emulator, emulator.getPrefs().getScreenLayout() === 4 ? 5 : 4);
    rememberDSView(emulator);
  });
  $('.kt-ds-dual').addEventListener('click', () => {
    if (!gameReady || editing) return;
    const emulator = window.app.emulator;
    const layout = emulator.getPrefs().getScreenLayout();
    applyDSView(emulator, layout > 3 ? 2 : (layout + 1) % 4);
    rememberDSView(emulator);
  });
  host.dataset.platform = system || 'library';
  const n64 = system === 'n64';
  // Like the N64, the 3DS has an analog pad and a separate D-pad.
  const n3ds = system === '3ds';
  const directions = [stick];
  function configureDirection(element, kind, index = 0) {
    element.dataset.direction = kind;
    element.dataset.stickIndex = String(index);
    element.classList.toggle('kt-dpad', kind === 'digital');
    element.setAttribute('aria-label', kind === 'digital' ? 'Directional pad: slide for directions and diagonals' :
      system === 'psx' ? `${index ? 'Right' : 'Left'} analog stick` :
      n3ds ? (index ? 'C-stick' : 'Circle Pad') : 'Analog stick');
  }
  configureDirection(stick, n64 || n3ds || system === 'psp' ? 'analog' : 'digital');
  function addDirection(id, kind, index, className) {
    const element = stick.cloneNode(true);
    element.dataset.layoutId = id;
    element.classList.add(className);
    configureDirection(element, kind, index);
    pad.append(element); directions.push(element);
    return element;
  }
  if (n64 || n3ds || system === 'psp') addDirection('dpad', 'digital', 0, 'kt-extra-dpad');
  if (n3ds) addDirection('stick-right', 'analog', 1, 'kt-c-stick');
  const psxSticks = system === 'psx' ? [
    addDirection('stick-left', 'analog', 0, 'kt-analog-left'),
    addDirection('stick-right', 'analog', 1, 'kt-analog-right'),
  ] : [];
  for (const element of psxSticks) element.hidden = true;
  let psxAnalog = false;
  const LAYOUT_KEY = prefix + '.touch.layouts.v1';
  let layouts = {};
  try {
    const stored = JSON.parse(localStorage.getItem(LAYOUT_KEY));
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) layouts = stored;
  } catch (_) { /* Missing or unavailable preferences use the standard layout. */ }
  let editing = false, editDrag = null, beforeEdit = null, editEmulator = null;
  let layoutStamp = '';
  const movable = [...pad.querySelectorAll('button, .kt-stick')];
  const TOUCH_PADDING = 10;
  // RetroArch's default D-pad diagonal sensitivity (80%) gives each cardinal
  // a 50-degree sector and each diagonal a 40-degree sector (25..65 degrees).
  // See input_overlay_get_eightway_slope_limits in RetroArch/input/input_driver.c.
  const DPAD_DIAGONAL_SLOPE = Math.tan(25 * Math.PI / 180);
  let hitAreas = [];
  for (const element of movable) {
    element.dataset.layoutId ||= element === stick ? 'stick' : element.dataset.cid !== undefined ?
      `button-${element.dataset.cid}` : element.dataset.axis ? `axis-${element.dataset.axis}` : 'menu';
  }
  const layoutKey = () => `${system || 'library'}:${innerWidth > innerHeight ? 'landscape' : 'portrait'}`;
  function currentLayout() {
    // Keep layouts saved before platform names replaced emulator URL names.
    const legacyKey = `${emulatorPath}:${innerWidth > innerHeight ? 'landscape' : 'portrait'}`;
    const value = layouts[layoutKey()] ?? layouts[legacyKey];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  function applyLayout() {
    for (const element of movable) { element.style.transform = ''; element.style.visibility = ''; }
    if (pad.hidden) return;
    const saved = currentLayout();
    const obstacles = [tab.getBoundingClientRect()];
    if (!dsCycle.hidden) obstacles.push(dsCycle.getBoundingClientRect());
    if (editing) obstacles.push($('.kt-editor').getBoundingClientRect());
    const gap = 10; // Includes the editor's dashed outlines and a finger gap.
    for (const element of movable) {
      const point = saved[element.dataset.layoutId];
      const r = element.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const custom = Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
      const desiredX = custom ? point[0] * innerWidth : r.left + r.width / 2;
      const desiredY = custom ? point[1] * innerHeight : r.top + r.height / 2;
      const clampX = x => Math.max(8 + r.width / 2, Math.min(innerWidth - 8 - r.width / 2, x));
      const clampY = y => Math.max(8 + r.height / 2, Math.min(innerHeight - 8 - r.height / 2, y));
      // Apply the exclusion area to defaults, restored layouts, and live drags.
      // Choose the closest free position alongside/above/below the tab.
      const xs = [desiredX, ...obstacles.flatMap(o => [o.left - gap - r.width / 2, o.right + gap + r.width / 2])].map(clampX);
      const ys = [desiredY, ...obstacles.flatMap(o => [o.top - gap - r.height / 2, o.bottom + gap + r.height / 2])].map(clampY);
      const positions = xs.flatMap(x => ys.map(y => ({x, y}))).filter(p => obstacles.every(o =>
        p.x + r.width / 2 <= o.left - gap || p.x - r.width / 2 >= o.right + gap ||
        p.y + r.height / 2 <= o.top - gap || p.y - r.height / 2 >= o.bottom + gap));
      positions.sort((a, b) => Math.hypot(a.x - desiredX, a.y - desiredY) - Math.hypot(b.x - desiredX, b.y - desiredY));
      // On an exceptionally small viewport, hide a control rather than cover
      // the settings handle; it returns as soon as there is room again.
      if (!positions.length) { element.style.visibility = 'hidden'; continue; }
      const {x, y} = positions[0];
      element.style.transform = `translate(${x - r.left - r.width / 2}px, ${y - r.top - r.height / 2}px)`;
    }
    // Read geometry once after layout, not on every high-frequency touch move.
    hitAreas = movable.flatMap(element => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || element.style.visibility === 'hidden') return [];
      const cssRadius = getComputedStyle(element).borderTopLeftRadius;
      const pixels = (parseFloat(cssRadius) || 0) * (cssRadius.endsWith('%') ? Math.min(rect.width, rect.height) / 100 : 1);
      const radius = Math.min(pixels, rect.width / 2, rect.height / 2);
      return [{element, rect, radius}];
    });
  }
  function cancelDrag() {
    if (!editDrag) return;
    const {key, id, previous} = editDrag;
    if (previous === undefined) delete layouts[key][id];
    else layouts[key][id] = previous;
    editDrag = null; drawDock(); applyLayout();
  }
  function finishEdit(save) {
    cancelDrag();
    if (save) {
      const changes = {};
      for (const [key, value] of Object.entries(layouts)) {
        if (JSON.stringify(value) !== JSON.stringify(beforeEdit?.[key])) changes[key] = value;
      }
      try {
        layouts = {...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}'), ...changes};
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(layouts));
      } catch (_) { /* Session layout still works. */ }
      saveControls(Object.fromEntries(Object.entries(changes).map(([key, value]) => ['layout:' + key, value])));
    } else if (beforeEdit) layouts = beforeEdit;
    editing = false; beforeEdit = null;
    host.classList.remove('kt-editing');
    $('.kt-editor').hidden = true;
    if (editEmulator === window.app?.emulator && !document.hidden && !window.app.isPauseScreen()) editEmulator.pause(false);
    editEmulator = null; layoutStamp = ''; clear(); draw();
    refreshPreferences();
  }
  $('.kt-edit').addEventListener('click', () => {
    if (editing) { setDrawer(false); return; }
    if (!gameReady) return;
    clear(); beforeEdit = JSON.parse(JSON.stringify(layouts)); editing = true;
    editEmulator = window.app.emulator; editEmulator.pause(true); gameReady = false;
    host.classList.add('kt-editing'); $('.kt-editor').hidden = false;
    setDrawer(false);
  });
  // Touch browsers can suppress the next synthetic click after a drag. Handle
  // editor taps directly while retaining click activation for mouse/keyboard.
  function editorAction(selector, action) {
    const button = $(selector);
    let down = null, lastTouch = -Infinity;
    button.addEventListener('pointerdown', e => { down = {id: e.pointerId, x: e.clientX, y: e.clientY}; });
    button.addEventListener('pointercancel', () => { down = null; });
    button.addEventListener('pointerup', e => {
      if (e.pointerType === 'touch' && down?.id === e.pointerId && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12) {
        lastTouch = performance.now(); e.preventDefault(); action();
      }
      down = null;
    });
    button.addEventListener('click', e => {
      if (e.detail === 0 || performance.now() - lastTouch > 800) action();
    });
  }
  editorAction('.kt-save', () => finishEdit(true));
  editorAction('.kt-cancel', () => finishEdit(false));
  editorAction('.kt-reset', () => {
    cancelDrag(); layouts[layoutKey()] = {}; layoutStamp = ''; draw();
  });
  host.classList.toggle('kt-n64', n64);
  host.classList.toggle('kt-3ds', n3ds);
  host.classList.toggle('kt-psp', system === 'psp');
  $('.kt-cbuttons').hidden = !n64;
  // Labels reflect each console, rather than the standard gamepad's ABXY names.
  if (['nes', 'gb', 'gbc', 'gba', 'snes', 'nds'].includes(system)) {
    for (const [cid, label] of [[4,'B'],[5,'A'],[6,'Y'],[7,'X']]) $(`[data-cid="${cid}"]`).textContent = label;
    $('[data-cid="10"]').hidden = true;
    $('[data-cid="11"]').hidden = true;
  }
  if (['nes', 'gb', 'gbc', 'gba'].includes(system)) {
    $('[data-cid="6"]').hidden = true;
    $('[data-cid="7"]').hidden = true;
  }
  if (['nes', 'gb', 'gbc'].includes(system)) $('.kt-shoulders').hidden = true;
  if (system === 'genesis') {
    for (const [cid, label] of [[4,'B'],[5,'C'],[6,'A'],[8,'X'],[9,'Z'],[12,'Mode']]) $(`[data-cid="${cid}"]`).textContent = label;
    $('[data-cid="10"]').hidden = true;
    $('[data-cid="11"]').hidden = true;
    if (launchProps.pad3button === true) {
      for (const cid of [7, 8, 9, 12]) $(`[data-cid="${cid}"]`).hidden = true;
    }
  }
  if (n3ds) {
    for (const [cid, label] of [[4,'B'],[5,'A'],[6,'Y'],[7,'X'],[10,'ZL'],[11,'ZR']]) $(`[data-cid="${cid}"]`).textContent = label;
  }
  if (n64) {
    $('[data-cid="6"]').textContent = 'B';
    $('[data-cid="5"]').hidden = true;
    $('[data-cid="7"]').hidden = true;
    $('[data-cid="10"]').textContent = 'Z';
    $('[data-cid="11"]').hidden = true;
    $('[data-cid="12"]').hidden = true;
  }
  if (system === 'psx' || system === 'psp') {
    for (const [cid, label] of [[4,'✕'],[5,'○'],[6,'□'],[7,'△']]) $(`[data-cid="${cid}"]`).textContent = label;
    $('[data-cid="8"]').textContent = 'L1';
    $('[data-cid="9"]').textContent = 'R1';
    if (system === 'psp') {
      $('[data-cid="8"]').textContent = 'L';
      $('[data-cid="9"]').textContent = 'R';
      $('[data-cid="10"]').hidden = true;
      $('[data-cid="11"]').hidden = true;
    }
  }
  // Add hit surfaces after platform labels, which replace each button's content.
  // Near misses stay out of native game touch handling. Menu still needs a direct
  // tap, and editing keeps the exact visible bounds.
  for (const element of movable) {
    if (element.classList.contains('kt-menu')) continue;
    const area = document.createElement('b');
    area.className = 'kt-hit-area'; area.setAttribute('aria-hidden', 'true');
    element.append(area);
  }
  function clear() {
    if (editDrag) releaseInput(editDrag.pointer, true);
    const captured = [...pointers.keys()];
    pointers.clear(); touchPointers.clear(); held.clear(); axes.fill(0);
    for (const id of captured) if (pad.hasPointerCapture(id)) pad.releasePointerCapture(id);
    host.querySelectorAll('.kt-held').forEach(el => el.classList.remove('kt-held'));
    for (const element of directions) {
      element.querySelector('i').style.transform = '';
      element.querySelectorAll('span').forEach(arrow => arrow.classList.remove('kt-pressed'));
    }
  }
  function rebuild() {
    held.clear(); axes.fill(0);
    for (const value of pointers.values()) {
      if (value.cid !== undefined) held.add(value.cid);
      if (value.axis) axes[2 + value.axis[0]] = value.axis[1];
      if (value.direction) {
        const [x, y] = value.vector;
        if (value.direction.dataset.direction === 'digital') {
          if (x < 0) held.add(2);
          if (x > 0) held.add(3);
          if (y < 0) held.add(0);
          if (y > 0) held.add(1);
        } else {
          const index = Number(value.direction.dataset.stickIndex) * 2;
          axes[index] = x; axes[index + 1] = y;
        }
      }
    }
    host.querySelectorAll('[data-cid]').forEach(el => el.classList.toggle('kt-held', held.has(Number(el.dataset.cid))));
    host.querySelectorAll('[data-axis]').forEach(el => el.classList.toggle('kt-held',
      [...pointers.values()].some(value => value.target === el)));
    for (const element of directions) {
      const index = Number(element.dataset.stickIndex) * 2;
      element.querySelector('i').style.transform = `translate(${axes[index] * 24}px, ${axes[index + 1] * 24}px)`;
      element.querySelectorAll('span').forEach((arrow, i) => arrow.classList.toggle('kt-pressed',
        element.dataset.direction === 'digital' && held.has([0, 2, 3, 1][i])));
    }
  }
  function dockPosition() {
    const point = currentLayout().dock;
    return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) ?
      point : [dockSide === 'left' ? 0 : 1, .18 + 24 / innerHeight];
  }
  function drawDock() {
    const [x, y] = dockPosition();
    const left = x < .5;
    host.classList.toggle('kt-dock-left', left);
    tab.textContent = drawerOpen === left ? '‹' : '›';
    tab.setAttribute('aria-label', editing ? 'Drag settings tab to either edge' : 'Touch controller settings');
    $('.kt-close').textContent = left ? '‹ Close panel' : 'Close panel ›';
    // Keep the tab clear of the editor; allow the drawer to extend upward when
    // its handle has been placed near the bottom of the screen.
    const toolbarBottom = system === 'nds' ? document.querySelector('.touch-overlay-buttons')?.getBoundingClientRect().bottom || 0 : 0;
    const minimum = editing ? $('.kt-editor').getBoundingClientRect().bottom + 10 : Math.max(8, toolbarBottom + 10);
    const top = Math.max(minimum, Math.min(innerHeight - 56, y * innerHeight - 24));
    host.style.setProperty('--kt-dock-top', `${top}px`);
    drawer.style.marginTop = `${drawerOpen ? Math.min(0, innerHeight - 8 - top - drawer.offsetHeight) : 0}px`;
  }
  function draw() {
    toggle.setAttribute('aria-checked', String(enabled));
    toggle.querySelector('span').textContent = enabled ? 'Controls on' : 'Controls off';
    const wasHidden = pad.hidden;
    pad.hidden = drawerOpen || (!editing && (!enabled || !gameReady));
    $('.kt-editor').hidden = !editing || drawerOpen;
    drawDock();
    $('.kt-edit').disabled = !editing && !gameReady;
    $('.kt-edit').textContent = editing ? 'Continue editing' : 'Edit layout';
    dsScreens.hidden = system !== 'nds' || !gameReady || editing;
    n3dsScreens.hidden = system !== '3ds' || !gameReady || editing || !window.app?.emulator?.getViews;
    if (system === 'nds') {
      document.documentElement.classList.toggle('kt-ds-playing', gameReady && !editing && !drawerOpen);
    }
    const tabRect = tab.getBoundingClientRect();
    const stamp = `${innerWidth}:${innerHeight}:${layoutKey()}:${editing}:${tabRect.x}:${tabRect.y}:${tabRect.width}:${tabRect.height}`;
    if (!pad.hidden && (wasHidden || stamp !== layoutStamp)) { applyLayout(); layoutStamp = stamp; }
    host.classList.toggle('kt-enabled', enabled);
  }
  function setDrawer(open) {
    clear(); drawerOpen = open; drawer.hidden = !open;
    tab.setAttribute('aria-expanded', String(open));
    draw();
    if (open) cloud()?.syncControls?.();
  }
  toggle.addEventListener('click', () => {
    if (editing) finishEdit(false);
    clear(); enabled = !enabled;
    try { localStorage.setItem(KEY, String(enabled)); } catch (_) { /* Optional persistence. */ }
    saveControls({enabled});
    draw();
  });
  tab.addEventListener('click', () => {
    if (!dragged && !editing) setDrawer(!drawerOpen);
    dragged = false;
  });
  $('.kt-close').addEventListener('click', () => { setDrawer(false); tab.focus(); });
  host.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawerOpen) { e.stopPropagation(); setDrawer(false); tab.focus(); }
  });
  // During editing, drag the handle vertically and across to either edge.
  // It uses the same Save/Cancel/Reset transaction as the game buttons.
  let pullStart = null, dragged = false;
  tab.addEventListener('pointerdown', e => {
    if (editing) {
      if (editDrag) return;
      e.preventDefault();
      const key = layoutKey(), rect = tab.getBoundingClientRect();
      layouts[key] = {...currentLayout()};
      editDrag = {key, id: 'dock', previous: layouts[key].dock, pointer: e.pointerId,
        element: tab, x: e.clientX, y: e.clientY, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2};
      trackTouch(e);
    }
    pullStart = e.clientX; dragged = false; tab.setPointerCapture(e.pointerId);
  });
  tab.addEventListener('pointermove', e => {
    if (editDrag?.id !== 'dock' || editDrag.pointer !== e.pointerId) return;
    const d = editDrag;
    layouts[d.key].dock = [d.cx + e.clientX - d.x < innerWidth / 2 ? 0 : 1,
      Math.max(0, Math.min(1, (d.cy + e.clientY - d.y) / innerHeight))];
    dragged = true; draw();
  });
  tab.addEventListener('pointerup', e => {
    if (editing) {
      if (editDrag?.id === 'dock' && editDrag.pointer === e.pointerId) editDrag = null;
      dragged = true;
    } else if (pullStart !== null && Math.abs(e.clientX - pullStart) > 24) {
      dragged = true; setDrawer(dockPosition()[0] < .5 ? e.clientX > pullStart : e.clientX < pullStart);
    }
    pullStart = null;
  });
  for (const event of ['pointercancel', 'lostpointercapture']) {
    tab.addEventListener(event, e => {
      releaseInput(e.pointerId, true);
      pullStart = null;
    });
  }
  for (const event of ['touchstart', 'touchmove']) {
    tab.addEventListener(event, e => { if (editing && e.cancelable) e.preventDefault(); }, {passive: false});
  }
  $('.kt-menu').addEventListener('click', () => {
    if (editing) return;
    clear();
    const emulator = window.app?.emulator;
    touchPauseBlocked = false;
    if (emulator && emulator.pause(true)) {
      gameReady = false; draw();
      emulator.showPauseMenu();
    }
  });
  function position(e, target) {
    const r = hitAreas.find(area => area.element === target)?.rect || target.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width * 0.34);
    let y = (e.clientY - r.top - r.height / 2) / (r.height * 0.34);
    const length = Math.hypot(x, y);
    if (length < 0.10) return [0, 0];
    if (target.dataset.direction === 'digital') {
      // The same fixed-center angular regions apply to both presses and drags.
      // No relative origin or retained direction can turn a cardinal into a diagonal.
      const ax = Math.abs(x), ay = Math.abs(y);
      if (ay < ax * DPAD_DIAGONAL_SLOPE) return [Math.sign(x), 0];
      if (ax < ay * DPAD_DIAGONAL_SLOPE) return [0, Math.sign(y)];
      return [Math.sign(x), Math.sign(y)];
    }
    if (length > 1) { x /= length; y /= length; }
    return [x, y];
  }
  function directionInput(e, target) {
    return {direction: target, vector: position(e, target)};
  }
  function hitTarget(e, buttonsOnly = false) {
    let best = null, bestDistance = Infinity;
    for (const {element, rect: r, radius} of hitAreas) {
      const x = Math.abs(e.clientX - r.left - r.width / 2);
      const y = Math.abs(e.clientY - r.top - r.height / 2);
      // Never let a neighboring button's padding turn a Menu tap into input.
      if (element.classList.contains('kt-menu')) {
        if (x <= r.width / 2 && y <= r.height / 2) return null;
        continue;
      }
      if (buttonsOnly && element.dataset.direction) continue;
      // Signed distance from a rounded rectangle; circles use the same formula.
      const dx = x - r.width / 2 + radius, dy = y - r.height / 2 + radius;
      const distance = Math.hypot(Math.max(0, dx), Math.max(0, dy)) + Math.min(Math.max(dx, dy), 0) - radius;
      if (distance <= TOUCH_PADDING && distance < bestDistance) {
        best = element; bestDistance = distance;
      }
    }
    return best;
  }
  function buttonInput(target) {
    if (!target) return {target: null};
    return target.dataset.cid !== undefined ? {target, cid: Number(target.dataset.cid)} :
      {target, axis: target.dataset.axis.split(',').map(Number)};
  }
  pad.addEventListener('pointerdown', e => {
    if (editing && !drawerOpen) {
      const target = e.target.closest('[data-layout-id]');
      if (!target || editDrag) return;
      e.preventDefault(); target.setPointerCapture(e.pointerId);
      const rect = target.getBoundingClientRect();
      const key = layoutKey(), id = target.dataset.layoutId;
      layouts[key] = {...currentLayout()};
      editDrag = {key, id, previous: layouts[key][id], pointer: e.pointerId,
        element: target, x: e.clientX, y: e.clientY, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2};
      trackTouch(e);
      return;
    }
    if (!enabled || !gameReady || drawerOpen) return;
    const target = hitTarget(e);
    if (!target) return;
    e.preventDefault(); pad.setPointerCapture(e.pointerId);
    if (target.dataset.direction) {
      if (target.dataset.direction === 'analog' &&
          [...pointers.values()].some(value => value.direction === target)) return;
      pointers.set(e.pointerId, directionInput(e, target));
    }
    else pointers.set(e.pointerId, buttonInput(target));
    trackTouch(e);
    rebuild();
  });
  pad.addEventListener('pointermove', e => {
    if (editing) {
      if (editDrag?.pointer === e.pointerId) {
        const d = editDrag;
        layouts[d.key][d.id] = [(d.cx + e.clientX - d.x) / innerWidth, (d.cy + e.clientY - d.y) / innerHeight];
        applyLayout();
      }
      return;
    }
    const value = pointers.get(e.pointerId);
    if (value?.direction) { value.vector = position(e, value.direction); rebuild(); }
    else if (value) {
      // Slide between action buttons without lifting. Leaving their touch areas
      // releases input immediately; sliding back in presses again.
      const target = hitTarget(e, true);
      if (target !== value.target) { pointers.set(e.pointerId, buttonInput(target)); rebuild(); }
    }
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    pad.addEventListener(event, e => {
      releaseInput(e.pointerId, event !== 'pointerup');
    });
  }
  function trackTouch(e) {
    if (e.pointerType === 'touch') touchPointers.set(e.pointerId,
      {target: e.target, x: e.clientX, y: e.clientY, identifier: null});
  }
  function releaseInput(id, cancelled = false) {
    touchPointers.delete(id);
    if (editDrag?.pointer === id) {
      const element = editDrag.element;
      if (editDrag.id === 'dock') { pullStart = null; dragged = true; }
      if (cancelled) cancelDrag();
      else editDrag = null;
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    }
    if (!pointers.delete(id)) return;
    if (pad.hasPointerCapture(id)) pad.releasePointerCapture(id);
    rebuild();
  }
  // Releases can be retargeted outside the pad when browser UI interrupts a
  // gesture. Capture them before another element stops propagation.
  for (const event of ['pointerup', 'pointercancel']) {
    window.addEventListener(event, e => releaseInput(e.pointerId, event === 'pointercancel'), true);
  }
  // Touch IDs are not pointer IDs. Pair their initial target/position once,
  // before either finger can move, then reconcile by identity on each release.
  window.addEventListener('touchstart', e => {
    for (const touch of e.changedTouches) {
      const candidates = [...touchPointers.values()].filter(contact =>
        contact.identifier === null && contact.target === touch.target);
      candidates.sort((a, b) => Math.hypot(a.x - touch.clientX, a.y - touch.clientY) -
        Math.hypot(b.x - touch.clientX, b.y - touch.clientY));
      const contact = candidates[0];
      if (contact && Math.hypot(contact.x - touch.clientX, contact.y - touch.clientY) < 2)
        contact.identifier = touch.identifier;
    }
  }, {capture: true, passive: true});
  for (const event of ['touchend', 'touchcancel']) {
    window.addEventListener(event, e => {
      const active = new Set(Array.from(e.touches, touch => touch.identifier));
      for (const [id, contact] of [...touchPointers]) {
        if (!active.size || (contact.identifier !== null && !active.has(contact.identifier)))
          releaseInput(id, event === 'touchcancel');
      }
    }, {capture: true, passive: true});
  }
  // Safari can show its selection loupe after tap-and-hold even with user-select
  // and touch-callout disabled. Cancel native touch gestures on pointer-driven
  // controls. Leave Menu's native click and the drawer's slider/taps available.
  for (const event of ['touchstart', 'touchmove']) {
    pad.addEventListener(event, e => {
      if (e.target.closest('[data-cid], [data-axis], [data-direction]') ||
          (editing && e.target.closest('[data-layout-id]'))) {
        if (e.cancelable) e.preventDefault();
      }
    }, {passive: false});
  }
  // webRcade pauses on document touchend. Controls must not trigger that listener.
  for (const event of ['touchstart','touchmove','touchend','touchcancel','pointerdown','pointerup','mousedown','mouseup','click']) {
    host.addEventListener(event, e => e.stopPropagation());
  }
  host.addEventListener('contextmenu', e => e.preventDefault());
  host.addEventListener('selectstart', e => e.preventDefault());
  // Suppress only the emulator's tap-to-pause side effect. Keep the event alive
  // for native game touchscreens (DS) and for touch navigation in pause menus.
  document.addEventListener('touchend', e => {
    touchPauseBlocked = !host.contains(e.target) && Boolean(window.app?.emulator?.started) &&
      !window.app.isPauseScreen() && !window.app.isShowOverlay();
    clearTimeout(touchPauseTimer);
    touchPauseTimer = setTimeout(() => { touchPauseBlocked = false; }, 0);
  }, true);
  window.addEventListener('blur', clear);
  window.addEventListener('pagehide', clear);
  function resizeLayout() { clear(); layoutStamp = ''; draw(); }
  window.addEventListener('resize', resizeLayout);
  window.visualViewport?.addEventListener('resize', resizeLayout);
  document.addEventListener('visibilitychange', clear);
  function refreshPreferences() {
    if (editing) return; // Keep unsaved drags intact until Save or Cancel.
    const previousDSView = dsView;
    try {
      enabled = localStorage.getItem(KEY) !== 'false';
      muted = localStorage.getItem(MUTE_KEY) === 'true';
      dockSide = parseDockSide(localStorage.getItem(DOCK_SIDE_KEY));
      dsView = parseDSView(localStorage.getItem(DS_VIEW_KEY));
      translucence = parseTranslucence(localStorage.getItem(TRANSLUCENCE_KEY));
      layouts = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
    } catch (_) { return; }
    if (dsView !== previousDSView) applyDSView(window.app?.emulator, dsView);
    if (system === '3ds' && window.app?.emulator?.setView) {
      // A view chosen on another device arrives through the synced settings.
      let view = null;
      try { view = localStorage.getItem(N3DS_VIEW_KEY); } catch (_) { /* keep the current one */ }
      if (view) { window.app.emulator.setView(view); update3DSLabel(window.app.emulator); }
    }
    applyMute(); drawMute(); clear(); layoutStamp = ''; drawTranslucence(); draw();
  }
  window.addEventListener('wrcad:controls-loaded', refreshPreferences);
  window.addEventListener('storage', e => {
    if ([KEY, MUTE_KEY, DS_VIEW_KEY, N3DS_VIEW_KEY, DOCK_SIDE_KEY, TRANSLUCENCE_KEY, LAYOUT_KEY].includes(e.key)) refreshPreferences();
  });
  document.addEventListener('fullscreenchange', () => {
    clear();
    const target = document.fullscreenElement;
    if (!target || !['CANVAS','VIDEO','IFRAME'].includes(target.tagName)) (target || document.body).append(host);
    layoutStamp = ''; draw();
  });
  function attach() {
    const emulator = window.app?.emulator;
    if (system === 'nds') {
      if (emulator?.started) {
        if (dsEmulator !== emulator) {
          dsEmulator = emulator;
          const resize = emulator.updateScreenSize;
          emulator.updateScreenSize = function(...args) {
            const result = resize.apply(this, args); alignDSScreens(this); return result;
          };
          applyDSView(emulator, dsView);
          emulator.updateScreenSize();
          // As for the 3DS below, but with the DS's own element and observer:
          // the safe area can change without a window resize.
          if (!dsObserver && window.ResizeObserver) {
            dsObserver = new ResizeObserver(() => {
              if (dsEmulator?.started) { layoutStamp = ''; draw(); dsEmulator.updateScreenSize(); }
            });
            dsObserver.observe(dsOrigin);
          }
        }
        updateDSLabel(emulator);
      }
    }
    if (n3ds && emulator?.started && n3dsEmulator !== emulator) {
      // Portrait phones: move the stacked screens to the top, clear of the controls.
      n3dsEmulator = emulator;
      const resize = emulator.updateScreenSize;
      emulator.updateScreenSize = function(...args) {
        const result = resize.apply(this, args); align3DSScreens(this); return result;
      };
      emulator.updateScreenSize();
      if (emulator.getViews) update3DSLabel(emulator);
      // The placement is computed in pixels from the safe area. That area also
      // changes without a window resize (browser toolbars sliding away after
      // the page has loaded, the notch side after a rotation); place again
      // whenever it does, or the screens keep the size of an earlier moment.
      if (!n3dsObserver && window.ResizeObserver) {
        n3dsObserver = new ResizeObserver(() => {
          if (n3dsEmulator?.started) { layoutStamp = ''; draw(); n3dsEmulator.updateScreenSize(); }
        });
        n3dsObserver.observe(n3dsOrigin);
      }
    }
    const analog = system === 'psx' && Boolean(emulator?.analogMode);
    if (analog !== psxAnalog) {
      clear(); psxAnalog = analog;
      host.classList.toggle('kt-dualshock', analog);
      for (const element of psxSticks) element.hidden = !analog;
      layoutStamp = '';
    }
    if (emulator && !patchedEmulators.has(emulator)) {
      patchedEmulators.add(emulator);
      const originalPause = emulator.pause;
      emulator.pause = function(paused, ...args) {
        if (paused && touchPauseBlocked && !editing) return false;
        return originalPause.call(this, paused, ...args);
      };
    }
    if (editing && emulator !== editEmulator) finishEdit(false);
    if (editing && emulator && !emulator.paused) emulator.pause(true);
    // DS re-enables its stylus every frame, even while the native menu is open.
    // Gate that setter so its preventDefault cannot swallow menu-button taps.
    const touch = emulator?.touch;
    if (touch?.setTouchEnabled && !patchedTouches.has(touch)) {
      patchedTouches.add(touch);
      const originalSetTouch = touch.setTouchEnabled;
      touch.setTouchEnabled = function(value) {
        originalSetTouch.call(this, value && !emulator.paused && !window.app.isPauseScreen());
      };
      touch.setTouchEnabled(touch.touchEnabled);
    }
    const controller = emulator?.controllers?.getController(0);
    const ready = Boolean(controller && emulator.started && !emulator.paused && !document.hidden && !window.app.isShowOverlay());
    // The launched same-origin game frame supplies its own controls.
    const framed = Boolean(document.getElementById('webrcade-app-iframe'));
    // Layout editing intentionally pauses the emulator. Keep its toolbar and
    // dock usable until Save/Cancel, while hiding controls on native pause screens.
    host.hidden = framed || !(ready || (editing && emulator === editEmulator));
    if (host.hidden && drawerOpen) setDrawer(false);
    if (ready !== gameReady || controller !== activeController || framed) clear();
    activeController = controller; gameReady = ready;
    if (controller && !patched.has(controller)) {
      patched.add(controller);
      for (const method of ['isControlDown', 'isPadButtonDown']) {
        const original = controller[method];
        controller[method] = function(cid, analogToDigital = true) {
          const touch = !editing && enabled && gameReady && !drawerOpen && held.has(cid);
          return touch || original.call(this, cid, analogToDigital);
        };
      }
      const originalAxis = controller.getAxisValue;
      controller.getAxisValue = function(index, isX) {
        const value = axes[index * 2 + (isX ? 0 : 1)] || 0;
        return enabled && gameReady && !drawerOpen && value ? value : originalAxis.call(this, index, isX);
      };
      for (const [method, isX, sign] of [['isAxisLeft',true,-1],['isAxisRight',true,1],['isAxisUp',false,-1],['isAxisDown',false,1]]) {
        const original = controller[method];
        controller[method] = function(index) {
          return (enabled && gameReady && !drawerOpen && axes[index * 2 + (isX ? 0 : 1)] * sign > 0.5) || original.call(this,index);
        };
      }
    }
    draw();
  }
  attach();
  setInterval(attach, 150);
})();
