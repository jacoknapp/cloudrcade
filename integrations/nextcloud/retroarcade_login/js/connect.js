(() => {
  'use strict';
  const init = () => {
    const root = document.getElementById('retroarcade-connect');
    if (!root) return;
    const status = document.getElementById('retroarcade-status');
    const form = document.getElementById('retroarcade-confirm');
    const password = document.getElementById('retroarcade-password');
    const csrf = document.head.dataset.requesttoken;
    async function post(url, values) {
      return fetch(url, {method: 'POST', credentials: 'same-origin', headers: {
        'Content-Type': 'application/x-www-form-urlencoded', 'requesttoken': csrf, 'Accept': 'application/json',
      }, body: new URLSearchParams(values)});
    }
    async function grant() {
      try {
        const response = await post(root.dataset.grant, {stateToken: root.dataset.state});
        if (response.headers.get('X-NC-Auth-NotConfirmed') === 'true') {
          form.hidden = false;
          status.textContent = 'Nextcloud needs password confirmation to finish connecting.';
          password.focus();
          return;
        }
        if (!response.ok || response.redirected) throw new Error('Please continue manually to finish connecting.');
        location.replace(root.dataset.callback);
      } catch (error) { status.textContent = error.message; }
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button'); button.disabled = true;
      try {
        const response = await post(root.dataset.confirm, {password: password.value});
        password.value = '';
        if (!response.ok || response.redirected) throw new Error('Password confirmation failed. Please try again.');
        form.hidden = true; status.textContent = 'Connecting…';
        await grant();
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    });
    grant();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true}); else init();
})();
