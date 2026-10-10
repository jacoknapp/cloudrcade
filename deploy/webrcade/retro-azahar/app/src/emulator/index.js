import {
  RetroAppWrapper,
  DisplayLoop,
  LOG,
} from '@webrcade/app-common';

import { Prefs } from './prefs';
import { LazyRom } from './lazyrom';
import { requestGameText } from './textinput';
import { installSystemKeys } from './systemkeys';
import { PerfReadout, perfEnabled } from './perf';
import { mergeShaderCaches, graphicsTag } from './shadercache';
import { diagScene, installDiag } from './diag';
import { ShaderFailureTracker, quietCloudManager } from './shaderfailures';

// Azahar is built against the EmulatorJS RetroArch port, which runs its own
// main loop and exposes a different set of exports than the webЯcade RetroArch
// port. This class adapts that build to the RetroAppWrapper contract.

const HOME = '/home/web_user';
const RA_CONFIG_PATH = HOME + '/.config/retroarch/retroarch.cfg';
const SAVES_DIR = HOME + '/retroarch/userdata/saves';
// The core's record of the shader programs this game has used (see
// RememberedPrograms in the core). Kept in the browser between sessions so
// that they can be rebuilt in the background before the game needs them.
const SHADER_CACHE_DIR = HOME + '/retroarch/userdata/shadercache';
const SHADER_CACHE_NAME = 'programs.bin';
const SHADER_CACHE_PATH = SHADER_CACHE_DIR + '/' + SHADER_CACHE_NAME;
const STATE_PATH = HOME + '/retroarch/userdata/states/game.state';
// Azahar keeps its emulated SD card and NAND below this directory
const USER_DIR = SAVES_DIR + '/Azahar';
const SAVE_ROOTS = ['sdmc', 'nand', 'shaders'];

// RetroAppWrapper input bit -> libretro joypad id (EmulatorJS simulate_input)
const BUTTON_MAP = [
  // Face buttons follow the Nintendo layout: the bottom button is B, the right one is A.
  ['INP_A', 0], ['INP_X', 1], ['INP_SELECT', 2], ['INP_START', 3],
  ['INP_UP', 4], ['INP_DOWN', 5], ['INP_LEFT', 6], ['INP_RIGHT', 7],
  ['INP_B', 8], ['INP_Y', 9], ['INP_LBUMP', 10], ['INP_RBUMP', 11],
  ['INP_LTRIG', 12], ['INP_RTRIG', 13], ['INP_LTHUMB', 14], ['INP_RTHUMB', 15],
];
const ANALOG_MAX = 0x7fff;
// Keep every JS/worker/WASM version together, including older open sessions.
const CORE_REVISION = 'iphone-20261009-v18';
const CORE_BASE = 'js/' + CORE_REVISION + '/';
// Screen arrangements offered by the touch controller. `layout` and `screen` are
// values of the core's citra_layout_option and citra_swap_screen; the size is
// what the core then renders at native resolution.
const VIEW_KEY = 'wrcad.touch.3ds-view.v1';
const VIEWS = {
  stacked: { label: 'Stacked', layout: 'default', screen: 'Top', width: 400, height: 480 },
  side: { label: 'Side by side', layout: 'side_by_side', screen: 'Top', width: 720, height: 240 },
  top: { label: 'Top screen', layout: 'single_screen', screen: 'Top', width: 400, height: 240 },
  touch: { label: 'Touchscreen', layout: 'single_screen', screen: 'Bottom', width: 320, height: 240 },
};
const FRAME_MS = 1000 / 59.83; // Nintendo 3DS refresh rate
const CRUMB_KEY = 'wrcad.3ds.crumb.v1';
const ROM_EXTENSIONS = ['cia', '3ds', 'cci', 'cxi', '3dsx', 'app'];

export class Emulator extends RetroAppWrapper {
  // Top (400x240) above bottom (320x240)
  VIDEO_WIDTH = 400;
  VIDEO_HEIGHT = 480;

  SAVE_NAME = 'sav';

