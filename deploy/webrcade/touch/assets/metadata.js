/* Fetch metadata only for the selected game; provider credentials stay server-side. */
(() => {
  'use strict';
  const patched = new WeakSet(), completed = new WeakSet(), states = new WeakMap();
  const normalize = value => Array.isArray(value) ? value.map(normalize) :
    typeof value === 'string' && /^https?:\/\//.test(value) ? new URL(value).pathname + new URL(value).search : value;
  function selected(browse) {
    return !browse.props.hide && !browse.props.disable && (browse.state.menuMode === 'apps' || browse.state.searchTerm) ? browse.state.currentItem : null;
  }
  const active = (browse, state, item, generation) => !state.disposed && state.generation === generation && state.item === item && selected(browse) === item;
  function cancel(state) {
    state.generation++;
    clearTimeout(state.timer); state.timer = null;
    state.controller?.abort(); state.controller = null;
  }
  function schedule(browse, state, item, delay) {
    const generation = state.generation;
    state.timer = setTimeout(() => {
      state.timer = null;
      if (active(browse, state, item, generation)) void hydrate(browse, state, item, generation);
    }, delay);
  }
  async function hydrate(browse, state, item, generation) {
    if (!item?.type || completed.has(item) || !crypto.subtle || !active(browse, state, item, generation)) return;
    const props = item.getProps ? item.getProps() : item.props;
    if (!props || !(props.uid || props.rom || props.discs)) return;
    const controller = new AbortController(); state.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    let retry = null, updated = false;
    try {
      const raw = JSON.stringify([item.type, normalize(props.uid || props.rom || props.discs)]);
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      if (!active(browse, state, item, generation) || controller.signal.aborted) return;
      const key = [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
      const response = await fetch('/cloud-saves/metadata.php?key=' + key, {credentials:'same-origin', cache:'no-store', signal:controller.signal});
      if (!response.ok) throw new Error('Metadata request failed.');
      const value = await response.json();
      if (!active(browse, state, item, generation) || controller.signal.aborted) return;
      if (typeof value.available !== 'boolean') throw new Error('Invalid metadata response.');
      if (value.pending) {
        retry = Number.isFinite(value.retryAfterMs) ? Math.max(1200, Math.min(300000, value.retryAfterMs)) : 1200;
        state.failures = 0;
      } else completed.add(item);
      if (value.available) {
        for (const field of ['longTitle','description','thumbnail']) if (typeof value.metadata?.[field] === 'string') item[field] = value.metadata[field];
        updated = true;
      }
    } catch (_) {
      // Three attempts per selection. Re-selecting after recovery starts fresh.
      if (active(browse, state, item, generation) && ++state.failures < 3) retry = 1200 * 2 ** (state.failures - 1);
    } finally {
      clearTimeout(timeout);
      if (state.controller === controller) state.controller = null;
      if (active(browse, state, item, generation)) {
        if (retry !== null) schedule(browse, state, item, retry);
        if (updated) browse.forceUpdate();
      }
    }
  }
  function reconcile(browse) {
    let state = states.get(browse);
    if (!state) { state = {generation:0, item:null, timer:null, controller:null, failures:0, disposed:false}; states.set(browse, state); }
    if (state.disposed) return;
    const item = selected(browse);
    if (item !== state.item) { cancel(state); state.item = item; state.failures = 0; }
    if (item && !completed.has(item) && !state.timer && !state.controller && state.failures < 3) schedule(browse, state, item, 350);
  }
  window.WrcadMetadata = {install({Browse}) {
    if (!Browse?.prototype || patched.has(Browse)) return;
    patched.add(Browse);
    const update = Browse.prototype.componentDidUpdate;
    Browse.prototype.componentDidUpdate = function(...args) { const result = update?.apply(this, args); reconcile(this); return result; };
    const unmount = Browse.prototype.componentWillUnmount;
    Browse.prototype.componentWillUnmount = function(...args) {
      const state = states.get(this);
      if (state) { state.disposed = true; cancel(state); }
      return unmount?.apply(this, args);
    };
  }};
})();
