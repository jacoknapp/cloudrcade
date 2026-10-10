/* Recently Played for the pinned webRcade library; loaded before webpack. */
(() => {
  'use strict';
  const prefix = window.WrcadCloudConfig?.storagePrefix || 'webrcade';
  const KEY = prefix + '.recently-played.v1';
  const LIMIT = 20;
  const PREFIX = prefix + '.recently-played.sync.v1.', OWNER = PREFIX + 'owner';
  const patched = new WeakSet(), feeds = new WeakMap();
  let history = [], library = null, react = null, memoryOnly = false;
  let activeAccount = undefined, running = null, timer = null;
  const memory = new Map();
  const volatileKeys = new Set();
  function stored(key) {
    if (volatileKeys.has(key)) return memory.get(key) || null;
    try { return localStorage.getItem(key); } catch (_) { return memory.get(key) || null; }
  }
  function persist(key, value) {
    memory.set(key, value);
    try { if (localStorage.getItem(key) !== value) localStorage.setItem(key, value); }
    catch (_) { volatileKeys.add(key); }
  }
  function merge(...lists) {
    const entries = new Map();
    for (const list of lists) for (const entry of (Array.isArray(list) ? list : []).slice(0, 1000)) {
      if (!entry || typeof entry.key !== 'string' || entry.key.length >= 8192 ||
          !Number.isSafeInteger(entry.playedAt) || entry.playedAt <= 0) continue;
      if (!entries.has(entry.key) || entries.get(entry.key).playedAt < entry.playedAt)
        entries.set(entry.key, {key: entry.key, playedAt: entry.playedAt});
    }
    return [...entries.values()].sort((a, b) => b.playedAt - a.playedAt || a.key.localeCompare(b.key)).slice(0, LIMIT);
  }
  function accountKey(uid) { return PREFIX + JSON.stringify(uid); }
  function entries(uid) {
    try { return merge(JSON.parse(stored(accountKey(uid)))); } catch (_) { return []; }
  }
  function publish(values) {
    history = values.map(entry => entry.key);
    try { if (localStorage.getItem(KEY) !== JSON.stringify(history)) localStorage.setItem(KEY, JSON.stringify(history)); }
    catch (_) { memoryOnly = true; }
    refreshBrowse();
  }
  function activate() {
    const uid = window.WrcadCloud?.controlsAccount() || null;
    if (uid === activeAccount) return uid;
    const owner = stored(OWNER);
    let values = entries(uid);
    if (owner === null) {
      // Old histories have order but no dates; retain that order on first import.
      const now = Date.now();
      values = merge(values, readHistory().map((key, i) => ({key, playedAt: now - i})));
    } else if (uid && owner === 'null') {
      // Unlinked play is imported once. Never import another account's history.
      values = merge(values, entries(null));
      persist(accountKey(null), '[]');
    }
    activeAccount = uid;
    persist(accountKey(uid), JSON.stringify(values));
    persist(OWNER, JSON.stringify(uid));
    publish(values);
    return uid;
  }
  function schedule(delay = 700) {
    clearTimeout(timer); timer = setTimeout(sync, delay);
  }
  function sync() {
    const uid = activate(), cloud = window.WrcadCloud;
    if (!uid || !cloud?.loadRecent) return Promise.resolve();
    if (running) { schedule(); return running; }
    running = (async () => {
      cloud.recentStatus = 'syncing';
      for (let attempt = 0; attempt < 3; attempt++) {
        let remote = [];
        try {
          const doc = await cloud.loadRecent();
          if (doc?.version !== 1 || !Array.isArray(doc.entries)) throw new Error('Unsupported Recently Played history');
          remote = merge(doc.entries);
        } catch (error) { if (error.status !== 404) throw error; }
        if (cloud.controlsAccount() !== uid) { schedule(0); return; }
        const merged = merge(remote, entries(uid));
        try {
          if (JSON.stringify(merged) !== JSON.stringify(remote)) await cloud.saveRecent({version: 1, entries: merged});
        } catch (error) { if (error.status === 409) continue; throw error; }
        if (cloud.controlsAccount() !== uid) { schedule(0); return; }
        // A game may have launched while the request was in flight.
        const latest = merge(merged, entries(uid));
        persist(accountKey(uid), JSON.stringify(latest));
        publish(latest);
        if (JSON.stringify(latest) !== JSON.stringify(merged)) schedule();
        cloud.recentStatus = 'saved';
        return;
      }
      throw new Error('Recently Played changed during sync');
    })().catch(() => {
      cloud.recentStatus = 'pending';
      schedule(30000);
    }).finally(() => { running = null; });
    return running;
  }
  function readHistory() {
    if (memoryOnly) return history;
    let raw;
    try { raw = localStorage.getItem(KEY); } catch (_) { memoryOnly = true; return history; }
    try {
      const stored = JSON.parse(raw || '[]');
      history = Array.isArray(stored) ? [...new Set(stored.filter(key =>
        typeof key === 'string' && key.length < 8192))].slice(0, LIMIT) : [];
    } catch (_) { history = []; }
    return history;
  }
  function gameKey(item) {
    const props = item?.props;
    if (!props || !item.type) return null;
    const identity = props.uid ? ['uid', props.uid] : props.rom ? ['rom', props.rom] :
      Array.isArray(props.discs) && props.discs.length ? ['discs', props.discs] : null;
    return identity ? JSON.stringify([item.type, ...identity]) : null;
  }
  function recentCategory(feed) {
    if (!feed?.getUniqueCategories || !feed._expandItems) return null;
    let data = feeds.get(feed);
    if (!data) {
      const originals = feed.getUniqueCategories();
      const index = new Map();
      for (const category of originals) for (const item of category.items) {
        const key = gameKey(item);
        if (key && !index.has(key)) index.set(key, item);
      }
      data = {index, count: feed.getUniqueCategoryCount(),
        categories: originals.map(category => ({...category,
          thumbnail: category.thumbnail || window.WrcadCategoryArt?.thumbnail(category),
          items: feed._expandItems(category.items)}))};
      feeds.set(feed, data);
    }
    const keys = readHistory().filter(key => data.index.has(key));
    const stamp = JSON.stringify(keys);
    if (stamp !== data.stamp) {
      data.stamp = stamp;
      data.recent = {
        title: 'Recently Played', wrcadRecent: true,
        thumbnail: window.WrcadCategoryArt?.thumbnail({wrcadRecent: true}),
        description: keys.length ? 'Your last 20 games, most recently played first. Syncs when connected to Nextcloud.' :
          'Play a game from a system folder below. It will appear here automatically.',
        items: feed._expandItems(keys.map(key => data.index.get(key))),
      };
      // Search still reads the original unique categories, without duplicate games.
      feed.categories = feed._expandItems(keys.length ? [data.recent, ...data.categories] : data.categories);
      feed.uniqueCategoryCount = data.count + (keys.length ? 1 : 0);
    }
    return data.recent;
  }
  function selection(feed) {
    if (!recentCategory(feed)) return null;
    const category = feed.getCategories()[0];
    const data = feeds.get(feed);
    if (data && !('initialChoice' in data)) {
      data.initialChoice = category;
      data.defaultPending = !category?.wrcadRecent;
    }
    return {category, currentItem: category, menuMode: 'categories', searchTerm: ''};
  }
  function refreshBrowse() {
    const browse = library?.browseScreenRef?.current;
    const feed = library?.state.feed;
    if (!browse || !feed) return;
    const recent = recentCategory(feed);
    if (browse.state.category?.wrcadRecent && browse.state.menuMode === 'apps' && !browse.state.searchTerm) {
      const next = recent?.items.length ? {category: recent, currentItem: recent.items[0]} : selection(feed);
      browse.setState(next);
    } else if (browse.state.menuMode === 'categories') {
      const data = feeds.get(feed);
      if (data?.defaultPending && recent?.items.length && browse.state.currentItem === data.initialChoice && !browse.state.searchTerm) {
        data.defaultPending = false;
        browse.setState({category: recent, currentItem: feed.getCategories()[0]});
        return;
      }
      // Replace any old virtual category object, but keep deliberate navigation.
      browse.setState({currentItem: browse.state.currentItem?.wrcadRecent ?
        (feed.getCategories()[0]) : browse.state.currentItem});
    }
  }
  function record(feed, item) {
    const key = gameKey(item);
    if (!key) return;
    const uid = activate();
    const previous = entries(uid);
    const playedAt = Math.max(Date.now(), (previous[0]?.playedAt || 0) + 1);
    const values = merge(previous, [{key, playedAt}]);
    persist(accountKey(uid), JSON.stringify(values));
    publish(values);
    recentCategory(feed);
    if (uid) schedule();
  }
  function decorateCategories(element, browse) {
    if (!react?.isValidElement(element)) return element;
    const current = browse.state.currentItem;
    if (element.ref === browse.button1Ref && current?.wrcadRecent && !current.items.length)
      return react.cloneElement(element, {disabled: true, onClick: undefined});
    if (element.ref === browse.sliderRef)
      return react.cloneElement(element, {lastItemTitle: current?.title});
    const props = {};
    if (element.props.buttons) props.buttons = decorateCategories(element.props.buttons, browse);
    const children = element.props.children;
    // Preserve the original child keys and refs so selection/focus survives.
    if (children) props.children = Array.isArray(children) ? children.map(child => decorateCategories(child, browse)) :
      decorateCategories(children, browse);
    return Object.keys(props).length ? react.cloneElement(element, props) : element;
  }
  function install(exports) {
    if (exports?.react?.cloneElement && exports.react.isValidElement) react = exports.react;
    for (const key of Object.keys(exports || {})) {
      let value;
      try { value = exports[key]; } catch (_) { continue; }
      if (typeof value !== 'function' || patched.has(value)) continue;
      if (value.ModeEnum?.CATEGORIES === 'categories' && value.getDerivedStateFromProps && value.prototype?.clearSearch) {
        patched.add(value);
        const setState = value.prototype.setState;
        value.prototype.setState = function(update, ...args) {
          const observe = (next, state) => {
            const data = feeds.get(state?.feed);
            if (data && next && (('currentItem' in next && next.currentItem !== state.currentItem) ||
                ('menuMode' in next && next.menuMode !== state.menuMode) ||
                ('searchTerm' in next && next.searchTerm !== state.searchTerm))) data.defaultPending = false;
            return next;
          };
          return setState.call(this, typeof update === 'function' ?
            (state, props) => observe(update(state, props), state) : observe(update, this.state), ...args);
        };
        const derive = value.getDerivedStateFromProps;
        value.getDerivedStateFromProps = function(props, state) {
          const initial = props.feed !== state?.feed;
          const recent = initial ? selection(props.feed) : null;
          const next = derive.call(this, props, state);
          if (!initial && state?.menuMode === 'apps' && state.category?.wrcadRecent && !state.category.items.length) return selection(props.feed);
          return initial && recent ? {...next, ...recent} : next;
        };
        const render = value.prototype.render;
        value.prototype.render = function(...args) {
          const element = render.apply(this, args);
          const {menuMode, searchTerm} = this.state;
          return menuMode === 'categories' && !searchTerm ? decorateCategories(element, this) : element;
        };
      } else if (value.prototype?.renderBrowse && value.prototype?.renderApp) {
        patched.add(value);
        const update = value.prototype.componentDidUpdate;
        value.prototype.componentDidUpdate = function(props, previous) {
          library = this;
          const result = update.call(this, props, previous);
          const {mode, app, feed} = this.state;
          if (mode === this.ScreenEnum.APP && (previous.mode !== mode || previous.app !== app)) record(feed, app);
          if (previous.mode === this.ScreenEnum.APP && mode === this.ScreenEnum.BROWSE) refreshBrowse();
          return result;
        };
        const unmount = value.prototype.componentWillUnmount;
        value.prototype.componentWillUnmount = function(...args) {
          if (library === this) library = null;
          return unmount.apply(this, args);
        };
      }
    }
  }
  window.addEventListener('storage', event => {
    if (event.key === KEY || event.key === null) { readHistory(); refreshBrowse(); }
    if (event.key === prefix + '.nextcloud.connection.v1' || event.key === accountKey(activeAccount)) schedule();
  });
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('focus', () => schedule(0));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
  window.WrcadRecent = {install, sync};
  // The bridge loads before this adapter, so its startup sync cannot reach us.
  // Restore this account's cached history before Browse renders, then fetch the
  // cloud history without requiring focus, another launch or a manual action.
  activate();
  schedule(0);
})();
