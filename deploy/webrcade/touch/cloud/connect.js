(() => {
  'use strict';
  const prefix = window.WrcadCloudConfig?.storagePrefix || 'webrcade';
  const $ = s => document.querySelector(s);
  const KEY = prefix + '.nextcloud.connection.v1';
  const RETURN_KEY = prefix + '.nextcloud.return.v1';
  const params = new URLSearchParams(location.search);
  let csrf, timer, loginWindow, connection = null, config = {enabled:false, autoRedirect:false, server:''};
  try { connection = JSON.parse(localStorage.getItem(KEY)); } catch (_) {}
  let savedReturn;
  try { savedReturn = sessionStorage.getItem(RETURN_KEY); } catch (_) {}
  let returnTo = '/play/';
  try {
    const target = new URL(params.get('return') || savedReturn || '/play/', location.origin);
    if (target.origin === location.origin && target.pathname.startsWith('/play/')) returnTo = target.href;
  } catch (_) {}
  try { sessionStorage.setItem(RETURN_KEY, returnTo); } catch (_) {}
  $('#return').href = returnTo;
  function authHeaders() {
    if (!connection) return {};
    return {'X-Nextcloud-Authorization': 'Basic ' + btoa(unescape(encodeURIComponent(connection.login + ':' + connection.password))),
      'X-Nextcloud-User': encodeURIComponent(connection.uid), 'X-Nextcloud-Server':config.server};
  }
  async function request(action, method = 'POST', extra = {}) {
    const response = await fetch(`api.php?action=${action}`, {method, headers: {...authHeaders(), ...(csrf ? {'X-CSRF-Token': csrf} : {}), ...extra}});
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'Connection failed. Please try again.');
      error.status = response.status; error.code = data.code; throw error;
    }
    if (data.csrf) csrf = data.csrf;
    return data;
  }
  function show(data) {
    $('#connect').hidden = data.connected;
    $('#disconnect').hidden = !data.connected;
    if (data.connected) $('#status').textContent = `Connected${data.user ? ' as ' + data.user : ''}. Saves use your ${config.saveFolder} folder.`;
  }
  function finish() {
    try { loginWindow?.close(); } catch (_) {}
    localStorage.removeItem(KEY + '.enable');
    localStorage.removeItem(KEY + '.paused');
    sessionStorage.removeItem(KEY + '.attempt');
    location.replace(returnTo);
  }
  function denied(message = config.message) {
    clearTimeout(timer);
    try { loginWindow?.close(); } catch (_) {}
    sessionStorage.setItem(KEY + '.notice', message);
    sessionStorage.setItem(KEY + '.attempt', 'true');
    // Clear our pending flow without holding the return navigation on network IO.
    if (csrf) fetch('api.php?action=cancel', {method:'POST', keepalive:true,
      headers:{'X-CSRF-Token':csrf}}).catch(() => {});
    location.replace(returnTo);
  }
  function failure(error) {
    if (['access_denied','nextcloud_disabled'].includes(error.code)) { denied(error.message); return; }
    $('#status').textContent = error.message; $('#connect').disabled = false;
  }
  async function poll() {
    try {
      const data = await request('poll');
      if (data.connected) {
        connection = data.connection;
        localStorage.setItem(KEY, JSON.stringify(connection));
        // A lost acknowledgement must not prevent using an already-saved credential.
        if (data.receipt) try { await request('ack', 'POST', {'X-Login-Receipt': data.receipt}); } catch (_) {}
        finish();
      } else timer = setTimeout(poll, 2000);
    } catch (e) { failure(e); }
  }
  function fallbackLinks(data) {
    $('#login').href = data.login; $('#login').hidden = false;
    $('#direct-login').href = data.directLogin; $('#direct-login').hidden = false;
  }
  async function begin() {
    localStorage.removeItem(KEY + '.paused');
    $('#connect').disabled = true;
    clearTimeout(timer);
    try {
      if (!csrf) await request('status', 'GET');
      const data = await request('login');
      if (data.ready) { await poll(); return; }
      fallbackLinks(data);
      $('#status').textContent = 'Connecting to Nextcloud…';
      if (!data.start) {
        // Native Flow v2 has no return callback. Keep this page polling while
        // approval happens on Nextcloud; the visible link handles blocked popups.
        $('#status').textContent = 'Finish sign-in and approval in Nextcloud. If no sign-in tab opened, use the sign-in link. Your game will resume when access is granted.';
        loginWindow = window.open(data.login, '_blank', 'noopener');
        poll(); return;
      }
      // Use this tab: delayed automatic popups are blocked on mobile browsers.
      // The Nextcloud handoff accepts this POST only from the RetroArcade origin.
      const form = document.createElement('form');
      form.method = 'POST'; form.action = data.start;
      const flow = document.createElement('input');
      flow.type = 'hidden'; flow.name = 'flow'; flow.value = data.flow;
      form.append(flow); document.body.append(form); form.submit();
    } catch (e) { failure(e); }
  }
  $('#connect').onclick = begin;
  $('#disconnect').onclick = async () => {
    try {
      await request('unlink');
      localStorage.setItem(KEY + '.paused', 'true');
      localStorage.removeItem(KEY); connection = null; show({connected:false});
      $('#status').textContent = 'Disconnected. Your saved files remain in Nextcloud.';
    }
    catch (e) { $('#status').textContent = e.message; }
  };
  // Back from sign-in returns to a recoverable page, without an auto-start loop.
  history.replaceState(null, '', location.pathname);
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  request('status', 'GET').then(async status => {
    config = status.config;
    document.title = 'Nextcloud saves · ' + config.appName;
    $('#app-name').textContent = config.appName; $('#save-folder').textContent = config.saveFolder;
    if (!config.enabled || !config.accessAllowed || params.get('error') === 'access_denied') { denied(); return; }
    if (connection && (connection.server || config.legacyServer) !== config.server) connection = null;
    show({connected:Boolean(connection), user:connection?.name});
    if (params.get('resume') === '1') {
      $('#status').textContent = 'Finishing your Nextcloud connection…';
      await poll(); return;
    }
    if (params.get('auto') === '1' && !config.autoRedirect) { location.replace(returnTo); return; }
    if (params.get('connect') === '1' || params.get('auto') === '1') {
      if (connection) {
        try { await request('verify'); finish(); return; }
        catch (e) {
          if (e.status !== 401) throw e;
          localStorage.removeItem(KEY); connection = null; show({connected:false});
        }
      }
      await begin();
    } else if (!connection && status.pending) {
      const pending = await request('login');
      if (!pending.ready) fallbackLinks(pending);
      $('#status').textContent = 'Continue connecting, or use a sign-in option below if needed.';
      poll();
    }
  }).catch(failure);
})();
