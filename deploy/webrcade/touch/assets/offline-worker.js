/* Offline library and complete game files for the pinned RetroArcade player. */
'use strict';
const params = new URL(self.location.href).searchParams;
const CACHE = params.get('cache') || 'webrcade-arcade-offline-v1';
const ORIGIN = self.location.origin;
const LIBRARY = '/play/';
const FEED = params.get('feed') || '/content/feeds/combined.json';

function kind(url) {
  if (url.origin !== ORIGIN) return null;
  const path = url.pathname;
  if (/^\/play\/(?:index\.html)?$/.test(path) ||
      /^\/play\/app\/[a-z0-9-]+\/(?:index\.html)?$/.test(path)) return 'document';
  if (url.href === new URL(FEED, ORIGIN).href || /^\/content\/feeds\/[^/]+\.json$/.test(path)) return 'feed';
  if (/^\/content\/(?:[^/]+\/(?:roms|bios)\/|derived\/|managed\/)/.test(path) &&
      /\.(?:zip|chd|pbp|bin|nes|sfc|smc|gba|gb|gbc|nds|n64|z64|v64|smd|gen|sbi)$/i.test(path)) return 'game';
  if (/^\/cloud-saves\/(?:bridge|clock|controller-sync|runtime|dropbox)\.js$/.test(path)) return 'script';
  if (/^\/(?:touch-controls|arcade-bundles)\//.test(path) ||
      /^\/play\/(?:app\/|static\/|images\/|[^/]+\.(?:png|ico|json|zip)$)/.test(path)) {
    if (/\.js$/.test(path)) return 'script';
    if (/\.css$/.test(path)) return 'style';
    if (/\.(?:wasm|zip|data|bin|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|json)$/.test(path)) return 'asset';
  }
  return null;
}

function key(url, type) {
  const value = new URL(url);
  // Launch props/feed choices live in the page URL, never in the HTML body.
  // Keep all asset/feed query strings so different revisions remain distinct.
  if (type === 'document') {
    value.search = '';
    value.pathname = value.pathname.replace(/index\.html$/, '');
  }
  value.hash = '';
  return value.href;
}

function safe(response, type) {
  if (response.status !== 200 || response.redirected || response.type === 'opaque') return false;
  if (response.url && new URL(response.url).origin !== ORIGIN) return false;
  if (/no-store|private/i.test(response.headers.get('Cache-Control') || '')) return false;
  const mime = response.headers.get('Content-Type') || '';
  if (type === 'document') return /text\/html/i.test(mime);
  if (type === 'feed') return /json/i.test(mime);
  if (type === 'script') return /javascript/i.test(mime);
  if (type === 'style') return /text\/css/i.test(mime);
  return !/html|json/i.test(mime) || (type === 'asset' && /json/i.test(mime));
}

async function put(cache, url, response, type) {
  if (!await valid(response, type)) return false;
  // Assets share the origin's quota with IndexedDB saves. Leave headroom for
  // progress instead of filling the last available space with another ROM.
  const storage = self.navigator.storage;
  if (storage?.estimate) {
    const estimate = await storage.estimate().catch(() => ({}));
    const bytes = Number(response.headers.get('Content-Length')) || 0;
    if (estimate.quota && estimate.quota - (estimate.usage || 0) - bytes <
        Math.max(64 * 1024 * 1024, estimate.quota * 0.05)) return false;
  }
  await cache.put(key(url, type), response);
  return true;
}

async function valid(response, type) {
  return safe(response, type) && (type !== 'document' ||
    (await response.clone().text()).includes('/touch-controls/offline.js'));
}

async function warm(url, required = false) {
  const parsed = new URL(url, ORIGIN), type = kind(parsed);
  if (!type) return;
  const cache = await caches.open(CACHE), target = key(parsed, type);
  if (!required && await cache.match(target)) return;
  const response = await fetch(target, {cache:'no-cache'});
  if (!await valid(response, type)) throw new Error('Offline resource unavailable: ' + parsed.pathname);
  // A successful login HTML page must not masquerade as the library shell.
  if (type === 'document') {
    const html = await response.clone().text();
    if (!await put(cache, parsed, response, type)) throw new Error('Insufficient offline cache space');
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map(match => new URL(match[1], target)).filter(value => kind(value));
    await Promise.all(urls.map(value => warm(value.href, required)));
  } else if (!await put(cache, parsed, response, type)) throw new Error('Insufficient offline cache space');
}

