#!/usr/bin/env python3
"""Check an Authentik-protected deployment without account login or secret output.

python3 scripts/check-auth-proxy.py --origin https://arcade.example.com
Creates a disposable pending OAuth cookie, checks the worker update race and
verifies sensitive routes remain protected. Does not redeem an OAuth code or
read games, keys, user data or cloud credentials.
"""
import argparse
import http.cookiejar
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', required=True)
    origin = parser.parse_args().origin.rstrip('/')
    parsed = urllib.parse.urlsplit(origin)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.path or parsed.query or parsed.fragment:
        parser.error('origin must be an HTTPS origin without a path or query')
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect)

    def get(path, client=opener):
        try:
            return client.open(origin + path, timeout=20)
        except urllib.error.HTTPError as error:
            return error

    with get('/outpost.goauthentik.io/start?rd=' + urllib.parse.quote(origin + '/play/', safe='')) as response:
        assert response.status == 302, 'outpost must start the authentication redirect'
    pending = {cookie.name: cookie.value for cookie in jar if cookie.name.startswith('authentik_proxy_')}
    assert pending, 'outpost did not issue a pending session cookie'
    worker = '/touch-controls/offline-worker.js'
    for path in [worker, worker + '?cache=proxy-regression&feed=%2Fcontent%2Ffeeds%2Fcombined.json']:
        with get(path) as response:
            assert response.status == 200, 'worker update is still protected'
            assert 'javascript' in response.headers.get('Content-Type', ''), 'worker must be JavaScript'
            assert not response.headers.get('Set-Cookie'), 'worker must not change the pending session'
        current = {cookie.name: cookie.value for cookie in jar if cookie.name in pending}
        assert current == pending, 'worker update deleted or replaced the pending session cookie'
    print('PASS worker updates preserve the pending sign-in cookie, including query strings')
    anonymous = urllib.request.build_opener(NoRedirect)
    for path in ['/play/', '/content/feeds/combined.json', '/cloud-saves/config.php',
                 '/cloud-saves/api.php?action=status', '/cloud-saves/system-keys.php']:
        with get(path, anonymous) as response:
            assert response.status in (302, 401, 403), 'sensitive route exposed: ' + path
    print('PASS library, feed, configuration, cloud API and external key endpoint remain protected')


if __name__ == '__main__':
    main()