  constructor(app, debug = false) {
    super(app, debug);
    window.emulator = this;
    this.prefs = new Prefs(this);
    this.lastInput = {};
    this.loopResumed = false;
    this.shaderFailures = new ShaderFailureTracker(this, CORE_REVISION);
    // Circle Pad and D-pad are separate inputs; do not mirror the stick onto the D-pad.
    this.analogMode = true;
    let view = null;
    try { view = localStorage.getItem(VIEW_KEY); } catch (e) { /* storage unavailable */ }
    this.useView(VIEWS[view] ? view : 'stacked');
    const scene = diagScene();
    this.renderingDiagnostic = !!scene;
    if (scene) installDiag(this, scene);
  }

  useView(id) {
    this.view = id;
    this.VIDEO_WIDTH = VIEWS[id].width;
    this.VIDEO_HEIGHT = VIEWS[id].height;
  }

  // [id, label] pairs, in the order the controller cycles through them.
  getViews() {
    return Object.entries(VIEWS).map(([id, view]) => [id, view.label]);
  }

  getView() {
    return this.view;
  }

  // Switches the arrangement of the two screens while the game runs.
  setView(id) {
    if (!VIEWS[id] || id === this.view) return;
    this.useView(id);
    try { localStorage.setItem(VIEW_KEY, id); } catch (e) { /* this session only */ }
    const module = window.Module;
    if (module && module.cwrap) {
      const set = module.cwrap('ejs_set_variable', null, ['string', 'string']);
      set('citra_layout_option', VIEWS[id].layout);
      set('citra_swap_screen', VIEWS[id].screen);
    }
    if (this.started) this.updateScreenSize();
  }

  getScriptUrl() {
    return (this.coreBase || CORE_BASE) + 'azahar_libretro.js';
  }

  getPrefs() {
    return this.prefs;
  }

  getDefaultAspectRatio() {
    return this.VIDEO_WIDTH / this.VIDEO_HEIGHT;
  }

  getShotAspectRatio() {
    return this.getDefaultAspectRatio();
  }

  isForceAspectRatio() {
    return true;
  }

  isEscapeHackEnabled() {
    return false;
  }

  // The loader picks the container format from the extension; a CIA has no magic.
  detectExtension(bytes, ext) {
    const magic = bytes && bytes.length > 0x104 ?
      String.fromCharCode(bytes[0x100], bytes[0x101], bytes[0x102], bytes[0x103]) : '';
    if (magic === 'NCSD') return 'cci';
    if (magic === 'NCCH') return 'cxi';
    const lower = (ext || '').toLowerCase();
    return ROM_EXTENSIONS.includes(lower) ? lower : 'cia';
  }

  setRoms(uid, frontendArray, biosBuffers, romBytes, ext) {
    super.setRoms(uid, frontendArray, biosBuffers, romBytes, ext);
    this.game = this.RA_DIR + 'game.' + this.detectExtension(romBytes, ext);
  }

  // Large games are streamed: `romBytes` then only holds the start of the file.
  setLazyRom(url, size) {
    this.lazyRom = new LazyRom(url, size);
  }

  getRaConfigContents() {
    // Written to the EmulatorJS config location in prepareFileSystem().
    return null;
  }

  buildRetroArchConfig() {
    return [
      'autosave_interval = 60',
      'block_sram_overwrite = false',
      'audio_latency = 64',
      'audio_sync = true',
      'video_vsync = true',
      'video_smooth = false',
      'video_gpu_screenshot = false',
      `savefile_directory = "${SAVES_DIR}"`,
      `savestate_directory = "${HOME}/retroarch/userdata/states"`,
      'sort_savefiles_enable = false',
      'sort_savestates_enable = false',
    ].join('\n') + '\n';
  }

  mkdirs(FS, path) {
    let current = '';
    for (const part of path.split('/')) {
      if (!part) continue;
      current += '/' + part;
      try { FS.mkdir(current); } catch (e) { /* exists */ }
    }
  }

  prepareFileSystem(FS) {
    for (const dir of [
      HOME + '/.config/retroarch',
      HOME + '/retroarch/system',
      HOME + '/retroarch/userdata/system',
      HOME + '/retroarch/userdata/states',
      HOME + '/retroarch/userdata/shaders',
      HOME + '/retroarch/userdata/config',
      SHADER_CACHE_DIR,
      SAVES_DIR,
    ]) {
      this.mkdirs(FS, dir);
    }
    FS.writeFile(RA_CONFIG_PATH, this.buildRetroArchConfig());
  }

