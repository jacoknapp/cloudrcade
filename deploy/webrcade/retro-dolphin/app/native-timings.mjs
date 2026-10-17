// Native wall-clock phases. Compilation and blocked waits are subsets of the
// inclusive slices; these values are not independent CPU occupancy percentages.
const FIELDS = ['slices','totalUs','advanceInclUs','executeInclUs','compileSubsetUs',
  'throttleBlockedSubsetUs','dvdBlockedSubsetUs'];

export function nativeTimingDelta(current, previous) {
  if (!current?.enabled || !previous?.enabled || current.v !== 1 || previous.v !== 1 ||
      current.epoch !== previous.epoch) return null;
  const delta = {};
  for (const key of FIELDS) {
    if (![current[key], previous[key]].every(value => Number.isSafeInteger(value) && value >= 0) ||
        current[key] < previous[key]) return null;
    delta[key] = current[key] - previous[key];
  }
  return delta;
}

export function nativeTimingDetails(current, previous, frames) {
  const delta = nativeTimingDelta(current, previous);
  if (!delta || !(frames > 0) || !delta.slices) return {
    lines: [current?.enabled ? 'Native timing: waiting for a complete active window' :
      'Native timing: off or unavailable'], line: ''};
  const perFrame = key => (delta[key] / 1000 / frames).toFixed(1);
  return {line: `Native execute ${perFrame('executeInclUs')} · compile ${perFrame('compileSubsetUs')} ms/f`,
    lines: [
      `Native slices: ${delta.slices} · ${perFrame('totalUs')} ms/f total wall time`,
      `Native execute: ${perFrame('executeInclUs')} ms/f inclusive · advance ${perFrame('advanceInclUs')} ms/f inclusive`,
      `Compile subset: ${perFrame('compileSubsetUs')} ms/f · throttle blocked subset ${perFrame('throttleBlockedSubsetUs')} ms/f · DVD blocked subset ${perFrame('dvdBlockedSubsetUs')} ms/f`,
      'Native phases measure elapsed wall time, including scheduling delays. Completed slices can cross poll windows. Compile and waits are subsets; do not add them to inclusive phases.'
    ]};
}
