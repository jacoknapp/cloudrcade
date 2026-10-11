// Project branding for the library and emulator pages; preserves the existing theme.
(() => {
  // Legacy iOS exposes navigator.standalone; game frames inherit their host's
  // installed mode even when their own display-mode query does not report it.
  const standalone = matchMedia('(display-mode: standalone)');
  const fullscreen = matchMedia('(display-mode: fullscreen)');
  const appleTouch = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Only the outer Apple web app owns the system status area. The fixed color
  // candidate must be a real element; it paints no content or extra bar.
  document.documentElement.toggleAttribute('data-cr-status-top', appleTouch && window === window.top);
  if (appleTouch && window === window.top && !document.getElementById('cr-status-top')) {
    const strip = document.createElement('div');
    strip.id = 'cr-status-top'; strip.setAttribute('aria-hidden', 'true');
    document.body.prepend(strip);
  }
  const installedMode = () => {
    let inherited = false;
    try { inherited = window !== window.top && window.top.document.documentElement.hasAttribute('data-cr-installed'); } catch (_) {}
    document.documentElement.toggleAttribute('data-cr-installed',
      Boolean(navigator.standalone || standalone.matches || fullscreen.matches || inherited));
  };
  installedMode();
  standalone.addEventListener?.('change', installedMode);
  fullscreen.addEventListener?.('change', installedMode);
  window.addEventListener('pageshow', installedMode);
  const name = window.WrcadCloudConfig?.appName || 'cloudЯcade';
  const iconVersion = encodeURIComponent(window.WrcadCloudConfig?.iconVersion || 'cabinet');
  document.title = location.pathname.startsWith('/cloud-saves/') ? 'Nextcloud saves · ' + name : name;
  for (const link of document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"],link[rel="manifest"]')) link.remove();
  for (const [rel, href, type, sizes] of [
    ['icon', '/touch-controls/cloudrcade-32.png?v=' + iconVersion, 'image/png', '32x32'],
    ['icon', '/touch-controls/cloudrcade.svg?v=' + iconVersion, 'image/svg+xml'],
    ['apple-touch-icon', '/touch-controls/cloudrcade-180.png?v=' + iconVersion, 'image/png', '180x180'],
    ['manifest', '/cloud-saves/manifest.php', 'application/manifest+json']
  ]) {
    const link = document.createElement('link');
    if (sizes) link.sizes = sizes;
    link.rel = rel; link.href = href; link.type = type; document.head.append(link);
  }
  for (const [key, value] of [['apple-mobile-web-app-capable', 'yes'],
    ['apple-mobile-web-app-status-bar-style', 'black'],
    ['apple-mobile-web-app-title', name], ['theme-color', '#000000']]) {
    let meta = document.querySelector('meta[name="' + key + '"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = key; document.head.append(meta); }
    meta.content = value;
  }
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = name + ' — games in your browser.';
  // Game frames need the same full viewport as the library. Preserve it if
  // native startup replaces the viewport meta while Safari settles its layout.
  let viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) {
    viewport = document.createElement('meta'); viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1'; document.head.append(viewport);
  }
  const coverViewport = () => {
    if (!/\bviewport-fit\s*=\s*cover\b/.test(viewport.content)) {
      viewport.content = viewport.content.replace(/,?\s*viewport-fit\s*=\s*\w+/g, '') + ', viewport-fit=cover';
    }
  };
  coverViewport();
  new MutationObserver(coverViewport).observe(viewport, {attributes: true, attributeFilter: ['content']});
  // Large viewport units can exceed the visible installed-app window. Size the
  // library's native game frame from the actual phone viewport instead, so all
  // cores receive the correct innerHeight and their own resize logic still owns
  // the canvas. CSS viewport units remain the startup/non-touch fallback.
  const touch = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
  if (touch) {
    const root = document.documentElement;
    let pending = false;
    const measureViewport = () => {
      pending = false;
      const visual = window.visualViewport;
      // A pinch changes the visual size without changing the layout viewport.
      // Feeding that size into the layout would fight the user's zoom gesture.
      const unzoomed = !visual || !visual.scale || Math.abs(visual.scale - 1) < .01;
      const left = unzoomed ? Math.max(0, visual?.offsetLeft || 0) : 0;
      const top = unzoomed ? Math.max(0, visual?.offsetTop || 0) : 0;
      const width = Math.max(0, Math.min(innerWidth - left, unzoomed ? visual?.width || innerWidth : innerWidth));
      const height = Math.max(0, Math.min(innerHeight - top, unzoomed ? visual?.height || innerHeight : innerHeight));
      if (!width || !height) return; // Hidden frames are measured when shown.
      for (const [name, value] of Object.entries({left, top, width, height})) {
        const pixels = `${Math.round(value * 1000) / 1000}px`;
        if (root.style.getPropertyValue(`--cr-viewport-${name}`) !== pixels)
          root.style.setProperty(`--cr-viewport-${name}`, pixels);
      }
    };
    const scheduleViewport = () => {
      // Measurement must also run while the library/game isn't animating.
      if (!pending) { pending = true; setTimeout(measureViewport, 0); }
    };
    measureViewport();
    for (const event of ['resize', 'pageshow', 'orientationchange']) window.addEventListener(event, scheduleViewport);
    document.addEventListener('fullscreenchange', scheduleViewport);
    window.visualViewport?.addEventListener('resize', scheduleViewport);
    window.visualViewport?.addEventListener('scroll', scheduleViewport);
  }
})();