  installExports(module) {
    const noop = () => {};
    module.onShaderFailure = (failure) => this.shaderFailures.capture(failure, module);
    module._wrc_set_input = (controller, input, a0x, a0y, a1x, a1y) =>
      this.applyInput(module, controller, input, a0x, a0y, a1x, a1y);
    // This frontend sizes the drawing buffer itself: it watches the canvas and
    // uses its on-page size times the device pixel ratio. The wrapper's calls
    // set it to the on-page size alone, behind the frontend's back; whenever
    // that came last, the picture was drawn three times too large on a phone
    // and only a corner of it showed.
    module.setCanvasSize = noop;
    module._wrc_enable_bilinear_filter = noop;
    module._wrc_force_aspect_ratio = noop;
    module._wrc_set_options = noop;
    module._wrc_update_mouse = noop;
    module._wrc_cheat_toggle = noop;
    module._rwebaudio_enable = noop;
    module._cmd_audio_reinit = noop;
    module._cmd_audio_start = noop;
    module._cmd_audio_stop = noop;
    // Save states go through the file the wrapper reads and writes.
    const loadState = module.cwrap('load_state', 'number', ['string', 'number']);
    module._cmd_save_state = () => {
      try { module.FS.unlink(STATE_PATH); } catch (e) { /* none yet */ }
      module.wrcStateResult = null;
      try {
        this.crumb('save: creating state');
        const state = this.takeState(module);
        this.crumb('save: writing ' + state.length + ' bytes');
        // The file system keeps this array instead of copying it.
        module.FS.writeFile(STATE_PATH, state, { canOwn: true });
        this.crumb('save: storing ' + state.length + ' bytes (zip, upload)');
      } catch (e) {
        // No file means no state is stored. The core reports 2 while the game is
        // busy (loading); saveStateForSlot() then lets it run on and tries again.
        this.stateBusy = module.wrcStateResult === 2;
        LOG.error('Save state ' + (this.stateBusy ? 'postponed: ' : 'failed: ') + e);
        if (!this.stateBusy) this.showMessage('The save state could not be created.');
      }
    };
    // RetroArch reads the file and hands it to the core during a later frame, so
    // the outcome is only known afterwards: wait for it, retry while the game is busy.
    const requestLoad = (tries) => {
      module.wrcStateResult = null;
      loadState(STATE_PATH, 0);
      const started = Date.now();
      const timer = setInterval(() => {
        const result = module.wrcStateResult;
        if (result === null && Date.now() - started < 5000) return;
        clearInterval(timer);
        if (result !== 2 || tries <= 0) this.releaseStateFile();
        if (result === 2 && tries > 0) requestLoad(tries - 1);
        else if (result === 2) this.showMessage('The game is busy. Load the save state again in a few seconds.');
        else if (result === 0) this.showMessage('This save state was made by another version and cannot be loaded.');
      }, 100);
    };
    module._cmd_load_state = () => requestLoad(8);
    // RetroArch schedules its own frames; the wrapper's display loop only polls input.
    this.updateFrameTiming = () => {
      const context = module.RWA && module.RWA.context;
      if (!this.loopResumed || !context) return;
      if (this.timingAudioContext !== context) {
        if (this.timingAudioContext) {
          this.timingAudioContext.removeEventListener('statechange', this.updateFrameTiming);
        }
        this.timingAudioContext = context;
        context.addEventListener('statechange', this.updateFrameTiming);
      }
      // Audio paces emulation at the console rate. Waiting for another browser
      // animation frame after a slow frame unnecessarily drops to half speed.
      // Keep animation-frame pacing until audio is unlocked, avoiding runaway
      // emulation when there is no running audio clock to limit the loop.
      const vsync = context.state === 'running' ? 0 : 1;
      if (this.frameTiming !== vsync) {
        module._set_vsync(vsync);
        this.frameTiming = vsync;
      }
    };
    module._emscripten_mainloop = () => {
      if (!this.loopResumed) {
        this.loopResumed = true;
        if (module.resumeMainLoop) module.resumeMainLoop();
        this.updateFrameTiming();
      }
    };
  }

