import {GameCubeSession, inspectDisc} from './session.mjs';
import {KEYS, padState} from './input.mjs';
import {remoteDisc} from './transport.mjs';

const get = id => document.getElementById(id);
let canvas = get('screen');
let session = null, selected = null, busy = false, animation = null, generation = 0;
const pressed = new Set();
function status(text) { get('status').textContent = text; }
function controls() {
  get('initialize').disabled = busy || !!session;
  get('disc').disabled = busy || !!session?.booted;
  get('url').disabled = busy || !!session?.booted;
  get('selectUrl').disabled = busy || !!session?.booted;
  get('boot').disabled = busy || !selected || !!session?.booted;
  get('pause').disabled = busy || !session?.booted;
  get('close').disabled = !session;
  get('pause').textContent = session?.paused ? 'Resume' : 'Pause';
}
function close() {
  generation++;
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
  if (!session) session = new GameCubeSession({canvas,onStatus: status});
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
get('disc').onchange = async event => {
  selected = null; controls();
  const file = event.target.files[0];
  if (!file) return;
  try {
    const disc = await inspectDisc(file);
    selected = file; status(`Selected ${disc.gameId} (${(disc.size / 1048576).toFixed(1)} MiB).`);
  } catch (error) { status(error.message); }
  controls();
};
get('selectUrl').onclick = async () => {
  if (busy) return;
  busy = true; selected = null; controls();
  const current = generation;
  try {
    status('Checking GameCube disc URL…');
    const disc = await remoteDisc(get('url').value);
    if (current !== generation) return;
    selected = disc;
    status(`Selected ${disc.name}${disc.remote ? ' — HTTP range streaming' : ''}.`);
  } catch (error) { if (current === generation) status(error.message); }
  finally { if (current === generation) { busy = false; controls(); } }
};
function frame() {
  if (!session?.booted) return;
  const gamepad = Array.from(navigator.getGamepads?.() || []).find(p => p?.connected && p.mapping === 'standard');
  session.setInput(padState(pressed, gamepad)); session.poll();
  // Dolphin's WebGPU renderer owns the OffscreenCanvas; never rasterize on the CPU.
  animation = requestAnimationFrame(frame);
}
get('boot').onclick = () => perform(async owned => {
  status('Booting experimental GameCube core…');
  const metadata = await owned.boot(selected);
  if (session !== owned) return;
  status(`Running ${metadata.title || metadata.gameId}. Experimental compatibility.`);
  animation = requestAnimationFrame(frame);
});
get('pause').onclick = () => { session?.paused ? session.resume() : session?.pause(); controls(); };
get('close').onclick = close;
addEventListener('keydown', event => {
  if (!session?.booted || /^(INPUT|BUTTON)$/.test(event.target?.tagName)) return;
  if (KEYS[event.code]) { pressed.add(KEYS[event.code]); event.preventDefault(); }
});
addEventListener('keyup', event => { if (KEYS[event.code]) pressed.delete(KEYS[event.code]); });
addEventListener('blur', () => { pressed.clear(); session?.pause(); controls(); });
addEventListener('pagehide', close);
document.addEventListener('visibilitychange', () => { if (document.hidden) { pressed.clear(); session?.pause(); controls(); } });
fetch('core-info.json').then(r => r.json()).then(info => {
  get('details').textContent = `Pinned upstream Dolphin core ${info.commit.slice(0,7)}; native source build pending qualification.`;
}).catch(() => {});
controls();
