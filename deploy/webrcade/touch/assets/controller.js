/* Mobile overlay for the pinned webRcade 0.2.3 controller interface. */
(() => {
  'use strict';
  const prefix = window.WrcadCloudConfig?.storagePrefix || 'webrcade';
  // A touch-capable desktop using a mouse still uses the desktop interface.
  const touchDevice = matchMedia('(pointer: coarse)').matches;
  const wiiPage = location.pathname.startsWith('/experimental/wii/') || document.documentElement.dataset.cloudrcadeCore === 'wii';
  const gamecubePage = location.pathname.startsWith('/experimental/gamecube/') || document.documentElement.dataset.cloudrcadeCore === 'gamecube';
  if (!touchDevice) return;
  const KEY = prefix + '.touch.enabled.v1';
  // Device-local: a phone with a gamepad may still need the touch layout.
  // Keep this separate from the existing synced controls preference.
  const GAMEPAD_TOUCH_KEY = prefix + '.touch.gamepad-touch.v1';
  let gamepadTouch = false, gamepadConnected = false, presentedGamepadConnected = false, presentedGamepadMode = false;
  try { gamepadTouch = localStorage.getItem(GAMEPAD_TOUCH_KEY) === 'true'; } catch (_) {}
  const gamepadMode = () => presentedGamepadMode;
  const touchEnabled = () => presentedGamepadConnected ? !gamepadMode() : enabled;
  const MUTE_KEY = prefix + '.touch.muted.v1';
  const DS_VIEW_KEY = prefix + '.touch.ds-view.v1';
  // Device-local: automatic expanded-window presentation must not replace the
  // player's synced DS/3DS view or button coordinates on other devices.
  const SECTIONS_KEY = prefix + '.touch.screen-sections.v1';
  let automaticSections = true;
  try { automaticSections = localStorage.getItem(SECTIONS_KEY) !== 'false'; } catch (_) {}
  const FOLD_KEY = prefix + '.touch.fold-alignment.v1';
  const FOLD_GAP_KEY = prefix + '.touch.fold-gap.v1';
  let foldAlignment = {};
  try { foldAlignment = JSON.parse(localStorage.getItem(FOLD_KEY)) || {}; } catch (_) {}
  let foldGap = 40; // Conservative clearance, not a claimed hardware dimension.
  try { foldGap = Math.max(16, Math.min(160, Number(localStorage.getItem(FOLD_GAP_KEY)) || 40)); } catch (_) {}
  const foldOffset = mode => Math.max(-15, Math.min(15, Number(foldAlignment?.[mode]) || 0));
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
  let audioSessionRecoveryNeeded = true, audioSessionTimer = null;
  function applyAudioSession(recover = false) {
    try {
      const session = navigator.audioSession;
      if (!session) return;
      if (audioSessionTimer !== null) {
        if (!muted) return; // Coalesce context/focus events into one reset.
        clearTimeout(audioSessionTimer); audioSessionTimer = null;
      }
      // Safari can retain the JS "playback" value after losing the native
      // category. An unchanged assignment is ignored; cross a task boundary
      // with a different category to restore actual media playback.
      if (!muted && recover && session.type === 'playback') {
        session.type = 'ambient';
        audioSessionTimer = setTimeout(() => {
          audioSessionTimer = null; applyAudioSession();
        }, 0);
      } else session.type = muted ? 'ambient' : 'playback';
    } catch (_) { /* Older browsers or unavailable audio-session control. */ }
  }
  function recoverAudioSession() {
    if (muted || !audioSessionRecoveryNeeded || document.hidden ||
        ![...audioGates.keys()].some(context => context.state === 'running')) return;
    audioSessionRecoveryNeeded = false; applyAudioSession(true);
  }
  function foregroundAudio() {
    audioSessionRecoveryNeeded = true; recoverAudioSession();
  }
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
            else if (context.state === 'running') foregroundAudio();
          });
          foregroundAudio();
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
    // Unmuted games use media playback so iOS's silent switch does not mute
    // them. Muted games release exclusive playback while gain keeps audio off.
    applyAudioSession();
    for (const gate of audioGates.values()) gate.gain.value = muted ? 0 : 1;
    audioSessionRecoveryNeeded = true; recoverAudioSession();
  }
  applyMute();
  window.addEventListener('focus', foregroundAudio);
  window.addEventListener('pageshow', foregroundAudio);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) foregroundAudio();
  });
  // This does not resume a suspended core or change its audio clock. The
  // core's own gesture/resume path will trigger the statechange above.
  document.addEventListener('pointerdown', recoverAudioSession, true);
  document.addEventListener('keydown', recoverAudioSession, true);
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
        <button class="kt-toggle kt-gamepad-touch" aria-pressed="true">Touch controls: On</button>
        <button class="kt-mute kt-switch" role="switch" aria-checked="false"><i></i><span>Mute audio</span></button>
        <button class="kt-edit" disabled>Edit layout</button>
        <button class="kt-sections-toggle" aria-pressed="true" hidden>Screen sections: Auto</button>
        <div class="kt-fold-position" hidden>
          <label for="kt-fold-alignment">Fold alignment</label><output for="kt-fold-alignment">0%</output>
          <input id="kt-fold-alignment" type="range" min="-15" max="15" step="0.1" value="0">
          <label for="kt-fold-gap">Fold gap</label><output class="kt-fold-gap-value" for="kt-fold-gap">40px</output>
          <input id="kt-fold-gap" type="range" min="16" max="160" step="2" value="40">
          <button class="kt-fold-reset">Reset fold alignment</button>
        </div>
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
    <div class="kt-fold-guide" aria-hidden="true" hidden></div>
    <div class="kt-pad" aria-label="Touch game controller" hidden>
      <div class="kt-shoulders"><button data-cid="8">L</button><button data-cid="10">L2</button><button data-cid="11">R2</button><button data-cid="9">R</button></div>
      <div class="kt-stick" role="group" aria-label="Directional pad: drag in any direction"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><i></i></div>
      <div class="kt-center"><button data-cid="12">Select</button><button class="kt-ds-mic" data-layout-id="microphone" aria-label="Hold microphone" hidden>Mic</button><button class="kt-menu">Menu</button><button data-cid="13">Start</button></div>
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
  let sectionMicOn = false;
  function setSectionMic(value) {
    if (value === sectionMicOn) return;
    sectionMicOn = value; window.app?.emulator?.setMicrophoneOn?.(value);
    $('.kt-ds-mic').classList.toggle('kt-held', value);
  }
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
    ps2: ['ps2', 'play-ps2'],
    gamecube: ['gamecube', 'retro-dolphin'],
    wii: ['wii', 'retro-dolphin-wii'],
  };
  const core = launchProps?.type || emulatorPath;
  const ps2Page = document.documentElement.dataset.cloudrcadeCore === 'ps2';
  const system = Object.keys(platformCores).find(platform => platformCores[platform].includes(core)) || (wiiPage ? 'wii' : ps2Page ? 'ps2' : gamecubePage ? 'gamecube' : emulatorPath);
  const wii = system === 'wii' || wiiPage;
  const gamecube = system === 'gamecube' || gamecubePage;
  const dolphin = gamecube || wii;
  if (dolphin) {
    if (!touchDevice) for (const element of [toggle,$('.kt-edit'),$('.kt-translucence')]) element.hidden = true;
  }
  document.documentElement.classList.toggle('kt-ds-active', system === 'nds');
  document.documentElement.classList.toggle('kt-psx-active', system === 'psx');
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
  const sectionsToggle = $('.kt-sections-toggle');
  let sectionState = null;
  // Both pinned frontends present their combined core texture with one final
  // triangle-strip quad. Reuse that draw twice, with viewport/scissor crops in
  // the same context. No framebuffer readback, copy, extra canvas or GL context.
  if (['nds', '3ds'].includes(system)) {
    const contexts = new WeakMap();
    const prototypes = [...new Set([window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype].filter(Boolean))];
    const originals = prototypes.map(prototype => ({prototype,
      native: Object.fromEntries(['bindFramebuffer','viewport','scissor','enable','disable','clearColor','clear','drawArrays'].map(name => [name, prototype[name]]))}));
    for (const {prototype, native} of originals) {
      function state(gl) {
        if (gl.canvas !== window.app?.emulator?.canvas) return null;
        let value = contexts.get(gl);
        if (!value) {
          if (gl.isContextLost()) return null;
          value = {framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING),
            viewport: gl.getParameter(gl.VIEWPORT), scissor: gl.getParameter(gl.SCISSOR_BOX),
            scissorEnabled: gl.isEnabled(gl.SCISSOR_TEST), color: gl.getParameter(gl.COLOR_CLEAR_VALUE)};
          contexts.set(gl, value);
          gl.canvas.addEventListener('webglcontextlost', () => { value.lost = true; });
          gl.canvas.addEventListener('webglcontextrestored', () => contexts.delete(gl));
        }
        return value;
      }
      prototype.bindFramebuffer = function(target, framebuffer) {
        const value = state(this);
        if (value && (target === this.FRAMEBUFFER || target === this.DRAW_FRAMEBUFFER)) value.framebuffer = framebuffer;
        return native.bindFramebuffer.call(this, target, framebuffer);
      };
      for (const name of ['viewport', 'scissor', 'clearColor']) prototype[name] = function(x, y, width, height) {
        const value = state(this), values = value?.[name === 'clearColor' ? 'color' : name];
        if (values) { values[0] = x; values[1] = y; values[2] = width; values[3] = height; }
        return native[name].call(this, x, y, width, height);
      };
      for (const name of ['enable', 'disable']) prototype[name] = function(capability) {
        const value = state(this);
        if (value && capability === this.SCISSOR_TEST) value.scissorEnabled = name === 'enable';
        return native[name].call(this, capability);
      };
      prototype.drawArrays = function(mode, first, count) {
        const value = state(this), presentation = sectionState?.presentation;
        if (!value || value.lost || value.framebuffer || !presentation || mode !== this.TRIANGLE_STRIP || first !== 0 || count !== 4)
          return native.drawArrays.call(this, mode, first, count);
        const {viewport, scissor, scissorEnabled, color} = value, {canvas, destinations, sources} = presentation;
        const scaleX = this.drawingBufferWidth / canvas.width, scaleY = this.drawingBufferHeight / canvas.height;
        // RetroArch normalizes pointer input through this native viewport,
        // including its own letterboxing. DS instead uses its DOM touch rect.
        if (system === '3ds') sectionState.inputViewport = {left: viewport[0] / scaleX,
          top: (this.drawingBufferHeight - viewport[1] - viewport[3]) / scaleY,
          width: viewport[2] / scaleX, height: viewport[3] / scaleY};
        // Clear the unused pane space, then restore every native GL state we
        // temporarily change. RetroArch's own GL cache remains authoritative.
        native.disable.call(this, this.SCISSOR_TEST);
        native.clearColor.call(this, 0, 0, 0, 1);
        native.clear.call(this, this.COLOR_BUFFER_BIT);
        native.clearColor.call(this, ...color);
        native.enable.call(this, this.SCISSOR_TEST);
        try {
          for (let i = 0; i < 2; i++) {
            const source = sources[i], target = destinations[i];
            const width = target.width / source.width, height = target.height / source.height;
            const left = target.left - canvas.left - source.left * width;
            const top = target.top - canvas.top - source.top * height;
            const vx = Math.round(left * scaleX), vy = Math.round((canvas.height - top - height) * scaleY);
            const vw = Math.round(width * scaleX), vh = Math.round(height * scaleY);
            native.viewport.call(this, vx, vy, vw, vh);
            // Integer viewports must not sample a neighboring screen's edge.
            const sx = Math.max(Math.round((target.left - canvas.left) * scaleX), Math.ceil(vx + source.left * vw));
            const sy = Math.max(Math.round((canvas.bottom - target.bottom) * scaleY), Math.ceil(vy + (1 - source.top - source.height) * vh));
            const right = Math.min(Math.round((target.right - canvas.left) * scaleX), Math.floor(vx + (source.left + source.width) * vw));
            const upper = Math.min(Math.round((canvas.bottom - target.top) * scaleY), Math.floor(vy + (1 - source.top) * vh));
            native.scissor.call(this, sx, sy, Math.max(0, right - sx), Math.max(0, upper - sy));
            native.drawArrays.call(this, mode, first, count);
          }
        } finally {
          native.viewport.call(this, ...viewport); native.scissor.call(this, ...scissor);
          native[scissorEnabled ? 'enable' : 'disable'].call(this, this.SCISSOR_TEST);
        }
      };
    }
    // Translate only native-canvas gestures back to its original combined
    // image. The native DS/3DS stylus path still owns presses and releases.
    const touches = new Set();
    let mouseDown = false;
    function mapPoint(x, y) {
      const p = sectionState.presentation, target = p.destinations[1], source = p.inputSource;
      const nx = Math.max(0, Math.min(1, (x - target.left) / target.width));
      const ny = Math.max(0, Math.min(1, (y - target.top) / target.height));
      const area = system === '3ds' && sectionState.inputViewport || {left: 0, top: 0, width: p.canvas.width, height: p.canvas.height};
      return {x: p.canvas.left + area.left + (source.left + nx * source.width) * area.width,
        y: p.canvas.top + area.top + (source.top + ny * source.height) * area.height};
    }
    const insideTouchscreen = (x, y) => {
      const r = sectionState.presentation.destinations[1];
      return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    for (const type of ['mousedown','mousemove','mouseup','touchstart','touchmove','touchend','touchcancel']) window.addEventListener(type, event => {
      if (!sectionState?.presentation || window.app?.isShowOverlay?.() || window.app?.isPauseScreen?.()) { touches.clear(); mouseDown = false; return; }
      const canvas = sectionState.emulator.canvas;
      if (event.target !== canvas) return;
      if (type.startsWith('touch')) {
        for (const touch of event.changedTouches) if (type === 'touchstart' && insideTouchscreen(touch.clientX, touch.clientY)) touches.add(touch.identifier);
        const accepted = [...event.changedTouches].some(touch => touches.has(touch.identifier));
        if (!accepted) { event.preventDefault(); event.stopImmediatePropagation(); return; }
        // DS converts raw touches to MouseEvents itself; map those events once.
        if (system === '3ds') for (const name of ['touches','targetTouches','changedTouches']) {
          const points = [...event[name]].filter(touch => touches.has(touch.identifier)).map(touch => {
            const point = mapPoint(touch.clientX, touch.clientY);
            return new Proxy(touch, {get(target, key) {
              if (['clientX','pageX','screenX'].includes(key)) return point.x + (key === 'pageX' ? scrollX : 0);
              if (['clientY','pageY','screenY'].includes(key)) return point.y + (key === 'pageY' ? scrollY : 0);
              return Reflect.get(target, key, target);
            }});
          });
          points.item = index => points[index] || null;
          Object.defineProperty(event, name, {value: points});
        }
        if (type === 'touchend' || type === 'touchcancel') for (const touch of event.changedTouches) touches.delete(touch.identifier);
      } else {
        if (type === 'mousedown') mouseDown = insideTouchscreen(event.clientX, event.clientY);
        if (!mouseDown && !insideTouchscreen(event.clientX, event.clientY)) { event.stopImmediatePropagation(); return; }
        const point = mapPoint(event.clientX, event.clientY), rect = canvas.getBoundingClientRect();
        for (const [name, value] of Object.entries({clientX: point.x, clientY: point.y,
          pageX: point.x + scrollX, pageY: point.y + scrollY, offsetX: point.x - rect.left, offsetY: point.y - rect.top})) Object.defineProperty(event, name, {value});
        if (type === 'mouseup') mouseDown = false;
      }
    }, {capture: true, passive: false});
  }
  const sectionViews = {stacked: ['default', 'Top'], side: ['side_by_side', 'Top'],
    top: ['single_screen', 'Top'], touch: ['single_screen', 'Bottom']};
  function setNative3DSView(emulator, id) {
    const view = sectionViews[id];
    if (!view) return;
    // useView changes only presentation. The public setView also persists the
    // choice; automatic rotation must leave that saved choice alone.
    emulator.useView(id);
    sectionState.setVariable('citra_layout_option', view[0]);
    sectionState.setVariable('citra_swap_screen', view[1]);
  }
  function syncScreenSections(emulator) {
    if (!['nds', '3ds'].includes(system) || !emulator?.started || !emulator.canvas) return;
    if (sectionState?.emulator !== emulator) {
      if (system === '3ds' && (!emulator.useView || !window.Module?.cwrap)) return;
      const state = sectionState = {emulator, mode: null};
      if (system === 'nds') {
        const getLayout = emulator.getScreenLayout;
        emulator.getScreenLayout = function(...args) {
          return state.mode ? (state.mode === 'stacked' ? 0 : 2) : getLayout.apply(this, args);
        };
        state.setBook = emulator.setBookMode || function(value) { this.bookMode = value; };
        emulator.setBookMode = function(value) {
          if (state.mode) state.book = value;
          return state.setBook.call(this, state.mode ? false : value);
        };
      } else {
        state.setVariable = window.Module.cwrap('ejs_set_variable', null, ['string', 'string']);
        const setView = emulator.setView;
        emulator.setView = function(id, ...args) {
          if (state.mode && sectionViews[id]) {
            // An explicit choice equal to the automatic view still needs the
            // native setter's persistence; compare it with the saved view.
            const previous = state.savedView;
            state.savedView = id;
            if (id === this.getView() && id !== previous) this.useView(previous);
          }
          return setView.call(this, id, ...args);
        };
      }
    }
    const bounds = visibleViewport(), state = sectionState;
    const mode = automaticSections && !gamepadMode() && bounds.width >= 600 && bounds.height >= 550 ?
      (bounds.width > bounds.height ? 'side' : 'stacked') : null;
    const previous = state.mode;
    if (mode && !previous) {
      state.savedView = emulator.getView?.(); state.book = emulator.bookMode;
      state.canvasStyle = Object.fromEntries(['position','transform','width','height','max-width','max-height','left','top'].map(name =>
        [name, [emulator.canvas.style.getPropertyValue(name), emulator.canvas.style.getPropertyPriority(name)]]));
    }
    state.mode = mode;
    if (previous !== mode) state.presentation = null;
    host.classList.toggle('kt-sections', Boolean(mode));
    document.documentElement.classList.toggle('kt-ds-sections', system === 'nds' && Boolean(mode));
    host.dataset.screenSections = mode || '';
    if (!mode) {
      if (previous) for (const [name, [value, priority]] of Object.entries(state.canvasStyle)) {
        if (value) emulator.canvas.style.setProperty(name, value, priority);
        else emulator.canvas.style.removeProperty(name);
      }
      for (const name of ['left','top','right','bottom','width','height','margin']) pad.style.removeProperty(name);
      delete host.dataset.sectionControls; delete host.dataset.screenRects;
      document.documentElement.style.removeProperty('--kt-section-controls-top');
    }
    const changed = previous !== mode;
    if (system === 'nds') {
      if (changed) {
        state.setBook.call(emulator, mode ? false : state.book);
        emulator.updateScreenLayout?.(false);
      }
    } else if (changed || mode && emulator.getView() !== mode) {
      setNative3DSView(emulator, mode || state.savedView);
      emulator.updateScreenSize();
    }
    if (changed) { clear(); layoutStamp = ''; }
  }
  function chooseAutomaticSections(value) {
    automaticSections = value;
    try { localStorage.setItem(SECTIONS_KEY, String(value)); } catch (_) {}
    clear(); layoutStamp = ''; draw();
    window.app?.emulator?.updateScreenSize?.();
  }
  sectionsToggle.addEventListener('click', () => chooseAutomaticSections(!automaticSections));
  const foldSlider = $('#kt-fold-alignment'), foldGuide = $('.kt-fold-guide');
  const foldGapSlider = $('#kt-fold-gap');
  function changeFold(value) {
    if (!sectionState?.mode) return;
    foldAlignment = {...foldAlignment, [sectionState.mode]: Number(value)};
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(foldAlignment)); } catch (_) {}
    clear(); layoutStamp = ''; draw();
  }
  foldSlider.addEventListener('input', e => { foldGuide.hidden = false; changeFold(e.target.value); });
  foldSlider.addEventListener('focus', () => { foldGuide.hidden = false; });
  foldSlider.addEventListener('blur', () => { foldGuide.hidden = true; });
  for (const event of ['keydown', 'keyup']) foldSlider.addEventListener(event, e => { if (e.key !== 'Escape') e.stopPropagation(); });
  $('.kt-fold-reset').addEventListener('click', () => changeFold(0));
  foldGapSlider.addEventListener('input', event => {
    foldGap = Number(event.target.value);
    try { localStorage.setItem(FOLD_GAP_KEY, String(foldGap)); } catch (_) {}
    foldGuide.hidden = false; clear(); layoutStamp = ''; draw();
  });
  foldGapSlider.addEventListener('focus', () => { foldGuide.hidden = false; });
  foldGapSlider.addEventListener('blur', () => { foldGuide.hidden = true; });
  for (const event of ['keydown', 'keyup']) foldGapSlider.addEventListener(event, e => { if (e.key !== 'Escape') e.stopPropagation(); });
  function sectionFold(visible) {
    const stacked = sectionState.mode === 'stacked';
    let split = stacked ? visible.top + visible.height / 2 : visible.left + visible.width / 2;
    let reportedGap = 0, reportedStart = null, reportedEnd = null;
    // Segment coordinates belong to the outer window, not necessarily this
    // game iframe. Translate them before placing the native screen boundary.
    try {
      let outer = window, x = 0, y = 0;
      while (outer !== outer.top && outer.frameElement) {
        const frame = outer.frameElement, rect = frame.getBoundingClientRect();
        x += rect.left + frame.clientLeft; y += rect.top + frame.clientTop; outer = outer.parent;
      }
      const segments = outer.viewport?.segments || outer.visualViewport?.segments;
      const ordered = segments?.length === 2 ? [...segments].sort((a, b) => stacked ? a.top - b.top : a.left - b.left) : [];
      if (ordered.length && (stacked ? ordered[0].bottom <= ordered[1].top : ordered[0].right <= ordered[1].left)) {
        reportedGap = stacked ? ordered[1].top - ordered[0].bottom : ordered[1].left - ordered[0].right;
        reportedStart = stacked ? ordered[0].bottom - y : ordered[0].right - x;
        reportedEnd = stacked ? ordered[1].top - y : ordered[1].left - x;
        split = stacked ? (ordered[0].bottom + ordered[1].top) / 2 - y :
          (ordered[0].right + ordered[1].left) / 2 - x;
      } else if (outer.document.documentElement.hasAttribute('data-cr-status-top') &&
          (outer.navigator.standalone || outer.matchMedia('(display-mode: standalone)').matches) && !outer.document.fullscreenElement) {
        // Opaque installed-app status areas are outside innerHeight. Center
        // on the physical display, then translate back into content space.
        // Screen can retain its natural (wide) orientation while the installed
        // window is portrait. Match its width before using its physical height.
        const physicalHeight = Math.abs(outer.screen.width - outer.innerWidth) < 1 ? outer.screen.height :
          Math.abs(outer.screen.height - outer.innerWidth) < 1 ? outer.screen.width : 0;
        const excluded = physicalHeight - outer.innerHeight;
        if (stacked && physicalHeight && excluded > 0 && excluded <= 100)
          split = physicalHeight / 2 - excluded - y;
      }
    } catch (_) { /* Older/cross-origin browsers retain the visible midpoint. */ }
    split += foldOffset(sectionState.mode) / 100 * (stacked ? visible.height : visible.width);
    const start = Math.min(split - foldGap / 2, reportedStart ?? Infinity);
    const end = Math.max(split + foldGap / 2, reportedEnd ?? -Infinity);
    return {center: split, start, end, gap: end - start, reportedGap};
  }
  const sectionSplit = visible => sectionFold(visible).center;
  function sectionBounds(origin) {
    const safe = origin.getBoundingClientRect(), visible = visibleViewport();
    return {left: Math.max(safe.left, visible.left) + 12,
      right: Math.min(safe.right, visible.right) - 12,
      top: Math.max(safe.top, visible.top) + 12,
      bottom: Math.min(safe.bottom, visible.bottom) - 12, visible};
  }
  function alignScreenSections(emulator, origin) {
    if (!sectionState?.mode || sectionState.emulator !== emulator) return false;
    const bounds = sectionBounds(origin), {visible} = bounds;
    const stacked = sectionState.mode === 'stacked', fold = sectionFold(visible);
    const rectangle = (left, top, right, bottom) => ({left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top)});
    const upper = rectangle(bounds.left, bounds.top, stacked ? bounds.right : fold.start, stacked ? fold.start : bounds.bottom);
    const lower = rectangle(stacked ? bounds.left : fold.end, stacked ? fold.end : bounds.top, bounds.right, bounds.bottom);
    const rails = lower.width >= 576 && lower.height >= (system === '3ds' ? 386 : 286);
    const wide = lower.width >= 576;
    const controlsHeight = Math.min(lower.height, rails ? lower.height : system === '3ds' && !wide ? 370 : 244);
    const controls = rectangle(lower.left + 14, rails ? lower.top + 12 : lower.bottom - controlsHeight, lower.right - 14, lower.bottom);
    const picture = rails ? rectangle(lower.left + 170, lower.top, lower.right - 170, lower.bottom - 64) :
      rectangle(lower.left, lower.top, lower.right, Math.max(lower.top, controls.top - 12));
    const fit = (area, ratio) => {
      const width = Math.min(area.width, area.height * ratio), height = width / ratio;
      return rectangle((area.left + area.right - width) / 2, (area.top + area.bottom - height) / 2,
        (area.left + area.right + width) / 2, (area.top + area.bottom + height) / 2);
    };
    const ratio = emulator.getDefaultAspectRatio();
    if (!(ratio > 0) || system === 'nds' && (stacked ? ratio > 1 : ratio < 2)) return true;
    const sources = system === '3ds' ? (stacked ?
      [{left: 0, top: 0, width: 1, height: .5}, {left: .1, top: .5, width: .8, height: .5}] :
      [{left: 0, top: 0, width: 400 / 720, height: 1}, {left: 400 / 720, top: 0, width: 320 / 720, height: 1}]) :
      (stacked ? [{left: 0, top: 0, width: 1, height: ratio * .75}, {left: 0, top: 1 - ratio * .75, width: 1, height: ratio * .75}] :
        [{left: 0, top: 0, width: (4 / 3) / ratio, height: 1}, {left: 1 - (4 / 3) / ratio, top: 0, width: (4 / 3) / ratio, height: 1}]);
    const destinations = [fit(upper, system === '3ds' ? 5 / 3 : 4 / 3), fit(picture, 4 / 3)];
    // The pinned DS mouse handler treats horizontal screens as equal halves,
    // even when its native image includes a gap. Keep that input ABI intact.
    const inputSource = system === 'nds' && !stacked ? {left: .5, top: 0, width: .5, height: 1} : sources[1];
    sectionState.presentation = {canvas: visible, sources, inputSource, destinations, controls, rails, lower, fold};
    host.dataset.sectionControls = rails ? 'rails' : wide ? 'wide' : 'compact';
    const rects = JSON.stringify(destinations);
    if (host.dataset.screenRects !== rects) host.dataset.screenRects = rects;
    const foldJSON = JSON.stringify(fold);
    if (host.dataset.foldBounds !== foldJSON) host.dataset.foldBounds = foldJSON;
    document.documentElement.style.setProperty('--kt-section-controls-top', `${lower.top}px`);
    for (const [name, value] of Object.entries({left: `${controls.left - visible.left}px`, top: `${controls.top - visible.top}px`,
      width: `${controls.width}px`, height: `${controls.height}px`, right: 'auto', bottom: 'auto', margin: '0'})) {
      if (pad.style[name] !== value) pad.style[name] = value;
    }
    const canvas = emulator.canvas;
    for (const [name, value] of Object.entries({position: 'fixed', transform: 'none',
      width: `${visible.width}px`, height: `${visible.height}px`, 'max-width': 'none', 'max-height': 'none',
      left: `${visible.left}px`, top: `${visible.top}px`})) {
      if (canvas.style.getPropertyValue(name) !== value || canvas.style.getPropertyPriority(name) !== 'important') canvas.style.setProperty(name, value, 'important');
    }
    return true;
  }
  const dsViews = [[2, 'Side by side'], [3, 'Side by side ↔'], [0, 'Vertical'],
    [1, 'Vertical ↕'], [4, 'Top screen'], [5, 'Touchscreen']];
  function alignDSScreens(emulator) {
    const canvas = emulator.canvas;
    if (!canvas) return;
    if (alignScreenSections(emulator, dsOrigin)) return;
    if (!gamepadMode() && (emulator.bookMode || ![0, 1].includes(emulator.getScreenLayout()))) {
      // The core's resize has restored its normal size; restore CSS centering
      // as well when leaving either of the vertically stacked views.
      canvas.style.removeProperty('top');
      canvas.style.removeProperty('left');
      return;
    }
    // Fit the native screen ratio into the entire safe area. Starting from the
    // core's already-inset canvas would keep its margins and prevent enlargement.
    const bounds = gamepadScreenBounds(dsOrigin);
    if (emulator.bookMode) {
      // Book mode owns its rotated native size/transform; move its origin only.
      canvas.style.setProperty('left', `${bounds.left + bounds.width / 2}px`, 'important');
      canvas.style.setProperty('top', `${bounds.top + bounds.height / 2}px`, 'important');
      return;
    }
    const ratio = emulator.getDefaultAspectRatio();
    if (!bounds.width || !bounds.height || !Number.isFinite(ratio) || ratio <= 0) return;
    const width = Math.min(bounds.width, bounds.height * ratio), height = width / ratio;
    canvas.style.setProperty('max-width', 'none', 'important');
    canvas.style.setProperty('max-height', 'none', 'important');
    canvas.style.setProperty('width', `${width}px`, 'important');
    canvas.style.setProperty('height', `${height}px`, 'important');
    canvas.style.setProperty('left', `${bounds.left + bounds.width / 2}px`, 'important');
    // Bring the portrait stack slightly closer to the status bar without
    // resizing either screen or moving the landscape/controller presentation.
    const top = !gamepadMode() && innerWidth < innerHeight ?
      Math.max(visibleViewport().top, bounds.top - 12) : bounds.top;
    canvas.style.setProperty('top', `${top + (gamepadMode() ? bounds.height / 2 : height / 2)}px`, 'important');
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
    if (sectionState?.mode) chooseAutomaticSections(false);
    clear(); emulator.setView(next);
    saveControls({n3dsView: next});
    update3DSLabel(emulator);
  });
  let n3dsEmulator = null, n3dsObserver = null;
  function align3DSScreens(emulator) {
    const canvas = emulator.canvas;
    if (!canvas) return;
    if (alignScreenSections(emulator, n3dsOrigin)) return;
    // The app has just restored the aspect-preserving size. Landscape keeps it;
    // only portrait's explicit positioning needs clearing on every resize.
    for (const name of ['left', 'top']) canvas.style.removeProperty(name);
    if (innerWidth > innerHeight && !gamepadMode()) return;
    const bounds = gamepadScreenBounds(n3dsOrigin);
    const ratio = emulator.getDefaultAspectRatio();
    if (!bounds.width || !bounds.height || !Number.isFinite(ratio) || ratio <= 0) return;
    const width = Math.min(bounds.width, bounds.height * ratio), height = width / ratio;
    canvas.style.setProperty('max-width', 'none', 'important');
    canvas.style.setProperty('max-height', 'none', 'important');
    canvas.style.setProperty('width', `${width}px`, 'important');
    canvas.style.setProperty('height', `${height}px`, 'important');
    canvas.style.setProperty('left', `${bounds.left + bounds.width / 2}px`, 'important');
    canvas.style.setProperty('top', `${bounds.top + (gamepadMode() ? bounds.height / 2 : height / 2)}px`, 'important');
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
    if (sectionState?.mode) chooseAutomaticSections(false);
    const index = dsViews.findIndex(([value]) => value === emulator.getPrefs().getScreenLayout());
    dsView = dsViews[(index + 1) % dsViews.length][0];
    applyDSView(emulator, dsView);
    rememberDSView(emulator);
  });
  $('.kt-ds-single').addEventListener('click', () => {
    if (!gameReady || editing) return;
    if (sectionState?.mode) chooseAutomaticSections(false);
    const emulator = window.app.emulator;
    applyDSView(emulator, emulator.getPrefs().getScreenLayout() === 4 ? 5 : 4);
    rememberDSView(emulator);
  });
  $('.kt-ds-dual').addEventListener('click', () => {
    if (!gameReady || editing) return;
    if (sectionState?.mode) chooseAutomaticSections(false);
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
      ['psx','ps2'].includes(system) ? `${index ? 'Right' : 'Left'} analog stick` :
      n3ds ? (index ? 'C-stick' : 'Circle Pad') : 'Analog stick');
  }
  configureDirection(stick, n64 || n3ds || system === 'psp' || dolphin ? 'analog' : 'digital');
  function addDirection(id, kind, index, className) {
    const element = stick.cloneNode(true);
    element.dataset.layoutId = id;
    element.classList.add(className);
    configureDirection(element, kind, index);
    pad.append(element); directions.push(element);
    return element;
  }
  if (n64 || n3ds || system === 'psp' || dolphin) addDirection('dpad', 'digital', 0, 'kt-extra-dpad');
  if (n3ds || gamecube) addDirection('stick-right', 'analog', 1, 'kt-c-stick');
  if (system === 'psx' || system === 'ps2') {
    // A steady DualShock overlay avoids layout changes when games select digital
    // or analog input. The core retains its per-game controller-mode setting.
    addDirection('stick-left', 'analog', 0, 'kt-analog-left');
    addDirection('stick-right', 'analog', 1, 'kt-analog-right');
    host.classList.add('kt-dualshock');
  }
  if (system === 'ps2') {
    host.classList.add('kt-ps2');
    for (const [cid,label] of [[16,'L3'],[17,'R3']]) {
      const button=document.createElement('button');button.dataset.cid=String(cid);button.textContent=label;
      if(cid===16)$('.kt-center').prepend(button);else $('.kt-center').append(button);
    }
  }
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
  const layoutKey = () => `${wii && host.dataset.wiiLayout && host.dataset.wiiLayout !== 'nunchuk' ? 'wii-' + host.dataset.wiiLayout : system || 'library'}:${innerWidth > innerHeight ? 'landscape' : 'portrait'}${sectionState?.mode ? ':sections-console' : ''}`;
  function currentLayout() {
    // Keep layouts saved before platform names replaced emulator URL names.
    const legacyKey = `${emulatorPath}:${innerWidth > innerHeight ? 'landscape' : 'portrait'}`;
    const value = layouts[layoutKey()] ?? (sectionState?.mode || wii && host.dataset.wiiLayout && host.dataset.wiiLayout !== 'nunchuk' ? null : layouts[legacyKey]);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  // A game iframe can be taller than the visible installed-app window. Its
  // own visualViewport describes the iframe, so also intersect its ancestors.
  // Keep saved normalized coordinates in the existing game-frame dimensions.
  function visibleViewport() {
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    let view = window, offsetX = 0, offsetY = 0;
    try {
      while (view) {
        const candidate = view.visualViewport;
        const visual = !candidate?.scale || Math.abs(candidate.scale - 1) < .01 ? candidate : null;
        const x = visual?.offsetLeft || 0, y = visual?.offsetTop || 0;
        left = Math.max(left, x - offsetX);
        top = Math.max(top, y - offsetY);
        right = Math.min(right, view.innerWidth - offsetX,
          x + (visual?.width || view.innerWidth) - offsetX);
        bottom = Math.min(bottom, view.innerHeight - offsetY,
          y + (visual?.height || view.innerHeight) - offsetY);
        if (view === view.top || !view.frameElement) break;
        const frame = view.frameElement, rect = frame.getBoundingClientRect();
        offsetX += rect.left + frame.clientLeft;
        offsetY += rect.top + frame.clientTop;
        view = view.parent;
      }
    } catch (_) { /* Cross-origin ancestors cannot supply their bounds. */ }
    return {left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top)};
  }
  function gamepadScreenBounds(origin) {
    const safe = origin.getBoundingClientRect();
    if (!gamepadMode()) return safe;
    const visible = visibleViewport();
    const left = Math.max(safe.left, visible.left), top = Math.max(safe.top, visible.top);
    const right = Math.min(safe.right, visible.right), bottom = Math.min(safe.bottom, visible.bottom);
    return {left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top)};
  }
  const pspOrigin = system === 'psp' ? safeArea('kt-psp-origin') : null;
  const psxOrigin = system === 'psx' ? safeArea('kt-psx-origin') : null;
  const gameboy = system === 'gb' || system === 'gbc';
  const gbOrigin = gameboy ? safeArea('kt-gb-origin') : null;
  let controllerBounds = visibleViewport();
  function alignPSPScreen(emulator) {
    if (system !== 'psp' || !emulator?.started || !emulator.canvas) return;
    const bounds = visibleViewport(), canvas = emulator.canvas;
    if (!bounds.width || !bounds.height) return;
    // Portrait touch controls have their own lower area. Center the picture in
    // the remaining safe space, even when pause/settings hide the controls.
    if (touchEnabled() && bounds.width < bounds.height) {
      const safe = pspOrigin.getBoundingClientRect(), controls = getComputedStyle(pad);
      bounds.left = Math.max(bounds.left, safe.left);
      bounds.right = Math.min(bounds.right, safe.right);
      bounds.top = Math.max(bounds.top, safe.top);
      bounds.bottom -= parseFloat(controls.bottom) + parseFloat(controls.height) + 20;
      bounds.width = Math.max(0, bounds.right - bounds.left);
      bounds.height = Math.max(0, bounds.bottom - bounds.top);
      if (!bounds.width || !bounds.height) return;
    }
    const screen = emulator.getScreenSize?.();
    const ratio = screen === emulator.SS_16_9 ? 16 / 9 : emulator.getDefaultAspectRatio?.();
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    const zoom = Number(emulator.getProps?.().zoomLevel) || 0;
    const scale = (96 + zoom) / 100;
    let width = bounds.width * scale, height = bounds.height * scale;
    if (screen !== emulator.SS_FILL) { width = Math.min(width, height * ratio); height = width / ratio; }
    const pixels = value => `${Math.round(value * 1000) / 1000}px`;
    // Only CSS placement changes here. RetroArch owns the WebGL drawing buffer
    // and observes canvas size itself; resetting it would erase the game image.
    for (const [name, value] of Object.entries({position: 'fixed', width: pixels(width), height: pixels(height),
      'max-width': 'none', 'max-height': 'none',
      left: pixels(bounds.left + bounds.width / 2), top: pixels(bounds.top + bounds.height / 2)})) {
      if (canvas.style.getPropertyValue(name) !== value || canvas.style.getPropertyPriority(name) !== 'important')
        canvas.style.setProperty(name, value, 'important');
    }
  }
  // The other single-screen cores retain their native size and screen options.
  // Opaque installed iPhone status bars sit outside innerHeight. Account for
  // that excluded top strip when centering the picture on the physical phone,
  // without enlarging the iframe or shifting any touch controls.
  const centeredScreen = ['nes', 'snes', 'gb', 'gbc', 'gba', 'n64', 'genesis', 'psx'].includes(system);
  function alignCenteredScreen(emulator) {
    // PSX loading starts before an emulator/canvas exists. Publish its default
    // picture coordinates immediately so every startup phase uses the same area.
    if (!centeredScreen || (system !== 'psx' && (!emulator?.started || !emulator.canvas))) return;
    const bounds = visibleViewport(), canvas = emulator?.started ? emulator.canvas : null;
    if (!bounds.width || !bounds.height) return;
    let excludedTop = 0;
    try {
      const outer = window.top;
      const installedApple = outer.document.documentElement.hasAttribute('data-cr-status-top') &&
        (outer.navigator.standalone || outer.matchMedia('(display-mode: standalone)').matches);
      const difference = outer.screen.height - outer.innerHeight;
      if (installedApple && !outer.document.fullscreenElement && outer.innerWidth < outer.innerHeight &&
          Math.abs(outer.screen.width - outer.innerWidth) < 1 && difference > 0 && difference <= 100)
        excludedTop = difference;
    } catch (_) { /* Cross-origin hosts retain visible viewport centering. */ }
    // Default picture areas stay independent of live controller positions,
    // visibility and sizing: PSX in portrait, GB/GBC in both orientations.
    const reservedArea = !gamepadMode() && (gameboy || bounds.width < bounds.height && system === 'psx');
    const safe = reservedArea ? (gameboy ? gbOrigin : psxOrigin).getBoundingClientRect() : null;
    const safeTop = reservedArea ? Math.max(bounds.top, safe.top) : bounds.top;
    const safeBottom = reservedArea ? Math.min(bounds.bottom, safe.bottom) : bounds.bottom;
    const safeLeft = reservedArea ? Math.max(bounds.left, safe.left) : bounds.left;
    const safeRight = reservedArea ? Math.min(bounds.right, safe.right) : bounds.right;
    // Short cover displays and split windows can leave less room than the
    // native default picture needs. Fit it uniformly above the standard pad.
    // Measure the untransformed layout size so repeated alignment cannot feed
    // its own scale back into the next measurement. Native Fill, widescreen
    // and zoom choices retain their native sizing.
    let scale = 1;
    const native = canvas ? getComputedStyle(canvas) : null;
    const nativeHeight = canvas ? parseFloat(native.height) || canvas.clientHeight : 0;
    const nativeWidth = canvas ? parseFloat(native.width) || canvas.clientWidth : 0;
    if (canvas && reservedArea) {
      const width = nativeWidth, height = nativeHeight;
      const ratio = emulator.getDefaultAspectRatio?.();
      const fill = emulator.SS_FILL !== undefined && emulator.getScreenSize?.() === emulator.SS_FILL;
      const zoom = Number(emulator.getProps?.().zoomLevel) || 0;
      if (!fill && !zoom && width > 0 && height > 0 && Number.isFinite(ratio) &&
          Math.abs(width / height - ratio) < .01) {
        scale = Math.min(1, Math.max(0, safeBottom - safeTop) / height,
          Math.max(0, safeRight - safeLeft) / width);
      }
    }
    const height = nativeHeight * scale;
    const middle = reservedArea ? (safeTop + Math.max(safeTop, safeBottom)) / 2 :
      bounds.top + (bounds.height - excludedTop) / 2;
    // Fill/zoom can leave no room to move: keep the native picture visible.
    const center = height <= bounds.height ?
      Math.max(bounds.top + height / 2, Math.min(bounds.bottom - height / 2, middle)) :
      bounds.top + bounds.height / 2;
    const width = nativeWidth * scale, middleX = (safeLeft + Math.max(safeLeft, safeRight)) / 2;
    const centerX = width <= bounds.width ?
      Math.max(bounds.left + width / 2, Math.min(bounds.right - width / 2, middleX)) :
      bounds.left + bounds.width / 2;
    const pixels = value => `${Math.round(value * 1000) / 1000}px`;
    if (system === 'psx') {
      // The native unmute prompt follows the actual picture, including Fill and
      // landscape. Keep its native gesture handler and timed text dismissal.
      for (const [name, value] of Object.entries({'--kt-psx-picture-left': pixels(centerX),
        '--kt-psx-picture-top': pixels(center)})) {
        if (document.documentElement.style.getPropertyValue(name) !== value)
          document.documentElement.style.setProperty(name, value);
      }
    }
    if (!canvas) return; // Loading coordinates never alter an unstarted canvas.
    for (const [name, value] of Object.entries({position: 'fixed',
      transform: `translate(-50%, -50%)${scale < 1 ? ` scale(${scale})` : ''}`,
      left: pixels(centerX), top: pixels(center)})) {
      if (canvas.style.getPropertyValue(name) !== value || canvas.style.getPropertyPriority(name) !== 'important')
        canvas.style.setProperty(name, value, 'important');
    }
  }
  let centeredEmulator = null;
  let pspEmulator = null;
  function fitVisibleViewport() {
    controllerBounds = visibleViewport();
    Object.assign(host.style, {left: `${controllerBounds.left}px`, top: `${controllerBounds.top}px`,
      width: `${controllerBounds.width}px`, height: `${controllerBounds.height}px`, right: 'auto', bottom: 'auto'});
  }
  function applyLayout() {
    for (const element of movable) { element.style.transform = ''; element.style.visibility = ''; }
    if (pad.hidden) return;
    const saved = currentLayout();
    const obstacles = [tab.getBoundingClientRect()];
    if (!dsCycle.hidden) obstacles.push(dsCycle.getBoundingClientRect());
    if (editing) obstacles.push($('.kt-editor').getBoundingClientRect());
    if (sectionState?.mode === 'stacked') {
      const split = sectionSplit(controllerBounds);
      obstacles.push({left: controllerBounds.left, right: controllerBounds.right, top: split - 12, bottom: split + 12});
    }
    const gap = 10; // Includes the editor's dashed outlines and a finger gap.
    for (const element of movable) {
      const point = saved[element.dataset.layoutId];
      const r = element.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const custom = Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
      const desiredX = custom ? point[0] * innerWidth : r.left + r.width / 2;
      const desiredY = custom ? point[1] * innerHeight : r.top + r.height / 2;
      const controls = sectionState?.presentation?.controls;
      const area = controls && element.classList.contains('kt-ds-mic') ?
        {...controls, left: controls.left + 156, right: controls.right - 156, top: controls.bottom - 44} : controls || controllerBounds;
      let left = area.left, right = area.right;
      if (sectionState?.presentation?.rails && !element.classList.contains('kt-ds-mic')) {
        const isLeft = element === stick || element.classList.contains('kt-extra-dpad') ||
          ['8','10','12'].includes(element.dataset.cid);
        if (isLeft) right = left + 144;
        else left = right - 136;
      }
      const inset = sectionState?.presentation ? 0 : 8;
      const clampX = x => Math.max(left + inset + r.width / 2,
        Math.min(right - inset - r.width / 2, x));
      const clampY = y => Math.max(area.top + inset + r.height / 2,
        Math.min(area.bottom - inset - r.height / 2, y));
      // Apply the exclusion area to defaults, restored layouts, and live drags.
      // Choose the closest free position alongside/above/below the tab.
      const xs = [desiredX, ...obstacles.flatMap(o => [o.left - gap - r.width / 2, o.right + gap + r.width / 2])].map(clampX);
      const ys = [desiredY, ...obstacles.flatMap(o => [o.top - gap - r.height / 2, o.bottom + gap + r.height / 2])].map(clampY);
      const cssRadius = getComputedStyle(element).borderTopLeftRadius;
      const radius = parseFloat(cssRadius) * (cssRadius.endsWith('%') ? r.width / 100 : 1);
      const circle = Math.abs(r.width - r.height) < 1 && radius >= r.width / 2;
      const positions = xs.flatMap(x => ys.map(y => ({x, y}))).filter(p => obstacles.every(o =>
        circle && o.circle ? Math.hypot(p.x - (o.left + o.right) / 2, p.y - (o.top + o.bottom) / 2) >= r.width / 2 + (o.right - o.left) / 2 + gap :
          p.x + r.width / 2 <= o.left - gap || p.x - r.width / 2 >= o.right + gap ||
          p.y + r.height / 2 <= o.top - gap || p.y - r.height / 2 >= o.bottom + gap));
      positions.sort((a, b) => Math.hypot(a.x - desiredX, a.y - desiredY) - Math.hypot(b.x - desiredX, b.y - desiredY));
      // On an exceptionally small viewport, hide a control rather than cover
      // the settings handle; it returns as soon as there is room again.
      if (!positions.length) { element.style.visibility = 'hidden'; continue; }
      const {x, y} = positions[0];
      element.style.transform = `translate(${x - r.left - r.width / 2}px, ${y - r.top - r.height / 2}px)`;
      if (sectionState?.mode) obstacles.push({...element.getBoundingClientRect().toJSON(), circle});
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
      // Expanded sections belong to this device; keep the normal synced phone
      // layout and the sync protocol's existing orientation keys intact.
      const synced = Object.fromEntries(Object.entries(changes).filter(([key]) => !/:sections(?:-console)?$/.test(key)).map(([key, value]) => ['layout:' + key, value]));
      if (Object.keys(synced).length) saveControls(synced);
    } else if (beforeEdit) layouts = beforeEdit;
    editing = false; beforeEdit = null;
    host.classList.remove('kt-editing');
    $('.kt-editor').hidden = true;
    if (editEmulator === window.app?.emulator && !document.hidden && !window.app.isPauseScreen()) editEmulator.pause(false);
    editEmulator = null; layoutStamp = ''; clear(); updateGamepadPresentation(); draw();
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
  host.classList.toggle('kt-gamecube', gamecube);
  host.classList.toggle('kt-wii', wii);
  host.classList.toggle('kt-psp', system === 'psp');
  host.classList.toggle('kt-gameboy', gameboy);
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
  if (gamecube) {
    const z = $('[data-cid="12"]'); z.textContent = 'Z'; $('.kt-shoulders').append(z);
    $('[data-cid="10"]').hidden = true; $('[data-cid="11"]').hidden = true;
  }
  if (wii) {
    pad.setAttribute('aria-label','Wii Remote and Nunchuk touch controller');
    stick.setAttribute('aria-label','Nunchuk analog stick');
    $('.kt-extra-dpad')?.setAttribute('aria-label','Wii Remote directional pad');
    $('.kt-shoulders').append($('[data-cid="12"]'));
    $('[data-cid="11"]').hidden=true;
    for (const [cid,label] of [[4,'A'],[5,'B'],[6,'1'],[7,'2'],[8,'C'],[9,'Z'],[12,'−'],[13,'+'],[10,'Home']]) {
      const button=$(`[data-cid="${cid}"]`);button.textContent=label;button.setAttribute('aria-label',label==='−'?'Minus':label==='+'?'Plus':label);
    }
    $('[data-cid="10"]').hidden=false;
  }
  if (system === 'psx' || system === 'psp' || system === 'ps2') {
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
    setSectionMic(false);
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
    setSectionMic([...pointers.values()].some(value => value.microphone));
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
  const gamecubeDock = {stamp: '', top: 0};
  function dockPosition() {
    const point = currentLayout().dock;
    if (Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)) return point;
    if (sectionState?.mode) {
      const area = sectionState.presentation?.lower;
      if (area) return [dockSide === 'left' ? area.left / innerWidth : area.right / innerWidth,
        (sectionState.presentation.rails ? area.top + 94 : sectionState.presentation.controls.top + 24) / innerHeight];
    }
    if (gameboy && innerWidth < innerHeight && !gamepadMode()) {
      // The wide portrait picture reaches the screen edges. Its default tab
      // belongs in the gap below the picture, above the A/B buttons.
      return [dockSide === 'left' ? 0 : 1, (gbOrigin.getBoundingClientRect().bottom + 44) / innerHeight];
    }
    if (dolphin && innerWidth > innerHeight && innerWidth <= 650 && innerHeight <= 550) {
      // The short landscape layout reaches the top of the window. Put its
      // settings tab between the shoulder and face buttons, without pushing
      // Z onto R. Re-measure on viewport changes, never on every input frame.
      const stamp = `${innerWidth}:${innerHeight}:${controllerBounds.top}:${controllerBounds.bottom}`;
      if (stamp !== gamecubeDock.stamp) {
        const style = getComputedStyle(pad);
        gamecubeDock.top = controllerBounds.bottom - parseFloat(style.bottom) - parseFloat(style.height) + 66;
        gamecubeDock.stamp = stamp;
      }
      return [dockSide === 'left' ? 0 : 1, (gamecubeDock.top + 24) / innerHeight];
    }
    return [dockSide === 'left' ? 0 : 1, .18 + 24 / innerHeight];
  }
  function drawDock() {
    const [x, y] = dockPosition();
    const area = sectionState?.presentation?.lower;
    const left = x * innerWidth < (area ? (area.left + area.right) / 2 : innerWidth / 2);
    const dock = $('.kt-dock');
    const centered = area && !sectionState.presentation.rails && !drawerOpen;
    dock.style.left = centered ? `${(area.left + area.right) / 2 - controllerBounds.left - 22}px` : area && left ? `${area.left - controllerBounds.left}px` : '';
    dock.style.right = centered ? 'auto' : area && !left ? `${controllerBounds.right - area.right}px` : '';
    drawer.style.maxHeight = area ? `${Math.max(44, area.height - 16)}px` : '';
    drawer.style.maxWidth = area ? `${area.width}px` : '';
    const editor = $('.kt-editor');
    editor.style.left = area ? `${(area.left + area.right) / 2 - controllerBounds.left}px` : '';
    editor.style.top = area ? `${area.top - controllerBounds.top + 8}px` : '';
    editor.style.maxWidth = area ? `${area.width - 16}px` : '';
    host.classList.toggle('kt-dock-left', left);
    tab.textContent = drawerOpen === left ? '‹' : '›';
    tab.setAttribute('aria-label', editing ? 'Drag settings tab to either edge' : 'Touch controller settings');
    $('.kt-close').textContent = left ? '‹ Close panel' : 'Close panel ›';
    // Keep the tab clear of the editor; allow the drawer to extend upward when
    // its handle has been placed near the bottom of the screen.
    const toolbarBottom = system === 'nds' ? document.querySelector('.touch-overlay-buttons')?.getBoundingClientRect().bottom || 0 : 0;
    const minimum = editing ? $('.kt-editor').getBoundingClientRect().bottom + 10 :
      Math.max(controllerBounds.top + 8, toolbarBottom + 10);
    const top = Math.max(area ? area.top : minimum, Math.min((area?.bottom || controllerBounds.bottom) - 56, y * innerHeight - 24));
    host.style.setProperty('--kt-dock-top', `${top - controllerBounds.top}px`);
    drawer.style.marginTop = `${drawerOpen ? Math.max((area?.top || controllerBounds.top) + 8 - top,
      Math.min(0, (area?.bottom || controllerBounds.bottom) - 8 - top - drawer.offsetHeight)) : 0}px`;
  }
  function draw() {
    fitVisibleViewport();
    const emulator = window.app?.emulator;
    syncScreenSections(emulator);
    if (sectionState?.mode && emulator?.canvas) {
      if (system === 'nds') alignDSScreens(emulator);
      else align3DSScreens(emulator);
    }
    if (system === 'psp') alignPSPScreen(window.app?.emulator);
    else alignCenteredScreen(window.app?.emulator);
    const effectiveEnabled = touchEnabled();
    const presentationChanged = host.classList.contains('kt-enabled') !== effectiveEnabled;
    host.classList.toggle('kt-enabled', effectiveEnabled);
    // PS2/GameCube own their canvas geometry and consume this class. Refit on
    // transitions even if the game is paused and has no animation frame.
    if (presentationChanged && (system === 'ps2' || dolphin)) window.app?.emulator?.updateScreenSize?.();
    toggle.setAttribute('aria-pressed', String(effectiveEnabled));
    toggle.textContent = `Touch controls: ${effectiveEnabled ? 'On' : 'Off'}`;
    const wasHidden = pad.hidden;
    const microphone = $('.kt-ds-mic');
    const microphoneHidden = !(system === 'nds' && sectionState?.mode && emulator?.getPrefs?.()?.isMicrophoneSupported?.());
    if (microphone.hidden !== microphoneHidden) { microphone.hidden = microphoneHidden; layoutStamp = ''; }
    pad.hidden = (dolphin && !touchDevice) || drawerOpen || (!editing && (!effectiveEnabled || !gameReady));
    $('.kt-editor').hidden = !editing || drawerOpen;
    drawDock();
    $('.kt-edit').disabled = !editing && !gameReady;
    $('.kt-edit').textContent = editing ? 'Continue editing' : 'Edit layout';
    sectionsToggle.hidden = !['nds','3ds'].includes(system) || !gameReady || editing;
    sectionsToggle.setAttribute('aria-pressed', String(automaticSections));
    sectionsToggle.textContent = `Screen sections: ${automaticSections ? 'Auto' : 'Off'}`;
    $('.kt-fold-position').hidden = !sectionState?.mode || editing;
    if (sectionState?.mode) {
      const fold = sectionFold(controllerBounds), split = fold.center, stacked = sectionState.mode === 'stacked';
      host.style.setProperty('--kt-fold-y', `${stacked ? split - controllerBounds.top : controllerBounds.height / 2}px`);
      foldGuide.style.cssText = stacked ? `left:0;right:0;top:${fold.start - controllerBounds.top}px;height:${fold.gap}px;border-block:1px solid #67e5c5` :
        `top:0;bottom:0;left:${fold.start - controllerBounds.left}px;width:${fold.gap}px;border-inline:1px solid #67e5c5`;
      foldSlider.value = String(foldOffset(sectionState.mode));
      $('.kt-fold-position output').value = `${foldSlider.value}%`;
      foldGapSlider.min = String(Math.max(16, fold.reportedGap)); foldGapSlider.max = String(Math.max(160, fold.gap));
      foldGapSlider.value = String(fold.gap); $('.kt-fold-gap-value').value = `${Math.round(fold.gap)}px`;
    } else foldGuide.hidden = true;
    dsScreens.hidden = system !== 'nds' || !gameReady || editing;
    n3dsScreens.hidden = system !== '3ds' || !gameReady || editing || !window.app?.emulator?.getViews;
    if (system === 'nds') {
      document.documentElement.classList.toggle('kt-ds-playing', gameReady && !editing && !drawerOpen);
    }
    const tabRect = tab.getBoundingClientRect();
    const fold = sectionState?.presentation?.fold;
    const stamp = `${innerWidth}:${innerHeight}:${controllerBounds.left}:${controllerBounds.top}:${controllerBounds.width}:${controllerBounds.height}:${fold ? `${fold.start}:${fold.end}:${host.dataset.sectionControls}` : ''}:${layoutKey()}:${editing}:${tabRect.x}:${tabRect.y}:${tabRect.width}:${tabRect.height}`;
    if (!pad.hidden && (wasHidden || stamp !== layoutStamp)) { applyLayout(); layoutStamp = stamp; }
  }
  function setDrawer(open) {
    clear(); drawerOpen = open; drawer.hidden = !open;
    if (!open) foldGuide.hidden = true;
    tab.setAttribute('aria-expanded', String(open));
    draw();
    if (open) cloud()?.syncControls?.();
    if (dolphin) (wii ? window.WrcadWii : window.WrcadGameCube)?.menuOpen(open);
    if (system === 'ps2') window.WrcadPS2?.menuOpen(open);
  }
  toggle.addEventListener('click', () => {
    // Keep the target the user saw even if ending an edit applies deferred
    // hotplug state and switches which preference owns the button.
    const desiredEnabled = !touchEnabled();
    if (editing) finishEdit(false);
    clear();
    if (presentedGamepadConnected) {
      gamepadTouch = desiredEnabled;
      try { localStorage.setItem(GAMEPAD_TOUCH_KEY, String(gamepadTouch)); } catch (_) {}
      updateGamepadPresentation();
    } else {
      enabled = desiredEnabled;
      try { localStorage.setItem(KEY, String(enabled)); } catch (_) { /* Optional persistence. */ }
      saveControls({enabled});
    }
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
    // Keep a stable center without jumping straight to 10% when leaving it.
    // Rescale the remaining radial travel to the full 0..1 analog range.
    const magnitude = (Math.min(1, length) - 0.10) / 0.90;
    return [x / length * magnitude, y / length * magnitude];
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
    if (target.classList.contains('kt-ds-mic')) return {target, microphone: true};
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
    if (!touchEnabled() || !gameReady || drawerOpen) return;
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
  window.visualViewport?.addEventListener('scroll', resizeLayout);
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
    if (e.key === FOLD_GAP_KEY || e.key === null) {
      try { foldGap = Math.max(16, Math.min(160, Number(localStorage.getItem(FOLD_GAP_KEY)) || 40)); } catch (_) {}
      layoutStamp = '';
    }
    if (e.key === FOLD_KEY || e.key === null) {
      try { foldAlignment = JSON.parse(localStorage.getItem(FOLD_KEY)) || {}; } catch (_) {}
      layoutStamp = '';
    }
    if (e.key === SECTIONS_KEY || e.key === null) {
      try { automaticSections = localStorage.getItem(SECTIONS_KEY) !== 'false'; } catch (_) {}
      clear(); layoutStamp = ''; draw();
    }
    if (e.key === GAMEPAD_TOUCH_KEY || e.key === null) {
      try { gamepadTouch = localStorage.getItem(GAMEPAD_TOUCH_KEY) === 'true'; } catch (_) {}
      updateGamepadPresentation(); draw();
    }
    if ([KEY, MUTE_KEY, DS_VIEW_KEY, N3DS_VIEW_KEY, DOCK_SIDE_KEY, TRANSLUCENCE_KEY, LAYOUT_KEY].includes(e.key)) refreshPreferences();
  });
  document.addEventListener('fullscreenchange', () => {
    clear();
    const target = document.fullscreenElement;
    if (!target || !['CANVAS','VIDEO','IFRAME'].includes(target.tagName)) (target || document.body).append(host);
    layoutStamp = ''; draw();
  });
  function updateGamepadPresentation() {
    // Freeze connection and mode together while editing: live hotplug must not
    // move the picture or cancel an unsaved drag. Save/Cancel applies it below.
    if (editing) return;
    const mode = gamepadConnected && !gamepadTouch;
    const changed = mode !== presentedGamepadMode || gamepadConnected !== presentedGamepadConnected;
    presentedGamepadConnected = gamepadConnected; presentedGamepadMode = mode;
    if (changed) {
      // Disconnect can hide touch even when mode stays false: connected On may
      // have temporarily overridden a normal Controls-off preference.
      clear(); layoutStamp = ''; draw();
      const emulator = window.app?.emulator;
      if (emulator?.started) emulator.updateScreenSize?.();
    }
  }
  // Any connected controller selects the centered picture without touch controls.
  // The drawer button lets the player restore touch regardless of pad mapping.
  const replacesTouchControls = pad => pad && pad.connected !== false;
  function pollGamepads() {
    try {
      const pads = navigator.getGamepads?.();
      if (pads) {
        // Keep the event fallback consistent after a snapshot-only disconnect.
        eventGamepads.clear();
        for (const pad of Array.from(pads).filter(replacesTouchControls)) eventGamepads.add(pad.index);
        gamepadConnected = eventGamepads.size > 0;
      }
    } catch (_) { /* Unavailable API: retain the last hotplug event. */ }
    updateGamepadPresentation();
  }
  const eventGamepads = new Set();
  window.addEventListener('gamepadconnected', event => {
    if (replacesTouchControls(event.gamepad)) eventGamepads.add(event.gamepad.index);
    else eventGamepads.delete(event.gamepad.index);
    gamepadConnected = eventGamepads.size > 0; pollGamepads();
  });
  window.addEventListener('gamepaddisconnected', event => {
    eventGamepads.delete(event.gamepad.index); gamepadConnected = eventGamepads.size > 0; pollGamepads();
  });
  window.addEventListener('pageshow', pollGamepads);
  function attach() {
    pollGamepads();
    const emulator = window.app?.emulator;
    if (system === 'psp' && emulator?.started && pspEmulator !== emulator) {
      pspEmulator = emulator;
      const resize = emulator.updateScreenSize;
      emulator.updateScreenSize = function(...args) {
        const result = resize.apply(this, args); alignPSPScreen(this); return result;
      };
      emulator.updateScreenSize();
    }
    if (centeredScreen && emulator?.started && centeredEmulator !== emulator) {
      centeredEmulator = emulator;
      const resize = emulator.updateScreenSize;
      emulator.updateScreenSize = function(...args) {
        const result = resize.apply(this, args); alignCenteredScreen(this); return result;
      };
      emulator.updateScreenSize();
    }
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
    host.hidden = framed || !(ready || (dolphin && emulator?.started && !window.app.isPauseScreen()) || (editing && emulator === editEmulator));
    if (host.hidden && drawerOpen) setDrawer(false);
    if (ready !== gameReady || controller !== activeController || framed) clear();
    activeController = controller; gameReady = ready;
    if (controller && !patched.has(controller)) {
      patched.add(controller);
      for (const method of ['isControlDown', 'isPadButtonDown']) {
        const original = controller[method];
        controller[method] = function(cid, analogToDigital = true) {
          const touch = !editing && touchEnabled() && gameReady && !drawerOpen && held.has(cid);
          return touch || original.call(this, cid, analogToDigital);
        };
      }
      const originalAxis = controller.getAxisValue;
      controller.getAxisValue = function(index, isX) {
        const value = axes[index * 2 + (isX ? 0 : 1)] || 0;
        return touchEnabled() && gameReady && !drawerOpen && value ? value : originalAxis.call(this, index, isX);
      };
      for (const [method, isX, sign] of [['isAxisLeft',true,-1],['isAxisRight',true,1],['isAxisUp',false,-1],['isAxisDown',false,1]]) {
        const original = controller[method];
        controller[method] = function(index) {
          return (touchEnabled() && gameReady && !drawerOpen && axes[index * 2 + (isX ? 0 : 1)] * sign > 0.5) || original.call(this,index);
        };
      }
    }
    draw();
  }
  attach();
  setInterval(attach, 150);
})();
