/* Dropbox transport. Public app key + PKCE; credentials stay in this browser. */
(() => {
  'use strict';
  const config = window.WrcadCloudConfig || {};
  const prefix = config.storagePrefix || 'webrcade';
  const KEY = prefix + '.dropbox.connection.v1', FLOW = KEY + '.flow';
  const PROVIDER = prefix + '.cloud.provider.v1';
  const appKey = config.dropbox?.appKey || '';
  const API = 'https://api.dropboxapi.com', CONTENT = 'https://content.dropboxapi.com';
  const redirect = location.origin + '/cloud-saves/?provider=dropbox';
  const scopes = 'account_info.read files.metadata.read files.content.read files.content.write';
  const MAX_SAVE = 67108864;
  let refreshing;
  const error = (message, status = 502) => Object.assign(new Error(message), {status});
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY));
      return value?.appKey === appKey && typeof value.uid === 'string' && value.uid &&
        typeof value.refreshToken === 'string' && value.refreshToken ? value : null;
    } catch (_) { return null; }
  }
  const identity = value => value && JSON.stringify([value.appKey, value.uid, value.refreshToken]);
  function requireConnection(expected) {
    const value = read();
    if (!value || identity(value) !== identity(expected)) throw error('Cloud account changed. Reopen the game before using cloud saves.', 401);
    return value;
  }
  function selected() {
    try {
      const choice = localStorage.getItem(PROVIDER);
      if (['nextcloud', 'dropbox'].includes(choice)) return choice;
    } catch (_) {}
    return config.enabled ? 'nextcloud' : config.dropbox?.enabled ? 'dropbox' : 'nextcloud';
  }
  function ascii(value) {
    return JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  }
  async function token(values, signal) {
    const response = await fetch(API + '/oauth2/token', {method:'POST', cache:'no-store', credentials:'omit', redirect:'error', signal,
      headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({client_id:appKey, ...values})});
    const value = await response.json();
    if (!response.ok || !value.access_token || !Number.isFinite(value.expires_in))
      throw error(response.status === 400 || response.status === 401 ? 'Reconnect to Dropbox to access your saves.' : 'Dropbox could not refresh the connection.', response.status === 400 ? 401 : response.status);
    return value;
  }
  async function access(expected, force, signal) {
    const operation = async () => {
      let value = requireConnection(expected);
      if ((!force || value.accessToken !== expected.accessToken) && value.accessToken && value.expires > Date.now() + 60000) return value;
      const next = await token({grant_type:'refresh_token', refresh_token:value.refreshToken}, signal);
      value = requireConnection(expected);
      const updated = {...value, accessToken:next.access_token, expires:Date.now() + next.expires_in * 1000};
      localStorage.setItem(KEY, JSON.stringify(updated));
      return updated;
    };
    if (window.navigator?.locks) return navigator.locks.request(KEY + ':' + appKey, {signal}, operation);
    if (refreshing) { await refreshing; return operation(); }
    refreshing = operation();
    try { return await refreshing; } finally { refreshing = null; }
  }
  async function checked(response) {
    if (response.ok) return response;
    const data = await response.json().catch(() => ({}));
    const summary = data.error_summary || '';
    if (response.status === 401) throw error('Reconnect to Dropbox to access your saves.', 401);
    if (response.status === 409 && /^(path|path_lookup)\/not_found\//.test(summary)) throw error('Save not found.', 404);
    if (response.status === 409 && /insufficient_space/.test(summary)) throw error('Dropbox storage is full. Your local copy has been kept.', 507);
    if (response.status === 409 && /conflict|revision_mismatch/.test(summary)) throw error('This save changed on another device. Cloud upload was stopped and your local copy has been kept.', 409);
    if (response.status === 429) throw error('Dropbox is busy. Your local copy has been kept; try again shortly.', 429);
    throw error('Dropbox could not complete the save operation. Your local copy has been kept.', response.status === 409 ? 502 : response.status);
  }
  async function call(route, args, {expected = read(), body, signal, retry = true, guard = () => {}} = {}) {
    if (!config.dropbox?.enabled) throw error('Dropbox has not been enabled on this site.', 403);
    guard();
    const auth = await access(expected, false, signal);
    requireConnection(expected); guard();
    const content = ['files/upload', 'files/download'].includes(route);
    const response = await fetch((content ? CONTENT : API) + '/2/' + route, {method:'POST', credentials:'omit', redirect:'error', cache:'no-store', signal,
      headers:{Authorization:'Bearer ' + auth.accessToken,
        ...(content ? {'Dropbox-API-Arg':ascii(args), ...(route === 'files/upload' ? {'Content-Type':'application/octet-stream'} : {})} : {'Content-Type':'application/json'})},
      body:content ? body : JSON.stringify(args)});
    requireConnection(expected); guard();
    if (response.status === 401 && retry) {
      await access(auth, true, signal);
      return call(route, args, {expected, body, signal, retry:false, guard});
    }
    return checked(response);
  }
  function pathFor(path) {
    path = path?.replace(/^\/+/, '') || '';
    if (path.length > 1024 || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\.(zip|json)$/.test(path) || path.split('/').some(p => p === '.' || p === '..'))
      throw error('Invalid save path.', 400);
    const folder = config.dropbox.saveFolder ?? '';
    if (typeof folder !== 'string' || (folder !== '' && (!/^[A-Za-z0-9 _.-]{1,128}$/.test(folder) || ['.', '..'].includes(folder)))) throw error('Invalid save folder.', 400);
    return '/' + (folder ? folder + '/' : '') + path;
  }
  function revision(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]{9,}$/.test(value)) throw error('Dropbox did not return a valid save revision.');
    return '"' + value + '"';
  }
  async function request(action, {method = 'GET', path, body, extra = {}, uid, timeoutMs = 0, active = true} = {}) {
    const expected = read();
    if (!expected || expected.uid !== uid) throw error('Cloud account changed. Reopen the game before using cloud saves.', 401);
    const guard = () => { if (active && selected() !== 'dropbox') throw error('Cloud account changed. Reopen the game before using cloud saves.', 401); };
    guard();
    const signal = AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000);
    if (action === 'unlink') {
      await call('auth/token/revoke', null, {expected, signal, guard});
      return new Response(null, {status:204});
    }
    if (action !== 'file') throw error('Unsupported operation.', 405);
    const target = pathFor(path);
    const options = {expected, signal, guard};
    if (method === 'GET') {
      const response = await call('files/download', {path:target}, options);
      const metadata = JSON.parse(response.headers.get('Dropbox-API-Result') || '{}');
      return new Response(response.body, {headers:{ETag:revision(metadata.rev)}});
    }
    if (method === 'HEAD') {
      const metadata = await (await call('files/get_metadata', {path:target}, options)).json();
      requireConnection(expected);
      return new Response(null, {headers:{ETag:revision(metadata.rev)}});
    }
    const match = extra['If-Match'];
    if (match && !/^"[0-9a-f]{9,}"$/.test(match)) throw error('Invalid save revision.', 400);
    if (method === 'PUT') {
      if (!match && extra['If-None-Match'] !== '*') throw error('Save version is required.', 428);
      const blob = body instanceof Blob ? body : new Blob([body]);
      if (blob.size > MAX_SAVE) throw error('Save exceeds the 64 MB limit.', 413);
      const metadata = await (await call('files/upload', {path:target,
        mode:match ? {'.tag':'update', update:match.slice(1, -1)} : {'.tag':'add'},
        autorename:false, strict_conflict:true, mute:true}, {...options, body:blob})).json();
      requireConnection(expected);
      return new Response(null, {headers:{ETag:revision(metadata.rev)}});
    }
    if (method === 'DELETE') {
      // parent_rev makes the delete atomic against the observed version.
      if (!match) {
        const metadata = await (await call('files/get_metadata', {path:target}, options)).json();
        extra = {'If-Match':revision(metadata.rev)};
      }
      await call('files/delete_v2', {path:target, parent_rev:(match || extra['If-Match']).slice(1, -1)}, options);
      return new Response(null, {status:204});
    }
    throw error('Unsupported operation.', 405);
  }
  const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  async function begin(returnTo) {
    if (!config.dropbox?.enabled) throw error('Dropbox has not been enabled on this site.', 403);
    const verifier = random(), state = random();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem(FLOW, JSON.stringify({verifier, state, redirect, returnTo, appKey, previous:identity(read()), expires:Date.now() + 1200000}));
    const url = new URL('https://www.dropbox.com/oauth2/authorize');
    url.search = new URLSearchParams({client_id:appKey, response_type:'code', redirect_uri:redirect, state,
      code_challenge:challenge, code_challenge_method:'S256', token_access_type:'offline', scope:scopes});
    location.assign(url.href);
  }
  async function complete(params) {
    let flow;
    try { flow = JSON.parse(sessionStorage.getItem(FLOW)); } catch (_) {}
    if (!flow || flow.expires < Date.now() || flow.appKey !== appKey || flow.redirect !== redirect || params.get('state') !== flow.state)
      throw error('Dropbox sign-in expired or belongs to another browser tab. Link again.', 401);
    if (params.has('error')) { sessionStorage.removeItem(FLOW); throw error('Dropbox access was not granted. Your saves remain on this browser.', 401); }
    if (flow.credential) return finishLogin(flow);
    const pendingState = sessionStorage.getItem(FLOW);
    const value = await token({grant_type:'authorization_code', code:params.get('code'), code_verifier:flow.verifier, redirect_uri:redirect}, AbortSignal.timeout(60000));
    // Keep the exchanged credential until account lookup finishes, so an outage
    // after the one-shot code exchange does not force a new grant.
    if (sessionStorage.getItem(FLOW) !== pendingState) throw error('Cloud sign-in changed. Link again.', 401);
    flow.credential = value; flow.credentialExpires = Date.now() + value.expires_in * 1000; delete flow.verifier;
    sessionStorage.setItem(FLOW, JSON.stringify(flow));
    return finishLogin(flow);
  }
  async function finishLogin(flow) {
    let value = flow.credential;
    if (flow.credentialExpires <= Date.now() + 60000) {
      const next = await token({grant_type:'refresh_token', refresh_token:value.refresh_token}, AbortSignal.timeout(60000));
      value = {...value, ...next}; flow.credential = value; flow.credentialExpires = Date.now() + next.expires_in * 1000;
      sessionStorage.setItem(FLOW, JSON.stringify(flow));
    }
    const response = await checked(await fetch(API + '/2/users/get_current_account', {method:'POST', credentials:'omit', redirect:'error', cache:'no-store',
      headers:{Authorization:'Bearer ' + value.access_token}, signal:AbortSignal.timeout(60000)}));
    const user = await response.json();
    if (!user.account_id || !value.refresh_token || (value.account_id && value.account_id !== user.account_id)) throw error('Dropbox did not identify the account. Link again.');
    const pending = JSON.parse(sessionStorage.getItem(FLOW) || 'null');
    if (pending?.state !== flow.state || flow.expires < Date.now() || identity(read()) !== flow.previous)
      throw error('Cloud account changed during sign-in. Link again.', 401);
    localStorage.setItem(KEY, JSON.stringify({uid:user.account_id, name:user.name?.display_name || user.account_id,
      appKey, accessToken:value.access_token, refreshToken:value.refresh_token, expires:flow.credentialExpires}));
    sessionStorage.removeItem(FLOW);
    return flow.returnTo;
  }
  async function verify() {
    const expected = read();
    const user = await (await call('users/get_current_account', null, {expected, signal:AbortSignal.timeout(60000)})).json();
    requireConnection(expected);
    if (user.account_id !== expected.uid) throw error('Dropbox account changed. Link again.', 401);
  }
  async function manage({params, returnTo}) {
    const $ = selector => document.querySelector(selector);
    document.title = 'Dropbox saves · ' + config.appName;
    $('#app-name').textContent = config.appName;
    $('#description').textContent = 'Connect Dropbox to sync game saves, save states, controller settings and Recently Played across devices.';
    $('#connect').textContent = 'Link Dropbox';
    $('#login').hidden = $('#direct-login').hidden = true;
    const fail = e => { $('#status').textContent = e.message; $('#connect').disabled = false;
      if (e.status === 401) { $('#connect').hidden = false; $('#connect').textContent = 'Reconnect Dropbox'; } };
    const show = () => {
      const value = read();
      $('#connect').hidden = Boolean(value); $('#disconnect').hidden = !value; $('#use-provider').hidden = !value;
      $('#status').textContent = value ? `Connected as ${value.name}. Saves use ${config.dropbox.saveFolder ? config.dropbox.saveFolder + ' inside this app’s Dropbox folder' : 'this app’s Dropbox folder'}.` : 'Sign in to Dropbox to connect your saves.';
    };
    const finish = async target => {
      const url = new URL(target || returnTo, location.origin);
      localStorage.setItem(PROVIDER, 'dropbox'); localStorage.removeItem(KEY + '.paused');
      location.replace(url.origin === location.origin && url.pathname.startsWith('/play/') ? url.href : '/play/');
    };
    $('#connect').onclick = () => { $('#connect').disabled = true; begin(returnTo).catch(fail); };
    $('#use-provider').onclick = () => verify().then(() => finish()).catch(fail);
    $('#disconnect').onclick = async () => {
      const expected = read();
      try {
        await request('unlink', {method:'POST', uid:expected?.uid, active:false});
        if (identity(read()) === identity(expected)) { localStorage.removeItem(KEY); localStorage.setItem(KEY + '.paused', 'true'); }
        show(); $('#status').textContent = 'Disconnected. Your saved files remain in Dropbox.';
      } catch (e) { fail(e); }
    };
    if (!config.dropbox?.enabled) { $('#connect').hidden = true; fail(error('Dropbox has not been enabled on this site.')); return; }
    show();
    try {
      if (params.has('code') || params.has('error')) { await finish(await complete(params)); return; }
      let flow; try { flow = JSON.parse(sessionStorage.getItem(FLOW)); } catch (_) {}
      if (flow?.credential && flow.expires > Date.now() && flow.appKey === appKey) { await finish(await finishLogin(flow)); return; }
      if (params.get('connect') === '1') {
        if (read()) { await verify(); await finish(); } else await begin(returnTo);
      }
    } catch (e) { fail(e); }
  }
  window.WrcadDropbox = {key:KEY, providerKey:PROVIDER, selected, read, request, begin, complete, verify, manage};
})();