  // The core declines to save while the game is loading. Let the game run on
  // for a moment and try again, instead of leaving that to the player.
  async saveStateForSlot(slot) {
    const module = window.Module;
    try {
      for (let attempt = 0; ; attempt++) {
        this.stateBusy = false;
        this.crumb('save: attempt ' + (attempt + 1));
        const shot = await this.captureStateScreenshot(module);
        module._cmd_save_state();
        let result = false;
        if (!this.stateBusy) {
          try {
            const state = module.FS.readFile(STATE_PATH);
            const otherProps = {};
            this.updateSaveStateForSlotProps(slot, otherProps);
            await this.getSaveManager().saveState(
              this.saveStatePrefix, slot, state, null, this.saveMessageCallback,
              shot, {}, otherProps);
            result = true;
          } catch (error) {
            LOG.error('Error saving state: ' + error);
          }
        }
        if (!this.stateBusy) return result;
        if (attempt >= 2) {
          this.showMessage('The game cannot save a state right now. Try again in a few seconds.');
          return result;
        }
        module._toggleMainLoop(1);
        await new Promise((resolve) => setTimeout(resolve, 700));
        module._toggleMainLoop(0);
      }
    } finally {
      this.releaseStateFile();
      this.crumb(null);
    }
  }

  // WebGL may discard its drawing buffer after presentation. Capture once at
  // the end of an actual frame, instead of repeatedly reading the paused canvas.
  captureStateScreenshot(module) {
    if (this.pendingStateShot) return this.pendingStateShot.promise;
    const start = module._get_current_frame_count();
    let complete;
    const promise = new Promise((resolve) => { complete = resolve; });
    const finish = (shot) => {
      const pending = this.pendingStateShot;
      if (!pending || pending.promise !== promise) return;
      clearTimeout(pending.timer);
      this.pendingStateShot = null;
      module._toggleMainLoop(this.paused ? 0 : 1);
      complete(shot);
    };
    this.pendingStateShot = {
      start, promise, finish, timer: setTimeout(() => finish(null), 15000),
    };
    module._toggleMainLoop(1);
    return promise;
  }

  captureStateFrame() {
    const pending = this.pendingStateShot;
    const module = window.Module;
    if (!pending || !module || module._get_current_frame_count() <= pending.start) return;
    try {
      const canvas = this.canvas;
      if (!canvas || !canvas.width || !canvas.height) return;
      const shot = document.createElement('canvas');
      const scale = Math.min(1, 320 / Math.max(canvas.width, canvas.height));
      shot.width = Math.max(1, Math.round(canvas.width * scale));
      shot.height = Math.max(1, Math.round(canvas.height * scale));
      const context = shot.getContext('2d');
      context.drawImage(canvas, 0, 0, shot.width, shot.height);
      const pixels = context.getImageData(0, 0, shot.width, shot.height).data;
      // A discarded transparent buffer is not a usable thumbnail; try another frame.
      if (!pixels.some((value, index) => index % 4 === 3 && value !== 0)) return;
      pending.finish(shot.toDataURL('image/png'));
    } catch (error) {
      LOG.error('Save-state thumbnail: ' + error);
      pending.finish(null);
    }
  }

  // The frontend's own EmulatorJSGetState() frees the wrong pointer and so
  // leaves every state (some 20 MB) allocated in the core's memory for good.
  takeState(module) {
    const info = module._save_state_info();
    const [size, start, ok] = module.UTF8ToString(info).split('|');
    module._free(info);
    if (ok !== '1') throw new Error(size);
    const begin = parseInt(start, 10);
    const end = begin + parseInt(size, 10);
    try {
      // UTF8ToString above has refreshed the view if the memory grew.
      if (!(end > begin) || end > module.HEAPU8.length) throw new Error('State lies outside memory');
      return module.HEAPU8.slice(begin, end);
    } finally {
      module._free(begin);
    }
  }

  shaderCacheKey() {
    // Per game, and not per core revision: the core itself tells whether a
    // stored file still matches its shader generators.
    return `/wrc/3ds-shaders/${this.uid}`;
  }

