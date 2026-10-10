// Project branding for the library and emulator pages; preserves the existing theme.
(() => {
  const name = window.WrcadCloudConfig?.appName || 'cloudЯcade';
  document.title = location.pathname.startsWith('/cloud-saves/') ? 'Nextcloud saves · ' + name : name;
  for (const link of document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"],link[rel="manifest"]')) link.remove();
  for (const [rel, href, type] of [
    ['icon', '/touch-controls/cloudrcade.svg', 'image/svg+xml'],
    ['apple-touch-icon', '/touch-controls/cloudrcade-192.png', 'image/png'],
    ['manifest', '/cloud-saves/manifest.php', 'application/manifest+json']
  ]) {
    const link = document.createElement('link');
    link.rel = rel; link.href = href; link.type = type; document.head.append(link);
  }
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = name + ' — games in your browser.';
})();
