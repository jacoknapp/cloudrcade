import { RetroAppWrapper, DisplayLoop, LOG } from '@webrcade/app-common';
import { Prefs } from './prefs';
import { LazyRom } from './lazyrom';

const HOME = '/home/web_user';
const SAVES = HOME + '/retroarch/userdata/saves';
const USER = SAVES + '/PSP';
const STATE = HOME + '/retroarch/userdata/states/game.state';
const CORE_BASE = 'js/experimental-v1/';
const SAVE_ROOTS = ['SAVEDATA'];
// Standard gamepad positions: cross, square, circle, triangle.
const BUTTONS = [['INP_A', 0], ['INP_X', 1], ['INP_SELECT', 2], ['INP_START', 3],
  ['INP_UP', 4], ['INP_DOWN', 5], ['INP_LEFT', 6], ['INP_RIGHT', 7],
  ['INP_B', 8], ['INP_Y', 9], ['INP_LBUMP', 10], ['INP_RBUMP', 11]];

export class Emulator extends RetroAppWrapper {
  VIDEO_WIDTH = 480;
  VIDEO_HEIGHT = 272;
  SAVE_NAME = 'sav';

  constructor(app, debug = false) {
    super(app, debug);
    window.emulator = this;
    this.prefs = new Prefs(this);
    this.analogMode = true;
    this.lastInput = {};
  }
  getPrefs() { return this.prefs; }
  getScriptUrl() { return CORE_BASE + 'ppsspp_libretro.js'; }
  getDefaultAspectRatio() { return 480 / 272; }
  getShotAspectRatio() { return this.getDefaultAspectRatio(); }
  isForceAspectRatio() { return true; }
  isEscapeHackEnabled() { return false; }
  getRaConfigContents() { return null; }
  getBilinearModeSupported() { return false; }
  updateBilinearFilter() {}
  onFrame() {}
  resizeScreen(canvas) { this.canvas = canvas; this.updateScreenSize(); }
  async createDisplayLoop(debug) { return new DisplayLoop(60, true, debug, false, false); }

  setRoms(uid, frontend, bios, bytes, ext) {
    super.setRoms(uid, frontend, bios, bytes, ext);
    if (!['iso', 'cso', 'pbp', 'elf'].includes((ext || '').toLowerCase())) {
      // Archive imports may omit the original extension.
      const magic = Array.from(bytes.slice(0, 4));
      ext = magic.join(',') === '0,80,66,80' ? 'pbp' :
        magic.join(',') === '67,73,83,79' ? 'cso' :
        magic.join(',') === '127,69,76,70' ? 'elf' : 'iso';
    }
    this.game = this.RA_DIR + 'game.' + ext.toLowerCase();
  }
  setLazyRom(url, size) { this.lazyRom = new LazyRom(url, size); }
  mkdirs(FS, path) {
    let current = '';
    for (const part of path.split('/').filter(Boolean)) {
      current += '/' + part;
      if (!FS.analyzePath(current).exists) FS.mkdir(current);
    }
  }

  async installAssets(FS) {
    const manifest = await fetch('assets/manifest.json');
    if (!manifest.ok) throw new Error('Unable to load PSP system assets.');
    const files = await manifest.json();
    // Batch requests to avoid overwhelming the browser with hundreds of files.
    for (let i = 0; i < files.length; i += 8) {
      await Promise.all(files.slice(i, i + 8).map(async (name) => {
        const response = await fetch('assets/' + name.split('/').map(encodeURIComponent).join('/'));
        if (!response.ok) throw new Error('Missing PSP asset: ' + name);
        const path = '/PPSSPP/' + name;
        this.mkdirs(FS, path.substring(0, path.lastIndexOf('/')));
        FS.writeFile(path, new Uint8Array(await response.arrayBuffer()));
      }));
    }
  }

