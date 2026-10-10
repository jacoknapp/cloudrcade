// On-device rendering check, started from diag.html. It replays one scene with
// the lit fragment shaders showing their inputs one at a time, and puts the
// results side by side for a screenshot. Nothing is saved while it runs.
const KEY = 'wrcad.3ds.diag.v1';
const MODES = [
  ['normal', null],
  ['texture 0', 'sampleTexUnit0().rgb'],
  ['texture 1', 'sampleTexUnit1().rgb'],
  ['light', 'primary_fragment_color.rgb'],
  ['fog amount', 'vec3(FOG)'],
  ['fog colour', 'fog_color.rgb'],
  ['diffuse', 'light_src[0].diffuse * dot_product'],
  ['ambient', 'light_src[0].ambient + lighting_global_ambient'],
  ['normal vec', 'normal * 0.5 + 0.5'],
  ['vertex col', 'rounded_primary_color.rgb'],
  ['coords 0', 'vec3(fract(texcoord0), 0.0)'],
  ['coords 1', 'vec3(fract(texcoord1), 0.0)'],
];
const END = 'color = combiner_output;';

export const diagScene = () => {
  try {
    return localStorage.getItem(KEY);
  } catch (e) {
    return null;
  }
};

const patch = (source) => {
  if (!source.includes(END) || !source.includes('vec3 frame_n')) return source;
  const fog = source.includes('float fog_factor') ? 'fog_factor' : '1.0';
  const lines = MODES.map(([, expr], i) => expr
    ? `if (wrc_dbg == ${i}) color = vec4(${expr.replace('FOG', fog)}, combiner_output.a);` : '');
  return source
    .replace('out vec4 color;', 'out vec4 color;\nuniform int wrc_dbg;')
    .replace(END, END + '\n' + lines.join('\n'));
};

export const installDiag = (emulator, scene) => {
  const state = { mode: 0, after: null, failed: new Map(), programs: 0 };
  const P = WebGL2RenderingContext.prototype;
  const { shaderSource, useProgram } = P;
  const locations = new WeakMap();
  P.shaderSource = function (shader, source) {
    return shaderSource.call(this, shader, patch(source));
  };
  P.useProgram = function (program) {
    useProgram.call(this, program);
    if (!program) return;
    let location = locations.get(program);
    if (location === undefined) {
      if (!this.getProgramParameter(program, this.LINK_STATUS)) {
        // Used although it did not link: this is what the check is looking for.
        if (!state.failed.has(program)) {
          state.failed.set(program, this.getProgramInfoLog(program) || 'no message');
        }
        return;
      }
      state.programs++;
      location = this.getUniformLocation(program, 'wrc_dbg');
      locations.set(program, location);
    }
    if (location) this.uniform1i(location, state.mode);
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => raf((time) => {
    callback(time);
    if (state.after) {
      const after = state.after;
      state.after = null;
      after();
    }
  });

  emulator.useView('stacked');
  emulator.setView = () => {};
  emulator.saveState = async () => {};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frame = () => new Promise((resolve) => { state.after = resolve; });

  const run = async () => {
    const note = document.createElement('div');
    note.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#000c;' +
      'color:#fff;font:14px -apple-system,sans-serif;padding:6px 10px;text-align:center';
    note.textContent = 'Rendering check: starting game…';
    document.body.appendChild(note);
    const frames = () => (window.Module && window.Module._get_current_frame_count
      ? window.Module._get_current_frame_count() : 0);
    while (frames() < 300) await wait(500);
    try { localStorage.removeItem(KEY); } catch (e) { /* one run only */ }
    note.textContent = 'Rendering check: loading scene…';
    const bytes = new Uint8Array(await (await fetch(`diag/${scene}.state`)).arrayBuffer());
    window.FS.writeFile('/home/web_user/retroarch/userdata/states/game.state', bytes);
    window.Module._cmd_load_state();
    await wait(12000);

    const canvas = document.querySelector('canvas');
    const tile = { w: 240, h: 150 };
    const sheet = document.createElement('canvas');
    sheet.width = tile.w * 3;
    sheet.height = (tile.h + 22) * 4 + 150;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.font = '16px -apple-system, sans-serif';
    for (let i = 0; i < MODES.length; i++) {
      note.textContent = `Rendering check: ${i + 1} of ${MODES.length}…`;
      state.mode = i;
      await wait(900);
      await frame();
      const x = (i % 3) * tile.w;
      const y = Math.floor(i / 3) * (tile.h + 22);
      // The middle of the top screen, where the scene's subject is.
      ctx.drawImage(canvas, canvas.width * 0.30, canvas.height * 0.09, canvas.width * 0.40,
        canvas.width * 0.40 * (tile.h / tile.w), x, y + 22, tile.w, tile.h);
      ctx.fillStyle = '#7f7';
      ctx.fillText(MODES[i][0], x + 4, y + 16);
    }
    state.mode = 0;
    const gl = window.Module.ctx;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    ctx.fillStyle = '#ccc';
    ctx.font = '12px -apple-system, sans-serif';
    const base = (tile.h + 22) * 4;
    // The core rejects failed programs before useProgram, so collect its
    // captured driver errors as well as failures from older cores.
    const rejected = window.Module.wrcShaderFailures || [];
    const logs = [...new Set([...state.failed.values(), ...rejected.map((failure) =>
      [failure.log, ...failure.shaders.map((shader) => shader.log)].filter(Boolean).join(' | '))])];
    const failedCount = state.failed.size + rejected.length;
    const text = [
      `${scene} · ${info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '?'} · ` +
        navigator.userAgent.slice(-40),
      `programs ok ${state.programs}  failed ${failedCount}  gl error ${gl.getError()}`,
    ];
    for (const log of logs.slice(0, 2)) {
      for (let at = 0; at < 240 && at < log.length; at += 80) text.push(log.slice(at, at + 80));
    }
    text.slice(0, 8).forEach((line, i) => ctx.fillText(line, 4, base + 16 + i * 17));
    window.wrcDiagResult = { failed: failedCount, programs: state.programs, logs };
    sheet.style.cssText = 'position:fixed;left:0;top:0;width:100vw;z-index:99999;background:#111';
    note.style.top = 'auto';
    note.style.bottom = '0';
    note.textContent = 'Done — take a screenshot of this.';
    document.body.appendChild(sheet);
  };
  run().catch((e) => {
    const failed = document.createElement('div');
    failed.style.cssText = 'position:fixed;left:0;top:40px;z-index:99999;color:#f77;background:#000';
    failed.textContent = 'Rendering check failed: ' + e;
    document.body.appendChild(failed);
  });
};
