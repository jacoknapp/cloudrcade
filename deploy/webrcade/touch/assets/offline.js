/* Cache visited games without changing the player's save or account storage. */
(() => {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  const loaded = new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve, {once:true});
  });
  const config = window.WrcadCloudConfig || {};
  const params = new URLSearchParams({cache:(config.storagePrefix || 'webrcade')+'-arcade-offline-v1', feed:config.feedUrl || '/content/feeds/combined.json'});
  navigator.serviceWorker.register('/touch-controls/offline-worker.js?' + params, {
    scope:'/', updateViaCache:'none'
  }).then(async () => {
    const registration = await navigator.serviceWorker.ready;
    await loaded;
    // The first visit can load resources before clients.claim(). Warm those
    // URLs from the HTTP cache too; subsequent requests are intercepted normally.
    registration.active?.postMessage({type:'warm', urls:[location.href, config.feedUrl || '/content/feeds/combined.json',
      ...performance.getEntriesByType('resource').map(entry => entry.name)]});
  }).catch(error => console.warn('Offline game caching unavailable:', error));
})();
