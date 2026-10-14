/* GameCube-only, per-tab interruption evidence. No saves or network reporting. */
(() => {
  'use strict';
  const KEY = 'wrcad.gamecube.active.v1';
  const phases = new Set(['starting', 'playing', 'paused', 'saving state', 'loading state', 'closing', 'failed']);
  let record = null, lastWrite = 0;
  const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
  const clear = () => { try { sessionStorage.removeItem(KEY); } catch {} record = null; };
  function write() {
    if (!record) return;
    record.updated = Date.now();
    try { sessionStorage.setItem(KEY, JSON.stringify(record)); } catch {}
    lastWrite = performance.now();
  }
  window.WrcadGameCubeRecovery = {
    begin() { record = {version:1, started:Date.now(), phase:'starting'}; write(); },
    identify(gameId, core) {
      if (!record) return;
      if (/^[A-Z0-9]{6}$/.test(gameId)) record.game = gameId;
      if (/^[a-f0-9]{64}$/.test(core)) record.core = core.slice(0, 12);
      write();
    },
    phase(value) { if (record && phases.has(value) && record.phase !== value) { record.phase = value; write(); } },
    sample(frame) {
      if (!record || performance.now() - lastWrite < 5000) return;
      const d = frame.gamecubeDiagnostics || {}, r = d.resources || {};
      const sample = {
        frame:frame.frame, rendered:d.render?.frames, lastPresentMs:d.render?.ageMs,
        heapMiB:frame.heapBytes / 1048576, compiled:d.compiled, textures:r.textures,
        bindings:r.bindGroups, shaders:r.shaderOk, failedShaders:r.shaderFail,
        backlog:d.backlog, discWaitMaxMs:d.stream?.waitMaxMs,
      };
      record.sample = Object.fromEntries(Object.entries(sample).filter(([,v]) => Number.isFinite(v)).map(([k,v]) => [k, Math.round(v)]));
      write();
    },
    clear,
  };
  // Only the library consumes an interrupted session; core frames just record.
  if (window !== window.top || !/^\/play\/?$/.test(location.pathname)) return;
  function recover() {
    if (document.getElementById('webrcade-app-iframe') || document.getElementById('gamecube-recovery')) return;
    const previous = read();
    if (!previous) return;
    clear();
    if (previous.version !== 1 || !phases.has(previous.phase) ||
        !Number.isFinite(previous.updated) || Date.now() - previous.updated > 86400000) return;
    const box = document.createElement('aside');
    box.id = 'gamecube-recovery'; box.setAttribute('role', 'status');
    box.style.cssText = 'position:fixed;z-index:2147483647;top:max(12px,env(safe-area-inset-top));left:12px;right:12px;max-width:560px;margin:auto;padding:16px;box-sizing:border-box;border:1px solid #69dec8;border-radius:12px;background:#111b30;color:#eee;font:15px/1.4 system-ui;max-height:70vh;overflow:auto';
    const title = document.createElement('strong'); title.textContent = 'GameCube session interrupted';
    const message = document.createElement('p');
    message.textContent = 'The game ended without completing a normal exit. A browser reload or crash can cause this. The exact cause is unknown.';
    const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
    summary.textContent = 'Last session details';
    pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace';
    // Whitelist persisted fields again; storage is not trusted HTML or telemetry.
    const lines = [`Last activity: ${previous.phase}`, `Recorded: ${new Date(previous.updated).toISOString()}`];
    if (/^[A-Z0-9]{6}$/.test(previous.game)) lines.push(`Game: ${previous.game}`);
    if (/^[a-f0-9]{12}$/.test(previous.core)) lines.push(`Core: ${previous.core}`);
    if (Number.isFinite(previous.started)) lines.push(`Session: ${Math.max(0, Math.round((previous.updated - previous.started) / 1000))} seconds`);
    for (const key of ['frame','rendered','lastPresentMs','heapMiB','compiled','textures','bindings','shaders','failedShaders','backlog','discWaitMaxMs']) {
      if (Number.isFinite(previous.sample?.[key])) lines.push(`${key}: ${previous.sample[key]}`);
    }
    lines.push('Core heap excludes browser, compiled code and GPU memory. Details stay in this tab.');
    pre.textContent = lines.join('\n'); details.append(summary, pre);
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Dismiss';
    dismiss.style.cssText = 'margin-top:12px;padding:8px 18px;border-radius:20px;border:1px solid #61708a;background:#1c2941;color:#fff;font:inherit';
    dismiss.onclick = () => box.remove();
    box.append(title, message, details, dismiss); document.body.append(box);
  }
  function watch() {
    recover();
    let hadFrame = !!document.getElementById('webrcade-app-iframe');
    new MutationObserver(() => {
      const hasFrame = !!document.getElementById('webrcade-app-iframe');
      if (hadFrame && !hasFrame) recover();
      hadFrame = hasFrame;
    }).observe(document.body, {childList:true, subtree:true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, {once:true}); else watch();
})();
