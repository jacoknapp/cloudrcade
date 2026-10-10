/* Responsive library adapter. All actions use the pinned player's native APIs. */
(() => {
  'use strict';
  const query = window.matchMedia('(pointer: coarse) and (max-width: 1366px)');
  const instances = new Set(), actions = new WeakMap();
  let React, Grid, pad;
  const PAGE_SIZE = 48;
  const unique = items => (items || []).filter(item => !item.duplicate);
  // Small local vectors replace generic folder art; custom feed artwork still wins.
  function systemArt(item) {
    const systems = {nes: ['NES', '#e50914'], snes: ['SNES', '#927ac4'], gb: ['GB', '#9baa68'],
      gbc: ['GBC', '#9baa68'], gba: ['GBA', '#927ac4'], n64: ['N64', '#e50914'],
      'retro-melonds': ['DS', '#70a9bd'], genesis: ['MD', '#e50914'], psx: ['PS', '#70a9bd'],
      'retro-pcsx-rearmed': ['PS', '#70a9bd'], '3ds': ['3DS', '#70a9bd'], 'retro-azahar': ['3DS', '#70a9bd']};
    const type = unique(item.items).find(game => game.type)?.type, system = systems[type];
    if (!system) return null;
    const [label, color] = system, handheld = /^(gb|gbc|gba|retro-melonds|3ds|retro-azahar)$/.test(type);
    let shape = handheld ?
      '<rect x="48" y="5" width="64" height="66" rx="6" fill="#bababa"/><rect x="55" y="11" width="50" height="33" rx="2" fill="#333"/><rect x="60" y="16" width="40" height="23" fill="'+color+'"/><path d="M58 54h15m-8-7v15" stroke="#333" stroke-width="5"/><circle cx="91" cy="57" r="4" fill="'+color+'"/><circle cx="101" cy="51" r="4" fill="'+color+'"/>' :
      '<rect x="25" y="17" width="110" height="50" rx="5" fill="#bababa"/><path d="M27 50h106" stroke="#777" stroke-width="3"/><rect x="37" y="29" width="61" height="12" rx="2" fill="#333"/><rect x="107" y="23" width="15" height="31" fill="'+color+'"/><rect x="37" y="55" width="18" height="5" fill="#333"/><rect x="61" y="55" width="18" height="5" fill="#333"/>';
    if (/melonds|3ds|azahar/.test(type)) shape = '<rect x="46" y="3" width="68" height="33" rx="4" fill="#bdbdbd"/><rect x="54" y="8" width="52" height="22" fill="#263f46"/><rect x="39" y="39" width="82" height="34" rx="4" fill="#bdbdbd"/><rect x="56" y="43" width="48" height="25" fill="#263f46"/><path d="M44 55h10m-5-5v10" stroke="#444" stroke-width="3"/><circle cx="112" cy="54" r="3" fill="'+color+'"/>';
    if (type === 'gba') shape = '<rect x="24" y="20" width="112" height="48" rx="18" fill="#927ac4"/><rect x="52" y="25" width="56" height="36" rx="3" fill="#333"/><rect x="57" y="30" width="46" height="26" fill="#a5b28c"/><path d="M31 43h15m-8-7v15" stroke="#333" stroke-width="4"/><circle cx="119" cy="47" r="4" fill="#333"/><circle cx="128" cy="38" r="4" fill="#333"/>';
    if (type === 'snes') shape = '<rect x="27" y="15" width="106" height="54" rx="13" fill="#bdbdbd"/><rect x="50" y="20" width="60" height="20" rx="5" fill="#777"/><path d="M55 30h50" stroke="#333" stroke-width="4"/><rect x="44" y="48" width="20" height="9" fill="#927ac4"/><rect x="98" y="48" width="20" height="9" fill="#927ac4"/>';
    if (/^(psx|retro-pcsx-rearmed)$/.test(type)) shape = '<rect x="26" y="14" width="108" height="56" rx="8" fill="#bababa"/><circle cx="82" cy="39" r="23" fill="#999" stroke="#777"/><circle cx="42" cy="29" r="6" fill="#70a9bd"/><circle cx="122" cy="55" r="6" fill="#999"/><path d="M58 66h46" stroke="#444" stroke-width="3"/>';
    if (type === 'genesis' || type === 'n64') shape = '<path d="M37 15h86l14 47-12 10H35L23 62z" fill="#333" stroke="#777" stroke-width="2"/><rect x="48" y="24" width="64" height="15" rx="3" fill="#0b0b0b"/><path d="M50 56h60" stroke="'+color+'" stroke-width="4"/><path d="M39 64h12m13 0h12m13 0h12m13 0h12" stroke="#999" stroke-width="4"/>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 96">'+shape+
      '<text x="80" y="90" text-anchor="middle" fill="#ddd" font-family="monospace" font-weight="bold" font-size="12" letter-spacing="3">'+label+'</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  const mobile = () => query.matches;
  function viewport() {
    document.documentElement.toggleAttribute('data-cr-mobile', mobile());
    const meta = document.querySelector('meta[name="viewport"]');
    if (mobile() && meta && !meta.content.includes('viewport-fit=cover')) {
      meta.content = meta.content.replace(/,?\s*viewport-fit=\w+/g, '') + ', viewport-fit=cover';
    }
  }
  viewport();
  function observeViewport() {
    viewport();
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) new MutationObserver(viewport).observe(meta, {attributes: true, attributeFilter: ['content']});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeViewport, {once: true});
  else observeViewport();
  query.addEventListener('change', () => { viewport(); for (const browse of instances) browse.forceUpdate(); });
  const h = (...args) => React.createElement(...args);
  function navigate(browse, mode) {
    browse.setState({menuMode: mode, searchTerm: '', crMobileDetail: false, crMobilePage: 0,
      currentItem: mode === 'feeds' ? browse.props.feeds[0] : browse.state.feed.getCategories()[0]});
  }
  function activate(browse, item) {
    const isCategory = browse.state.menuMode === 'categories' && !browse.state.searchTerm;
    browse.setState({currentItem: item, crMobileDetail: !isCategory}, () => {
      // Read the action after selection committed, just as the native Play/Select button does.
      if (isCategory) actions.get(browse)?.primary?.();
    });
  }
  function makeGrid(context) {
    class MobileGrid extends React.Component {
      componentDidMount() { this.context.gamepadNotifier?.addCallback(this.gamepadCallback); }
      componentWillUnmount() { this.context.gamepadNotifier?.removeCallback(this.gamepadCallback); }
      isFocusable() { return !!this.container?.offsetHeight && !this.props.standby && !this.props.browse.props.disable; }
      focus() {
        if (!this.isFocusable() || this.props.browse.state.crMobileDetail) return false;
        // Native component updates request focus frequently. Keep typing and touch navigation intact.
        const current = document.activeElement;
        if (current && current !== document.body && current !== document.documentElement &&
            document.documentElement.contains(current)) return false;
        const buttons = this.container.querySelectorAll('.cr-mobile-card');
        const values = unique(this.props.items).slice((this.props.browse.state.crMobilePage || 0) * PAGE_SIZE);
        const index = Math.max(0, values.indexOf(this.props.browse.state.currentItem));
        (buttons[index] || buttons[0] || this.container).focus({preventScroll: true});
        return true;
      }
      selectedIndex() {
        return Math.max(0, [...this.container.querySelectorAll('.cr-mobile-card')].findIndex(b => b === document.activeElement));
      }
      move(direction) {
        const buttons = [...this.container.querySelectorAll('.cr-mobile-card')];
        if (!buttons.length) return;
        const columns = getComputedStyle(this.container.querySelector('.cr-mobile-cards')).gridTemplateColumns.split(' ').length;
        const i = this.selectedIndex(), step = direction === 'left' ? -1 : direction === 'right' ? 1 : direction === 'up' ? -columns : columns;
        if (i + step < 0 && direction === 'up') { this.props.browse.settingsRef.current?.focus(); return; }
        buttons[Math.max(0, Math.min(buttons.length - 1, i + step))].focus();
      }
      gamepadCallback = event => {
        if (!this.isFocusable() || this.props.browse.state.crMobileDetail || !this.container.contains(document.activeElement)) return false;
        if (event.type === pad.A) document.activeElement.click();
        else if (event.type === pad.LBUMP || event.type === pad.RBUMP) this.page(event.type === pad.LBUMP ? -1 : 1);
        else {
          const direction = ['left', 'right', 'up', 'down'].find(name => event.type === pad[name.toUpperCase()]);
          if (!direction) return false;
          this.move(direction);
        }
        return true;
      };
      page(delta) {
        const {browse, items} = this.props;
        const next = Math.max(0, Math.min(Math.ceil(unique(items).length / PAGE_SIZE) - 1, (browse.state.crMobilePage || 0) + delta));
        browse.setState({crMobilePage: next}, () => {
          this.container.scrollTop = 0;
          this.container.querySelector('.cr-mobile-card')?.focus({preventScroll: true});
        });
      }
      render() {
        const {browse, standby, items, getTitle, getThumbnailSrc, getDefaultThumbnailSrc} = this.props;
        if (standby) return h('div', {ref: el => {this.container = el;}, hidden: true});
        const values = unique(items), page = Math.min(browse.state.crMobilePage || 0, Math.max(0, Math.ceil(values.length / PAGE_SIZE) - 1));
        const first = page * PAGE_SIZE;
        return h('main', {className: 'cr-mobile-grid', 'aria-label': 'Library', tabIndex: -1,
          ref: el => {this.container = el;}, onKeyDown: event => {
            const name = event.key.replace('Arrow', '').toLowerCase();
            if (['left', 'right', 'up', 'down'].includes(name)) { event.preventDefault(); this.move(name); }
            else if (event.key === 'PageDown' || event.key === 'PageUp') { event.preventDefault(); this.page(event.key === 'PageDown' ? 1 : -1); }
          }},
          h('div', {className: 'cr-mobile-cards'}, values.slice(first, first + PAGE_SIZE).map((item, i) => {
            const title = getTitle(item), category = browse.state.menuMode === 'categories' && !browse.state.searchTerm;
            const thumbnail = getThumbnailSrc(item), fallback = getDefaultThumbnailSrc(item);
            const art = category && thumbnail === fallback ? systemArt(item) : null;
            return h('button', {key: first + i, type: 'button', className: 'cr-mobile-card',
              'aria-label': title, 'aria-haspopup': category ? undefined : 'dialog',
              onClick: () => activate(browse, item)},
              h('div', {className: 'cr-mobile-art'}, h('img', {src: art || thumbnail, 'data-system-art': art ? '' : undefined, alt: '', loading: 'lazy', decoding: 'async',
                onError: event => { const img = event.currentTarget; if (!img.dataset.fallback) {img.dataset.fallback = '1'; img.src = getDefaultThumbnailSrc(item);} }})),
              h('span', {className: 'cr-mobile-card-title'}, title),
              category ? h('span', {className: 'cr-mobile-card-meta'}, unique(item.items).length + ' games') : null);
          })),
          !values.length ? h('p', {className: 'cr-mobile-empty', role: 'status'}, browse.state.searchTerm ? 'No games match your search.' : 'No games yet. The library will appear after a scan.') : null,
          values.length > PAGE_SIZE ? h('nav', {className: 'cr-mobile-pagination', 'aria-label': 'Library pages'},
            h('button', {type: 'button', disabled: page === 0, onClick: () => this.page(-1)}, 'Previous'),
            h('span', {role: 'status'}, (first + 1) + '–' + Math.min(first + PAGE_SIZE, values.length) + ' of ' + values.length),
            h('button', {type: 'button', disabled: first + PAGE_SIZE >= values.length, onClick: () => this.page(1)}, 'Next')) : null);
      }
    }
    MobileGrid.contextType = context;
    return MobileGrid;
  }
  function adapt(element, browse) {
    if (!React.isValidElement(element)) return element;
    if (element.ref === browse.sliderRef) {
      if (!Grid) Grid = makeGrid(element.type.contextType);
      return h(Grid, {...element.props, ref: browse.sliderRef, browse});
    }
    if (element.type?.prototype?.render && element.props.backgroundSrc !== undefined && element.props.buttons !== undefined) {
      const buttons = React.Children.toArray(element.props.buttons?.props?.children);
      actions.set(browse, {primary: buttons[0]?.props.onClick});
      const close = () => browse.setState({crMobileDetail: false});
      if (!browse.state.crMobileDetail) return null;
      return h('div', {className: 'cr-mobile-scrim', onClick: close},
        h('section', {className: 'cr-mobile-sheet', role: 'dialog', 'aria-modal': true,
          'aria-label': element.props.title, onClick: event => event.stopPropagation(), onKeyDown: event => {
            if (event.key === 'Escape') close();
            if (event.key === 'Tab') {
              const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled),input')].filter(el => el.offsetHeight);
              const index = buttons.indexOf(document.activeElement);
              if (event.shiftKey && index <= 0) {event.preventDefault(); buttons.at(-1)?.focus();}
              else if (!event.shiftKey && (index < 0 || index === buttons.length - 1)) {event.preventDefault(); buttons[0]?.focus();}
            }
          }}, h('button', {type: 'button', className: 'cr-mobile-close', 'aria-label': 'Close details', autoFocus: true, onClick: close}, '×'), element,
          /^(?:3ds|retro-azahar|psx|retro-pcsx-rearmed)$/.test(browse.state.currentItem?.type || '') ?
            h('p', {className: 'cr-mobile-stream-note'}, 'Streamed games require an internet connection during play.',
              /3ds|azahar/.test(browse.state.currentItem.type) ? ' 3DS shaders cache as they are made; new shaders can cause hitching, especially on mobile.' : '') : null));
    }
    let props = {};
    if (element.ref === browse.searchRef) { props.label = 'Search'; props.onClick = () => document.getElementById('cr-mobile-search')?.focus(); }
    if (element.ref === browse.settingsRef) props.label = 'Settings';
    if (element.ref === browse.webrcadeDivRef) {
      props.className = element.props.className + ' cr-mobile-library';
      props.style = {...element.props.style, opacity: 1};
    }
    let children = React.Children.toArray(element.props.children).map(child => adapt(child, browse));
    if (element.props.className === 'webrcade-outer') {
      const {feed, category, menuMode, searchTerm} = browse.state;
      const heading = searchTerm ? 'Search results' : menuMode === 'feeds' ? 'Feeds' : menuMode === 'categories' ? 'Your library' : category?.longTitle || category?.title || feed.getTitle();
      const toolbar = h('div', {className: 'cr-mobile-toolbar', key: 'mobile-toolbar'},
        h('div', {className: 'cr-mobile-breadcrumb'},
          menuMode !== 'categories' || searchTerm ? h('button', {type: 'button', onClick: () => navigate(browse, 'categories')}, '‹ Systems') : h('span', null, feed.getTitle()),
          h('div', null, menuMode !== 'feeds' ? h('button', {type: 'button', onClick: () => navigate(browse, 'feeds')}, 'Feeds') : null,
            children.some(child => child?.props?.className === 'header-nav') ? null : h('button', {type: 'button', onClick: browse.props.onSettings}, 'Settings'))),
        h('h1', null, heading),
        menuMode !== 'feeds' ? h('label', {className: 'cr-mobile-search'}, h('span', {className: 'cr-mobile-sr-only'}, 'Search games'),
          h('input', {id: 'cr-mobile-search', type: 'search', placeholder: 'Search all games', value: searchTerm, autoComplete: 'off',
            onChange: event => { const term = event.target.value; const found = term.trim() ? unique(browse.getSearchItems(term.trim())) : [];
              if (!term.trim()) browse.clearSearch();
              else browse.setState({searchTerm: term, ...(found.length ? {currentItem: found[0]} : {})}); }})) : null);
      const header = children.findIndex(child => child?.props?.className === 'header-nav');
      children.splice(header >= 0 ? header + 1 : 1, 0, toolbar);
      // Keep background controls out of touch/keyboard navigation while a dialog is open.
      if (browse.props.disable || browse.state.crMobileDetail) children = children.map(child =>
        React.isValidElement(child) && child.props.className !== 'cr-mobile-scrim' ? h('div', {key: child.key, inert: '', 'aria-hidden': true, className: 'cr-mobile-inert'}, child) : child);
    }
    return React.cloneElement(element, props, ...children);
  }
  function install({react, Browse, GamepadEnum}) {
    if (!react?.cloneElement || !Browse?.prototype?.clearSearch || Browse.prototype._crMobileInstalled) return;
    React = react; pad = GamepadEnum;
    Browse.prototype._crMobileInstalled = true;
    const mount = Browse.prototype.componentDidMount, unmount = Browse.prototype.componentWillUnmount;
    Browse.prototype.componentDidMount = function(...args) { instances.add(this); return mount.apply(this, args); };
    Browse.prototype.componentWillUnmount = function(...args) { instances.delete(this); actions.delete(this); return unmount.apply(this, args); };
    const update = Browse.prototype.componentDidUpdate;
    Browse.prototype.componentDidUpdate = function(previous, state) {
      const result = update.call(this, previous, state);
      if (this.props.hide && !previous.hide && this.state.crMobileDetail) this.setState({crMobileDetail: false});
      return result;
    };
    const setState = Browse.prototype.setState;
    Browse.prototype.setState = function(update, ...args) {
      const observe = (next, state) => {
        if (next && ['feed', 'category', 'menuMode', 'searchTerm'].some(key => key in next && next[key] !== state[key]))
          return {...next, crMobilePage: 0, crMobileDetail: false};
        return next;
      };
      return setState.call(this, typeof update === 'function' ? (state, props) => observe(update(state, props), state) : observe(update, this.state), ...args);
    };
    const render = Browse.prototype.render;
    Browse.prototype.render = function(...args) {
      if (!mobile()) return render.apply(this, args);
      if (this.props.hide && Grid) {
        // Keep only the native focus/resize refs. Cards, artwork and detail components unmount.
        actions.delete(this);
        this._searchCache = this._searchCountCache = null;
        return h('div', {ref: this.webrcadeDivRef, className: 'cr-mobile-suspended', hidden: true},
          h(Grid, {ref: this.sliderRef, browse: this, standby: true}));
      }
      return adapt(render.apply(this, args), this);
    };
  }
  window.WrcadMobile = {install};
})();
