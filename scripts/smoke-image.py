#!/usr/bin/env python3
"""Verify one-container HTTP, mounted BIOS, scheduled scans and safe shutdown.

Uses synthetic ROM/disc/key fixtures only, never accounts or operator files.
Usage: python3 scripts/smoke-image.py cloudrcade:test
"""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

image = sys.argv[1]
name = 'cloudrcade-smoke-' + uuid.uuid4().hex[:10]
tls = ssl._create_unverified_context()

def docker(*args, **kwargs):
    return subprocess.check_output(['docker', *args], text=True, **kwargs).strip()

def until(check, timeout=60):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            result = check()
            if result:
                return result
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(0.5)
    raise AssertionError('Timed out waiting for the integrated app')

class IconLinks(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.icons = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'link' and attrs.get('rel') == 'apple-touch-icon':
            self.icons.append(attrs)

with tempfile.TemporaryDirectory(prefix='cloudrcade-smoke-') as temp:
    root = Path(temp)
    roms, state, bios = root / 'roms', root / 'data', root / 'bios'
    for folder in [roms / 'nes/roms', roms / 'fixtures', roms / '3DS/bios',
                   state / 'feeds', state / 'derived', bios]:
        folder.mkdir(parents=True, exist_ok=True)
    (roms / 'nes/roms/first.nes').write_bytes(b'NES\x1a' + bytes(12) + b'first-fixture')
    (roms / 'fixtures/disc.bin').write_bytes(bytes(2352 * 32))
    (roms / 'fixtures/disc.cue').write_text('FILE "disc.bin" BINARY\n TRACK 01 MODE1/2352\n INDEX 01 00:00:00\n')
    synthetic_keys = 'slot0x18KeyX=' + '00' * 16 + '\n'
    (bios / 'aes_keys.txt').write_text(synthetic_keys)
    (roms / '3DS/bios/aes_keys.txt').write_text(synthetic_keys)
    mounts = []
    for source, target, readonly in [(roms, '/var/www/html/content', True),
                                     (state, '/data', False),
                                     (state / 'derived', '/var/www/html/derived', True),
                                     (bios, '/run/webrcade/3ds', True)]:
        mounts += ['--mount', f'type=bind,src={source},dst={target}' + (',readonly' if readonly else '')]
    args = ['run', '-d', '--name', name, '-p', '127.0.0.1::443',
            '-e', 'WEBRCADE_APP_NAME=Release Test Arcade', '-e', 'WEBRCADE_FEED_TITLE=Release Test Arcade',
            '-e', 'WEBRCADE_STORAGE_PREFIX=release_test', '-e', 'WEBRCADE_SCAN_INTERVAL_SECONDS=2',
            '-e', 'WEBRCADE_REQUIRED_ROM_DIR=nes/roms', '-e', 'WEBRCADE_ENABLE_3DS=true',
            '-e', 'WEBRCADE_3DS_KEYS_FILE=/run/webrcade/3ds/aes_keys.txt', *mounts, image]
    try:
        docker(*args)
        info = json.loads(docker('inspect', name))[0]
        port = info['NetworkSettings']['Ports']['443/tcp'][0]['HostPort']
        origin = 'https://127.0.0.1:' + port

        def get(path):
            return urllib.request.urlopen(origin + path, context=tls, timeout=5)

        def items():
            feed = json.loads((state / 'feeds/combined.json').read_text())
            return [item for category in feed['categories'] for item in category['items']]

        until(lambda: any(item['title'] == 'first' for item in items()))
        # Real tool conversion without supplying a copyrighted PSX BIOS to CI.
        docker('exec', name, 'chdman', 'createcd', '-np', '4', '-i',
               '/var/www/html/content/fixtures/disc.cue', '-o', '/data/derived/smoke-disc.chd')
        until(lambda: bool(list((state / 'derived').glob('*.chd'))))
        response = until(lambda: get('/cloud-saves/api.php?action=status'))
        config = json.load(response)['config']
        assert config['appName'] == 'Release Test Arcade' and config['storagePrefix'] == 'release_test'
        assert not config['enabled'] and not config['autoRedirect']
        assert config['n3dsKeysUrl'] == '/cloud-saves/3ds-keys.php'
        with get(config['n3dsKeysUrl']) as response:
            assert response.read().decode() == synthetic_keys
            assert 'no-store' in response.headers['Cache-Control']
            assert response.headers['Cross-Origin-Resource-Policy'] == 'same-origin'
            assert not response.headers.get('Access-Control-Allow-Origin')
        try:
            get('/content/3DS/bios/aes_keys.txt')
            raise AssertionError('Static runtime keys were exposed')
        except urllib.error.HTTPError as error:
            assert error.code == 403
        with get('/play/') as response:
            html = response.read().decode()
            assert '/touch-controls/brand.js' in html and '/cloud-saves/config.php' in html
            assert '/touch-controls/mobile.js?v=' in html and '/touch-controls/mobile.css?v=' in html
            assert '/touch-controls/menus.css?v=' in html
            assert html.index('/touch-controls/category-art.js?v=') < html.index('/touch-controls/recently-played.js?v=') < html.index('/touch-controls/mobile.js?v=')
            assert 'apple-mobile-web-app-capable' in html and 'black-translucent' in html
            assert '<title>cloudЯcade</title>' in html and '<title>webЯcade</title>' not in html
            apple = IconLinks(html).icons
            assert len(apple) == 1 and apple[0]['sizes'] == '180x180', 'Apple icon must exist before JS runs'
            with get(apple[0]['href']) as icon:
                assert icon.read() == Path('deploy/webrcade/touch/assets/cloudrcade-180.png').read_bytes()
        for path in ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']:
            with get(path) as response:
                assert response.read() == Path('deploy/webrcade/touch/assets/cloudrcade-180.png').read_bytes()
        with get('/cloud-saves/manifest.php') as response:
            manifest = json.load(response)
            assert manifest['name'] == 'Release Test Arcade' and manifest['start_url'] == '/play/'
            assert manifest['display'] == 'fullscreen' and manifest['display_override'] == ['fullscreen', 'standalone']
            assert any(icon.get('purpose') == 'maskable' and 'maskable-512.png' in icon['src'] for icon in manifest['icons'])
        with get('/touch-controls/cloudrcade-192.png') as response:
            assert response.read(8) == b'\x89PNG\r\n\x1a\n'
        with get('/play/app/retro-azahar/') as response:
            app_html = response.read().decode()
            assert '/arcade-bundles/retro-azahar/cloud-main.' in app_html
            assert '/touch-controls/mobile.js' not in app_html, 'mobile library must not load in emulator frames'
            assert '/touch-controls/menus.css?v=' in app_html, 'game menus need the shared mobile UI stylesheet'
            assert len(IconLinks(app_html).icons) == 1, 'emulator initial HTML must include the Apple icon too'
        # A second scan discovers newly added files without a container restart.
        (roms / 'nes/roms/second.nes').write_bytes(b'NES\x1a' + bytes(12) + b'second-fixture')
        until(lambda: any(item['title'] == 'second' for item in items()))
        feed_before = hashlib.sha256((state / 'feeds/combined.json').read_bytes()).digest()
        (roms / 'nes/roms').rename(roms / 'nes/unavailable')
        until(lambda: 'Feed scan failed' in docker('logs', name, stderr=subprocess.STDOUT))
        assert hashlib.sha256((state / 'feeds/combined.json').read_bytes()).digest() == feed_before
        (roms / 'nes/unavailable').rename(roms / 'nes/roms')
        docker('exec', name, 'python3', '/usr/local/share/cloudrcade/service.py', 'scan')
        docker('stop', '--time', '12', name)
        assert json.loads(docker('inspect', name))[0]['State']['ExitCode'] == 0
        print('PASS one app: HTTP/3DS overlays, env branding, mounted key isolation, real CHD conversion, scheduled discovery, failed-scan preservation and graceful shutdown')
    except Exception:
        print(docker('logs', name, stderr=subprocess.STDOUT)[-6000:], file=sys.stderr)
        raise
    finally:
        subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