  // Next to the game's saves in the cloud, one copy per kind of graphics driver.
  sharedShaderCachePath() {
    if (!this.graphicsTag) this.graphicsTag = graphicsTag();
    return `${this.saveStatePrefix}shaders-${this.graphicsTag}`;
  }

  // The copy other devices have added to, or null without a cloud account.
  async loadSharedShaderCache() {
    try {
      const manager = this.getSaveManager();
      if (!(await manager.isCloudEnabled(null))) return null;
      const files = await quietCloudManager(manager).loadCloud(this.sharedShaderCachePath());
      const file = (files || []).find((f) => f.name === SHADER_CACHE_NAME);
      return file && file.content instanceof Uint8Array ? file.content : null;
    } catch (e) {
      return null; // none stored yet
    }
  }

  async restoreShaderCache(FS) {
    try {
      let local = await this.getStorage().get(this.shaderCacheKey());
      // Core revision v15 stored it under its own name.
      if (!(local instanceof Uint8Array)) {
        local = await this.getStorage().get(`/wrc/3ds-shaders/iphone-20261008-v15/${this.uid}`);
      }
      if (!(local instanceof Uint8Array)) local = null;
      const shared = await this.loadSharedShaderCache();
      // A copy from another core build cannot be told apart before the core has
      // written its own stamp, so the browser's copy decides when there is one.
      const bytes = local ? mergeShaderCaches(local, shared) : shared;
      if (bytes && bytes.length) {
        FS.writeFile(SHADER_CACHE_PATH, bytes);
        this.shaderCacheSize = bytes.length;
      }
    } catch (e) {
      LOG.error('Shader cache not restored: ' + e);
    }
  }

  async storeShaderCache() {
    if (this.storingShaderCache) return;
    this.storingShaderCache = true;
    try {
      const { FS } = window;
      const size = FS.stat(SHADER_CACHE_PATH).size;
      const bytes = FS.readFile(SHADER_CACHE_PATH);
      if (size !== (this.shaderCacheSize || 0)) {
        await this.getStorage().put(this.shaderCacheKey(), bytes);
        this.shaderCacheSize = size;
      }
      const manager = this.getSaveManager();
      if (size !== this.shaderCloudSize && await manager.isCloudEnabled(null)) {
        // Another device may have added to the shared copy meanwhile.
        const merged = mergeShaderCaches(bytes, await this.loadSharedShaderCache());
        await quietCloudManager(manager).saveCloud(this.sharedShaderCachePath(),
          [{ name: SHADER_CACHE_NAME, content: merged }]);
        this.shaderCloudSize = size;
      }
    } catch (e) { /* no cache file, or storage unavailable */ } finally {
      this.storingShaderCache = false;
    }
  }

  // The state file is only a hand-over between the core and the wrapper; left
  // in the in-memory file system it would hold tens of megabytes for nothing.
  releaseStateFile() {
    try { window.Module.FS.unlink(STATE_PATH); } catch (e) { /* already gone */ }
  }

  // A note of what was in progress, kept across a page crash. The performance
  // readout shows the one left behind by the previous run.
  crumb(text) {
    try {
      if (text === null) localStorage.removeItem(CRUMB_KEY);
      else {
        const heap = window.Module ? Math.round(window.Module.HEAPU8.length / 1048576) : 0;
        localStorage.setItem(CRUMB_KEY, `${text}, heap ${heap} MB, ${new Date().toLocaleTimeString()}`);
      }
    } catch (e) { /* storage unavailable */ }
  }

  applyInput(module, controller, input, a0x, a0y, a1x, a1y) {
    const last = this.lastInput[controller] || { buttons: 0, axes: [0, 0, 0, 0, 0, 0, 0, 0] };
    const changed = last.buttons ^ input;
    if (changed) {
      for (const [name, id] of BUTTON_MAP) {
        const bit = this[name];
        if (changed & bit) module._simulate_input(controller, id, input & bit ? 1 : 0);
      }
      last.buttons = input;
    }
    // ids 16..23: left stick right/left/down/up, then right stick
    const scale = (v) => Math.min(ANALOG_MAX, Math.round(Math.abs(v) * ANALOG_MAX));
    const axes = [
      a0x > 0 ? scale(a0x) : 0, a0x < 0 ? scale(a0x) : 0,
      a0y > 0 ? scale(a0y) : 0, a0y < 0 ? scale(a0y) : 0,
      a1x > 0 ? scale(a1x) : 0, a1x < 0 ? scale(a1x) : 0,
      a1y > 0 ? scale(a1y) : 0, a1y < 0 ? scale(a1y) : 0,
    ];
    for (let i = 0; i < axes.length; i++) {
      if (axes[i] !== last.axes[i]) {
        module._simulate_input(controller, 16 + i, axes[i]);
        last.axes[i] = axes[i];
      }
    }
    this.lastInput[controller] = last;
  }

