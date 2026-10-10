/* Public environment configuration, including a cached copy for offline startup. */
(() => {
  'use strict';
  const key = 'webrcade.runtime.config.v1';
  let config = window.WrcadCloudConfig;
  if (config) {
    try { localStorage.setItem(key, JSON.stringify(config)); } catch (_) {}
  } else {
    try { config = JSON.parse(localStorage.getItem(key)); } catch (_) {}
  }
  window.WrcadCloudConfig = {appName:'CloudRcade', storagePrefix:'cloudrcade', saveFolder:'CloudRcade',
    feedUrl:'/content/feeds/combined.json', enabled:false, autoRedirect:false, accessAllowed:false, server:'', ...config};
})();