  prepareFileSystem(FS) {
    for (const path of [HOME + '/.config/retroarch', HOME + '/retroarch/system',
      HOME + '/retroarch/userdata/system', HOME + '/retroarch/userdata/states',
      HOME + '/retroarch/userdata/shaders', HOME + '/retroarch/userdata/config', USER]) this.mkdirs(FS, path);
    // The core reads system assets from /PPSSPP. Save data is separate.
    FS.writeFile(HOME + '/.config/retroarch/retroarch.cfg', [
      'system_directory = "/"', `savefile_directory = "${SAVES}"`,
      `savestate_directory = "${HOME}/retroarch/userdata/states"`,
      'sort_savefiles_enable = false', 'sort_savestates_enable = false',
      'video_smooth = false', 'video_vsync = true', 'audio_sync = true', 'audio_latency = 64',
    ].join('\n') + '\n');
  }

  applyInput(module, controller, input, x, y) {
    const last = this.lastInput[controller] || {buttons: 0, axes: [0, 0, 0, 0]};
    for (const [name, id] of BUTTONS) {
      const bit = this[name];
      if ((last.buttons ^ input) & bit) module._simulate_input(controller, id, input & bit ? 1 : 0);
    }
    last.buttons = input;
    const scale = (n) => Math.min(32767, Math.round(Math.abs(n) * 32767));
    const axes = [x > 0 ? scale(x) : 0, x < 0 ? scale(x) : 0,
      y > 0 ? scale(y) : 0, y < 0 ? scale(y) : 0];
    axes.forEach((value, i) => {
      if (last.axes[i] !== value) module._simulate_input(controller, 16 + i, value);
    });
    last.axes = axes;
    this.lastInput[controller] = last;
  }

  installExports(module) {
    const noop = () => {};
    module._wrc_set_input = (...args) => this.applyInput(module, ...args);
    for (const name of ['setCanvasSize', '_wrc_enable_bilinear_filter', '_wrc_force_aspect_ratio',
      '_wrc_set_options', '_wrc_update_mouse', '_wrc_cheat_toggle', '_rwebaudio_enable',
      '_cmd_audio_reinit', '_cmd_audio_start', '_cmd_audio_stop']) module[name] = noop;
    module._cmd_load_state = () => module.cwrap('load_state', 'number', ['string', 'number'])(STATE, 0);
    module._emscripten_mainloop = () => {
      if (!this.loopResumed) {
        this.loopResumed = true;
        if (module.resumeMainLoop) module.resumeMainLoop();
      }
    };
  }