  async loadEmscriptenModule(canvas) {
    const { app } = this;
    this.coreBase = CORE_BASE;
    const scriptUrl = this.getScriptUrl();

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.onerror = () => reject(new Error('Unable to load ' + scriptUrl));
      script.onload = () => {
        const options = {
          canvas: canvas,
          // RetroArch registers its keyboard listeners on this element. Keep it detached:
          // input comes from the webЯcade controllers, and RetroArch swallows key releases.
          parent: document.createElement('div'),
          noInitialRun: true,
          arguments: [],
          preRun: [],
          postRun: [],
          callbacks: {},
          totalDependencies: 0,
          print: (text) => console.log(text),
          printErr: (text) => {
            if (('' + text).toLowerCase().includes('error')) console.error(text); else console.log(text);
          },
          onAbort: (msg) => { this.crumb('core aborted: ' + msg); app.exit(msg); },
          onExit: () => app.exit(),
          locateFile: (name) => this.coreBase + name,
          getSavExt: () => '.srm',
          getInputText: requestGameText,
        };
        // Audio paces the game at the console's rate. Without running audio the
        // loop follows the display, which is 120 Hz on some phones: hold it to
        // the 3DS frame rate ourselves by skipping iterations that come early.
        options.preMainLoop = () => {
          const context = window.Module && window.Module.RWA && window.Module.RWA.context;
          if (context && context.state === 'running') return undefined;
          const now = performance.now();
          if (now < this.nextFrameAt) return false;
          this.nextFrameAt = Math.max((this.nextFrameAt || now) + FRAME_MS, now);
          return undefined;
        };
        // Comparison switch from the library's Experimental Settings: run lit
        // draws' vertex programs on the CPU, as before core v12.
        try {
          options.wrcLitOnCpu = localStorage.getItem('wrcad.3ds.litcpu.v1') === '1';
          // Test aid: pretend every program takes this many ms to build.
          options.wrcLinkDelay = Number(localStorage.getItem('wrcad.3ds.linkdelay.v1')) || 0;
        } catch (e) { /* storage unavailable */ }
        let unfinished = null;
        try {
          unfinished = localStorage.getItem(CRUMB_KEY);
          localStorage.removeItem(CRUMB_KEY);
        } catch (e) { /* storage unavailable */ }
        if (unfinished) {
          // Leave the note in the web server's access log (the address does not
          // exist; a 404 is expected), so a crash can be looked into afterwards.
          fetch('/touch-controls/3ds-crash-note?' + new URLSearchParams({
            core: CORE_REVISION, note: unfinished,
          })).catch(() => {});
        }
        if (perfEnabled()) {
          this.perf = new PerfReadout(this.coreBase.split('/')[1], unfinished);
          this.perf.options(options);
        }
        const postFrame = options.postMainLoop;
        options.postMainLoop = () => {
          if (postFrame) postFrame();
          this.captureStateFrame();
        };
        window.EJS_Runtime(options).then((module) => {
          window.Module = module;
          window.FS = module.FS;
          module.callbacks.setupCoreSettingFile = (path) => {
            try {
              this.mkdirs(module.FS, path.substring(0, path.lastIndexOf('/')));
              module.FS.writeFile(path, this.getCoreOptions());
            } catch (e) {
              LOG.error(e);
            }
          };
          this.prepareFileSystem(module.FS);
          this.installExports(module);
          if (this.perf) this.perf.start(module);
          this.resumeAudio = () => {
            const context = module.RWA && module.RWA.context;
            if (context && context.state !== 'closed' && context.state !== 'running') {
              context.resume().catch(() => {});
            }
          };
          // Capture receives gestures even when the touch pad stops propagation.
          for (const event of ['pointerdown', 'touchend', 'keydown']) {
            document.addEventListener(event, this.resumeAudio, true);
          }
          this.preInit(module.FS);
          this.setShowMessageEnabled(true);
          this.audioPlaying = true;
          resolve();
        }).catch(reject);
      };
      document.body.appendChild(script);
      script.src = scriptUrl;
    });
  }

  getCoreOptions() {
    return [
      'citra_resolution_factor = "1"',
      'citra_analog_function = "c_stick"',
      `citra_layout_option = "${VIEWS[this.view].layout}"`,
      `citra_swap_screen = "${VIEWS[this.view].screen}"`,
      'citra_mouse_touchscreen = "enabled"',
      'citra_touch_touchscreen = "enabled"',
      'citra_render_touchscreen = "disabled"',
      'citra_use_hw_shaders = "enabled"',
      // New 3DS-only games refuse to start otherwise; it costs no extra memory.
      'citra_is_new_3ds = "New 3DS"',
    ].join('\n') + '\n';
  }

  async createDisplayLoop(debug) {
    return new DisplayLoop(60, true, debug, false, false);
  }

  onPause(p) {
    const { Module } = window;
    if (!p && this.resumeAudio) this.resumeAudio();
    if (Module && Module._toggleMainLoop) {
      Module._toggleMainLoop(p ? 0 : 1);
    }
  }

  // Filtering and shaders go through exports this RetroArch port does not have.
  getBilinearModeSupported() {
    return false;
  }

  updateBilinearFilter() {}

  resizeScreen(canvas) {
    this.canvas = canvas;
    this.updateScreenSize();
  }

  onFrame() {}

  collectFiles(FS, dir, prefix, out) {
    let names = [];
    try { names = FS.readdir(dir); } catch (e) { return; }
    for (const name of names) {
      if (name === '.' || name === '..') continue;
      const path = dir + '/' + name;
      if (FS.isDir(FS.stat(path).mode)) {
        this.collectFiles(FS, path, prefix + name + '/', out);
      } else {
        out.push({ name: prefix + name, content: FS.readFile(path) });
      }
    }
  }

  async saveState() {
    const { saveStatePath, started } = this;
    const { FS } = window;

    // Not awaited: this runs when the pause menu opens, which must not wait for
    // a cache upload.
    if (started) {
      this.storeShaderCache();
      this.shaderFailures.flush().catch(() => {});
    }
    try {
      if (!started || !saveStatePath) {
        return;
      }

      const files = [];
      for (const root of SAVE_ROOTS) {
        this.collectFiles(FS, USER_DIR + '/' + root, root + '/', files);
      }

      if (files.length > 0) {
        if (await this.getSaveManager().checkFilesChanged(files)) {
          await this.getSaveManager().save(
            saveStatePath,
            files,
            this.saveMessageCallback,
          );
        }
      }
    } catch (e) {
      LOG.error('Error persisting save state: ' + e);
    }
  }

  async loadState() {
    // The game is known by now and the core has not started yet.
    await installSystemKeys(window.FS, USER_DIR + '/sysdata', window.WrcadCloudConfig);
    await this.restoreShaderCache(window.FS);
    await this.shaderFailures.restore();
    const { saveStatePath } = this;
    const { FS } = window;

    // First hook after the wrapper has written the game file
    if (this.lazyRom) {
      this.lazyRom.mount(FS, this.game);
    }

    try {
      const files = await this.getSaveManager().load(
        saveStatePath,
        this.loadMessageCallback,
      );

      if (files) {
        for (const f of files) {
          if (!SAVE_ROOTS.some((root) => f.name.startsWith(root + '/'))) continue;
          const path = USER_DIR + '/' + f.name;
          this.mkdirs(FS, path.substring(0, path.lastIndexOf('/')));
          FS.writeFile(path, f.content);
        }

        // Cache the initial files
        await this.getSaveManager().checkFilesChanged(files);
      }
    } catch (e) {
      LOG.error('Error loading save state: ' + e);
    }
  }
}
