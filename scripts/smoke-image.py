#!/usr/bin/env python3
"""Verify one-container HTTP, mounted BIOS, scheduled scans and safe shutdown.

Uses synthetic ROM/disc/key fixtures only, never accounts or operator files.
Usage: python3 scripts/smoke-image.py cloudrcade:test [linux/amd64|linux/arm64]
"""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import runpy
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

image = sys.argv[1]
platform = sys.argv[2] if len(sys.argv) > 2 else None
if platform not in (None, 'linux/amd64', 'linux/arm64'):
    raise SystemExit('Supported smoke-test platforms: linux/amd64, linux/arm64')
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
    for folder in [roms / 'nes/roms', roms / 'psp/roms', roms / 'fixtures', roms / '3DS/bios',
                   state / 'feeds', state / 'derived', bios]:
        folder.mkdir(parents=True, exist_ok=True)
    (roms / 'nes/roms/first.nes').write_bytes(b'NES\x1a' + bytes(12) + b'first-fixture')
    (roms / 'psp/roms/psp-fixture.elf').write_bytes(b'\x7fELF' + bytes(16))
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
    args = ['run', *(['--platform', platform] if platform else []), '-d', '--name', name, '-p', '127.0.0.1::443',
            '-e', 'WEBRCADE_APP_NAME=Release Test Arcade', '-e', 'WEBRCADE_FEED_TITLE=Release Test Arcade',
            '-e', 'WEBRCADE_STORAGE_PREFIX=release_test', '-e', 'WEBRCADE_SCAN_INTERVAL_SECONDS=2',
            '-e', 'WEBRCADE_REQUIRED_ROM_DIR=nes/roms', '-e', 'WEBRCADE_ENABLE_3DS=true',
            '-e', 'WEBRCADE_3DS_KEYS_FILE=/run/webrcade/3ds/aes_keys.txt', *mounts, image]
    try:
        docker(*args)
        info = json.loads(docker('inspect', name))[0]
        if platform:
            image_info = json.loads(docker('image', 'inspect', info['Image']))[0]
            assert image_info['Os'] + '/' + image_info['Architecture'] == platform, 'Wrong target image platform'
            machine = {'linux/amd64': 'x86_64', 'linux/arm64': 'aarch64'}[platform]
            assert docker('exec', name, 'uname', '-m').strip() == machine, 'Wrong runtime architecture'
        port = info['NetworkSettings']['Ports']['443/tcp'][0]['HostPort']
        origin = 'https://127.0.0.1:' + port

        def get(path):
            return urllib.request.urlopen(origin + path, context=tls, timeout=5)

        def items():
            feed = json.loads((state / 'feeds/combined.json').read_text())
            return [item for category in feed['categories'] for item in category['items']]

        until(lambda: any(item['title'] == 'first' for item in items()))
        assert any(item['title'] == 'psp-fixture' and item['type'] == 'psp' for item in items())
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
            assert '/touch-controls/viewport.css?v=' in html
            assert html.index('/touch-controls/category-art.js?v=') < html.index('/touch-controls/recently-played.js?v=') < html.index('/touch-controls/mobile.js?v=')
            revision = runpy.run_path('deploy/webrcade/patch-player.py')['player_revision']()
            assert '?wrcad=' + revision in html, 'player URL must include current notes as well as patch code'
            assert 'apple-mobile-web-app-status-bar-style" content="black"' in html and 'black-translucent' not in html
            assert '<div id="cr-status-top" aria-hidden="true"></div>' in html
            assert 'viewport-fit=cover' in html, 'initial library HTML must request the full viewport'
            assert '<title>cloudЯcade</title>' in html and '<title>webЯcade</title>' not in html
            apple = IconLinks(html).icons
            assert len(apple) == 1 and apple[0]['sizes'] == '180x180', 'Apple icon must exist before JS runs'
            with get(apple[0]['href']) as icon:
                assert icon.read() == Path('deploy/webrcade/touch/assets/cloudrcade-180.png').read_bytes()
        for asset in ['viewport.css', 'brand.js']:
            with get('/touch-controls/' + asset) as response:
                assert response.read() == Path('deploy/webrcade/touch/assets', asset).read_bytes(), 'shared viewport/status assets must match source'
        with get('/play/static/js/main.7ac86965.chunk.js') as response:
            player = response.read().decode()
            notes = json.loads(Path('src/react/screens/releasenotes/notes.json').read_text())
            assert json.dumps(notes, ensure_ascii=True, separators=(',', ':')) in player, 'published player must embed the current fork notes'
            assert 'WEB\\u042fCADE UPDATED' not in player, 'old upstream notes heading must not be rendered'
        for path in ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']:
            with get(path) as response:
                assert response.read() == Path('deploy/webrcade/touch/assets/cloudrcade-180.png').read_bytes()
        with get('/play/app/retro-ppsspp/') as response:
            psp_html = response.read().decode()
            assert '/arcade-bundles/retro-ppsspp/cloud-main.' in psp_html
            assert '/touch-controls/controller.js?v=' in psp_html
            assert 'viewport-fit=cover' in psp_html
        psp_main = re.search(r'src="([^"]*/arcade-bundles/retro-ppsspp/cloud-main\.[^"]+\.js)"', psp_html)
        assert psp_main, 'PSP wrapper script is missing'
        with get(psp_main.group(1)) as response:
            assert b'RETRO_PPSSPP:"retro-ppsspp"' in response.read(), 'PSP canonical app type is missing'
        with get('/play/app/retro-ppsspp/js/experimental-v2/ppsspp_libretro.wasm') as response:
            assert response.read(4) == b'\0asm'
        with get('/play/app/retro-ppsspp/assets/manifest.json') as response:
            assert 'compat.ini' in json.load(response)
        with get('/licenses/sources/psp-source.tar.gz') as response:
            assert response.read(2) == b'\x1f\x8b'
        with get('/cloud-saves/manifest.php') as response:
            manifest = json.load(response)
            assert manifest['name'] == 'Release Test Arcade' and manifest['start_url'] == '/play/'
            assert manifest['display'] == 'fullscreen' and manifest['display_override'] == ['fullscreen', 'standalone']
            assert any(icon.get('purpose') == 'maskable' and 'maskable-512.png' in icon['src'] for icon in manifest['icons'])
        with get('/touch-controls/cloudrcade-192.png') as response:
            assert response.read(8) == b'\x89PNG\r\n\x1a\n'
        with get('/play/app/retro-azahar/') as response:
            app_html = response.read().decode()
            assert '/touch-controls/viewport.css?v=' in app_html
            assert '/arcade-bundles/retro-azahar/cloud-main.' in app_html
            assert '/touch-controls/mobile.js' not in app_html, 'mobile library must not load in emulator frames'
            assert '/touch-controls/menus.css?v=' in app_html, 'game menus need the shared mobile UI stylesheet'
            assert len(IconLinks(app_html).icons) == 1, 'emulator initial HTML must include the Apple icon too'
            assert 'apple-mobile-web-app-status-bar-style" content="black"' in app_html and 'black-translucent' not in app_html
            assert '<div id="cr-status-top" aria-hidden="true"></div>' in app_html
            assert 'viewport-fit=cover' in app_html, 'initial game HTML must request the full viewport too'
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
        print('PASS ' + (platform or 'host platform') + ' one app: HTTP/3DS overlays, env branding, mounted key isolation, real CHD conversion, scheduled discovery, failed-scan preservation and graceful shutdown')
    except Exception:
        print(docker('logs', name, stderr=subprocess.STDOUT)[-6000:], file=sys.stderr)
        raise
    finally:
        subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