  async loadEmscriptenModule(canvas) {
    const prefix = window.WrcadCloudConfig?.storagePrefix || 'webrcade';
    if (localStorage.getItem(prefix + '.psp.enabled.v1') !== '1') {
      throw new Error('Enable PSP in Experimental Settings to play this game.');
    }
    if (!window.crossOriginIsolated || typeof SharedArrayBuffer !== 'function') {
      throw new Error('Experimental PSP support requires HTTPS and cross-origin isolation.');
    }
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) throw new Error('Experimental PSP support requires WebGL2.');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.onload = resolve;
      script.onerror = () => reject(new Error('Unable to load the PSP core.'));
      script.src = this.getScriptUrl();
      document.body.appendChild(script);
    });
    const module = await window.EJS_Runtime({
      canvas, parent: document.createElement('div'), noInitialRun: true, arguments: [],
      preRun: [], postRun: [], callbacks: {}, totalDependencies: 0,
      locateFile: (name) => CORE_BASE + name, getSavExt: () => '.srm',
      print: console.log, printErr: console.log,
      onAbort: (message) => this.app.exit('PSP core error: ' + message),
      onExit: () => this.app.exit(),
      postMainLoop: () => this.captureStateFrame(),
    });
    window.Module = module;
    window.FS = module.FS;
    module.callbacks.setupCoreSettingFile = (path) => {
      this.mkdirs(module.FS, path.substring(0, path.lastIndexOf('/')));
      module.FS.writeFile(path, 'ppsspp_cpu_core = "IR JIT"\nppsspp_internal_resolution = "480x272"\nppsspp_cache_iso = "disabled"\n');
    };
    this.prepareFileSystem(module.FS);
    await this.installAssets(module.FS);
    this.installExports(module);
    this.resumeAudio = () => {
      const context = module.RWA?.context;
      if (context && context.state !== 'closed' && context.state !== 'running') context.resume().catch(() => {});
    };
    for (const event of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(event, this.resumeAudio, true);
    this.preInit(module.FS);
    this.setShowMessageEnabled(true);
    this.audioPlaying = true;
  }

  onPause(paused) {
    if (!paused) this.resumeAudio?.();
    window.Module?._toggleMainLoop(paused ? 0 : 1);
  }

  collectFiles(FS, dir, prefix, out) {
    if (!FS.analyzePath(dir).exists) return;
    for (const name of FS.readdir(dir).filter((n) => n !== '.' && n !== '..')) {
      const path = dir + '/' + name;
      if (FS.isDir(FS.stat(path).mode)) this.collectFiles(FS, path, prefix + name + '/', out);
      else out.push({name: prefix + name, content: FS.readFile(path)});
    }
  }
  async saveState() {
    if (!this.started || !this.saveStatePath) return;
    const files = [];
    for (const root of SAVE_ROOTS) this.collectFiles(window.FS, USER + '/' + root, root + '/', files);
    if (files.length && await this.getSaveManager().checkFilesChanged(files)) {
      await this.getSaveManager().save(this.saveStatePath, files, this.saveMessageCallback);
    }
  }
  async loadState() {
    if (this.lazyRom) this.lazyRom.mount(window.FS, this.game);
    const files = await this.getSaveManager().load(this.saveStatePath, this.loadMessageCallback);
    for (const file of files || []) {
      // Cloud ZIPs never choose arbitrary runtime filesystem paths.
      if (!SAVE_ROOTS.some((root) => file.name.startsWith(root + '/')) ||
          file.name.split('/').some((part) => part === '..' || part === '.')) continue;
      const path = USER + '/' + file.name;
      this.mkdirs(window.FS, path.substring(0, path.lastIndexOf('/')));
      window.FS.writeFile(path, file.content);
    }
    if (files) await this.getSaveManager().checkFilesChanged(files);
  }

  async saveStateForSlot(slot) {
    const module = window.Module;
    const shot = await this.captureStateScreenshot(module);
    const info = module._save_state_info();
    const [length, address, ok] = module.UTF8ToString(info).split('|');
    module._free(info);
    if (ok !== '1') throw new Error('The PSP save state could not be created.');
    const pointer = Number(address), size = Number(length);
    let state;
    try {
      if (!(size > 0) || pointer < 0 || pointer + size > module.HEAPU8.length) throw new Error('Invalid PSP save state.');
      state = module.HEAPU8.slice(pointer, pointer + size);
    } finally { module._free(pointer); }
    await this.getSaveManager().saveState(this.saveStatePrefix, slot, state, null,
      this.saveMessageCallback, shot, {aspectRatio: String(this.getShotAspectRatio())}, {});
    return true;
  }

  captureStateScreenshot(module) {
    const start = module._get_current_frame_count();
    return new Promise((resolve) => {
      const finish = (shot) => {
        if (!this.pendingStateShot) return;
        clearTimeout(this.pendingStateShot.timer);
        this.pendingStateShot = null;
        module._toggleMainLoop(this.paused ? 0 : 1);
        resolve(shot);
      };
      this.pendingStateShot = {start, finish, timer: setTimeout(() => finish(null), 5000)};
      module._toggleMainLoop(1);
    });
  }
  captureStateFrame() {
    const pending = this.pendingStateShot;
    if (!pending || window.Module._get_current_frame_count() <= pending.start) return;
    try {
      const shot = document.createElement('canvas');
      shot.width = 320; shot.height = Math.round(320 / this.getShotAspectRatio());
      const context = shot.getContext('2d');
      context.drawImage(this.canvas, 0, 0, shot.width, shot.height);
      const pixels = context.getImageData(0, 0, shot.width, shot.height).data;
      if (!pixels.some((value, i) => i % 4 === 3 && value !== 0)) return;
      pending.finish(shot.toDataURL('image/png'));
    } catch (error) { LOG.error(error); pending.finish(null); }
  }

  async dispose() {
    this.pendingStateShot?.finish(null);
    const module = window.Module;
    try { module?._toggleMainLoop(0); module?.PThread?.terminateAllThreads(); } catch (_) { /* aborted core */ }
    this.lazyRom?.chunks.clear();
    for (const event of ['pointerdown', 'touchend', 'keydown']) document.removeEventListener(event, this.resumeAudio, true);
    const context = module?.RWA?.context;
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }
}
