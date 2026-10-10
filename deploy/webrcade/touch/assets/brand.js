// CloudRcade modification, 2026: runtime name and independent project icon.
(() => {
  document.title = window.WrcadCloudConfig?.appName || 'CloudRcade';
  let icon = document.querySelector('link[rel="icon"]');
  if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.append(icon); }
  icon.type = 'image/svg+xml';
  icon.href = '/touch-controls/cloudrcade.svg';
})();
