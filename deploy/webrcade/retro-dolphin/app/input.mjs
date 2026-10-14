// Dolphin's pad bridge uses its own mask, independent from RetroArch's PSP input.
export const BUTTONS = Object.freeze({A:1, B:2, X:4, Y:8, START:16, L:32,
  R:64, Z:128, D_UP:256, D_DOWN:512, D_LEFT:1024, D_RIGHT:2048});
export const KEYS = Object.freeze({KeyX:'A', KeyZ:'B', KeyV:'X', KeyB:'Y',
  Enter:'START', KeyQ:'L', KeyE:'R', KeyC:'Z', ArrowUp:'D_UP', ArrowDown:'D_DOWN',
  ArrowLeft:'D_LEFT', ArrowRight:'D_RIGHT', KeyW:'STICK_UP', KeyS:'STICK_DOWN',
  KeyA:'STICK_LEFT', KeyD:'STICK_RIGHT', KeyI:'C_UP', KeyK:'C_DOWN',
  KeyJ:'C_LEFT', KeyL:'C_RIGHT'});
const PAD = {0:'A', 1:'B', 2:'X', 3:'Y', 4:'L', 5:'R', 8:'Z', 9:'START',
  12:'D_UP', 13:'D_DOWN', 14:'D_LEFT', 15:'D_RIGHT'};
const byte = value => Math.max(0, Math.min(255, Math.round(value)));
function axis(value = 0, invert = false) {
  if (!Number.isFinite(value) || Math.abs(value) <= .2) return 128;
  const scaled = Math.sign(value) * (Math.min(1, Math.abs(value)) - .2) / .8;
  return byte(128 + (invert ? -scaled : scaled) * 96);
}
const trigger = value => byte(Math.max(0, Math.min(1, Number(value) || 0)) * 255);

const PAD_BUTTONS = Object.entries(PAD);
const AXES = [['stickX','STICK_LEFT','STICK_RIGHT'], ['stickY','STICK_DOWN','STICK_UP'],
  ['cStickX','C_LEFT','C_RIGHT'], ['cStickY','C_DOWN','C_UP']];
const NO_KEYS = new Set();
export function padState(pressed = NO_KEYS, gamepad = null, state = {}) {
  if (gamepad?.mapping !== 'standard') gamepad = null;
  state.mask = 0;
  for (const button of pressed) state.mask |= BUTTONS[button] || 0;
  if (gamepad) for (const [index,name] of PAD_BUTTONS) {
    if (gamepad.buttons[index]?.pressed) state.mask |= BUTTONS[name];
  }
  state.stickX = axis(gamepad?.axes[0]); state.stickY = axis(gamepad?.axes[1],true);
  state.cStickX = axis(gamepad?.axes[2]); state.cStickY = axis(gamepad?.axes[3],true);
  state.triggerLeft = state.mask & BUTTONS.L ? 255 : trigger(gamepad?.buttons[6]?.value);
  state.triggerRight = state.mask & BUTTONS.R ? 255 : trigger(gamepad?.buttons[7]?.value);
  if (state.triggerLeft >= 128) state.mask |= BUTTONS.L;
  if (state.triggerRight >= 128) state.mask |= BUTTONS.R;
  state.analogA = state.mask & BUTTONS.A ? 255 : 0;
  state.analogB = state.mask & BUTTONS.B ? 255 : 0;
  for (const [field,negative,positive] of AXES) {
    if (pressed.has(negative) || pressed.has(positive)) {
      state[field] = pressed.has(negative) === pressed.has(positive) ? 128 : pressed.has(positive) ? 224 : 32;
    }
  }
  return state;
}