self.addEventListener('install', event => {
  // Browsers update this public script even while sign-in is pending. Protected
  // prefetches here can replace the auth proxy's pending redirect cookie.
  // The loaded app sends its shell/feed/assets after authentication instead.
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.type !== 'warm' || !Array.isArray(event.data.urls)) return;
  event.waitUntil(Promise.allSettled(event.data.urls.slice(0, 256).map(url => {
    // Do not turn a previously streamed disc into an unsolicited full download.
    if (typeof url !== 'string' || /\.(?:chd|pbp)(?:[?#]|$)/i.test(url)) return;
    return warm(url);
  })));
});

async function fromCache(response, request) {
  const headers = new Headers(response.headers);
  if (request.method === 'HEAD') return new Response(null, {status:200, headers});
  const range = request.headers.get('Range');
  if (!range) return response;
  const blob = await response.blob(), match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = Number(match?.[1] || 0), end = match?.[2] ? Number(match[2]) : blob.size - 1;
  if (match && !match[1]) { start = Math.max(0, blob.size - end); end = blob.size - 1; }
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) || start < 0 || start >= blob.size || end < start) {
    return new Response(null, {status:416, headers:{'Content-Range':`bytes */${blob.size}`}});
  }
  end = Math.min(end, blob.size - 1);
  headers.set('Content-Range', `bytes ${start}-${end}/${blob.size}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  headers.delete('Content-Encoding');
  return new Response(blob.slice(start, end + 1), {status:206, headers});
}

async function serve(event, url, type) {
  const request = event.request, cache = await caches.open(CACHE);
  const cached = await cache.match(key(url, type));
  if (cached && self.navigator.onLine === false) return fromCache(cached, request);
  let timer;
  const network = fetch(request).then(async response => {
    const usable = await valid(response, type);
    if (request.method === 'GET' && !request.headers.has('Range')) {
      // Cache quota/write failures must never interrupt an online game.
      event.waitUntil(put(cache, url, response.clone(), type).catch(() => {}));
    }
    // An expired login answers a page load with a redirect to the sign-in page.
    // Follow it: the cached app would otherwise hide the expiry indefinitely,
    // and run without updates or cloud saves. Games open in a frame, where
    // the sign-in page cannot be shown, so they keep the cached copy.
    if (request.mode === 'navigate' && request.destination === 'document' &&
        response.type === 'opaqueredirect') return response;
    // Gateway failures and login HTML must not replace a working cached app.
    // Auth/API endpoints themselves are never intercepted.
    if (cached && response.status !== 206 && !usable) return fromCache(cached, request);
    return response;
  }).catch(() => {
    if (cached) return fromCache(cached, request);
    return new Response('This game or emulator is not fully cached. Open it while online, then try again.',
      {status:503, headers:{'Content-Type':'text/plain'}});
  });
  if (!cached) return network;
  // Connected Wi-Fi can still have no working route to the server. Keep the
  // fetch alive to refresh the cache, but don't stall an already cached launch.
  event.waitUntil(network.then(() => {}));
  try {
    return await Promise.race([network, new Promise(resolve => {
      timer = setTimeout(() => resolve(fromCache(cached, request)), 2000);
    })]);
  } finally { clearTimeout(timer); }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (!['GET', 'HEAD'].includes(request.method) || request.headers.has('Authorization') ||
      request.headers.has('X-Nextcloud-Authorization')) return;
  const url = new URL(request.url);
  if (url.origin === ORIGIN && url.pathname === '/' && request.mode === 'navigate') {
    // Keep relative library resources anchored at /play/ even on cold offline entry.
    event.respondWith(Promise.resolve(Response.redirect(ORIGIN + LIBRARY +
      '?feed=' + encodeURIComponent(new URL(FEED, ORIGIN).href), 302)));
    return;
  }
  const type = kind(url);
  if (type) event.respondWith(serve(event, url, type));
});
