// Project branding for the library and emulator pages; preserves the existing theme.
(() => {
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
})();
