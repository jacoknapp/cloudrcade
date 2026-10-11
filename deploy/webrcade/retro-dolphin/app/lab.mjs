import {GameCubeSession, inspectDisc} from './session.mjs';
import {KEYS, padState} from './input.mjs';
import {remoteDisc} from './transport.mjs';

const get = id => document.getElementById(id);
let canvas = get('screen');
let session = null, selected = null, busy = false, animation = null, generation = 0;
const pressed = new Set();
const input = {};
let selectionAbort = null;
function status(text) { get('status').textContent = text; }
function controls() {
  get('initialize').disabled = busy || !!session;
  get('disc').disabled = busy || !!session?.booted;
  get('url').disabled = busy || !!session?.booted;
  get('selectUrl').disabled = busy || !!session?.booted;
  get('boot').disabled = busy || !selected || !!session?.booted;
  get('pause').disabled = busy || !session?.booted;
  get('close').disabled = !session && !busy;
  get('pause').textContent = session?.paused ? 'Resume' : 'Pause';
}
function close() {
  generation++;
  selectionAbort?.abort(); selectionAbort = null;
  if (animation !== null) cancelAnimationFrame(animation);
  animation = null;
  session?.dispose(); session = null;
  pressed.clear(); busy = false;
  const replacement = canvas.cloneNode(); canvas.replaceWith(replacement); canvas = replacement;
  status('Core is stopped.'); controls();
}
async function perform(action) {
  if (busy) return;
  busy = true;
  if (!session) {
    const current = generation;
    session = new GameCubeSession({canvas,onStatus:text=>{if (current === generation) status(text);}});
  }
  const owned = session;
  const current = generation;
  controls();
  try { await action(owned); }
  catch (error) {
    if (current === generation) { close(); status(error.message); }
  } finally { if (current === generation) { busy = false; controls(); } }
}
get('initialize').onclick = () => perform(async owned => {
  status('Initializing experimental Dolphin core…');
  await owned.initialize();
  if (session === owned) status('Dolphin initialized. Select a disc to boot.');
});
async function select(load) {
  if (busy || session?.booted) return;
  busy = true; selected = null;
  const current = generation;
  const abort = selectionAbort = new AbortController();
  controls();
  try {
    const disc = await load(abort.signal);
    if (current !== generation || abort.signal.aborted) return;
    selected = disc;
    status(`Selected ${disc.name}${disc.remote ? ' — HTTP range streaming' : ''}.`);
  } catch (error) { if (current === generation) status(error.message); }
  finally { if (current === generation) { selectionAbort = null; busy = false; controls(); } }
}
get('disc').onchange = event => {
  const file = event.target.files[0];
  if (!file) { selected = null; controls(); return; }
  select(async()=>{ await inspectDisc(file); return file; });
};
get('selectUrl').onclick = () => select(signal => {
  status('Checking GameCube disc URL…');
  return remoteDisc(get('url').value,{signal});
});
function stopFrames() {
  if (animation !== null) cancelAnimationFrame(animation);
  animation = null;
}
function pause() { pressed.clear(); session?.pause(); stopFrames(); controls(); }
function startFrames() { if (animation === null) animation = requestAnimationFrame(frame); }
function frame() {
  animation = null;
  if (!session?.booted || session.paused) return;
  let gamepad = null;
  for (const pad of navigator.getGamepads?.() || []) {
    if (pad?.connected && pad.mapping === 'standard') { gamepad = pad; break; }
  }
  session.setInput(padState(pressed, gamepad, input)); session.poll();
  // Dolphin's WebGPU renderer owns the OffscreenCanvas; never rasterize on the CPU.
  animation = requestAnimationFrame(frame);
}
get('boot').onclick = () => perform(async owned => {
  status('Booting experimental GameCube core…');
  const metadata = await owned.boot(selected);
  if (session !== owned) return;
  status(`Running ${metadata.title || metadata.gameId}. Experimental compatibility.`);
  canvas.tabIndex = 0; canvas.focus();
  startFrames();
});
get('pause').onclick = () => {
  if (session?.paused) { session.resume(); canvas.focus(); startFrames(); controls(); }
  else pause();
};
get('close').onclick = close;
addEventListener('keydown', event => {
  if (!session?.booted || session.paused || event.target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName)) return;
  if (KEYS[event.code]) { pressed.add(KEYS[event.code]); event.preventDefault(); }
});
addEventListener('keyup', event => { if (KEYS[event.code]) pressed.delete(KEYS[event.code]); });
addEventListener('blur', pause);
addEventListener('pagehide', close);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
fetch('core-info.json').then(r => r.json()).then(info => {
  get('details').textContent = `Pinned upstream Dolphin core ${info.commit.slice(0,7)}; native source build pending qualification.`;
}).catch(() => {});
controls();
