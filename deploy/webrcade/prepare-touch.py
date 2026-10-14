#!/usr/bin/env python3
"""Generate touch controls and Nextcloud overlays from the pinned image."""
from pathlib import Path
import subprocess
import tempfile
import re
import os
import hashlib
import runpy
import shutil

patch_sameboy = runpy.run_path(str(Path(__file__).with_name("patch-clock-core.py")))["patch_sameboy"]

IMAGE = 'webrcade/webrcade@sha256:77789de80c2963d58631b57306335638eec8f6425c66b7d6868576f0ea5f7a49'
ROOT = Path(os.environ.get('WEBRCADE_TOUCH_ROOT', str(Path(__file__).parent / 'touch/pages')))
SOURCE_ROOT = os.environ.get('WEBRCADE_SOURCE_ROOT')
def controller_asset(name):
    revision = hashlib.sha256((Path(__file__).parent / 'touch/assets' / name).read_bytes()).hexdigest()[:16]
    return '/touch-controls/' + name + '?v=' + revision

def cloud_asset(name):
    revision = hashlib.sha256((Path(__file__).parent / 'touch/cloud' / name).read_bytes()).hexdigest()[:16]
    return '/cloud-saves/' + name + '?v=' + revision

MENU_INCLUDE = ('<link rel="stylesheet" href="' + controller_asset('viewport.css') + '">'
                '<link rel="stylesheet" href="' + controller_asset('menus.css') + '">')
ICON_VERSION = hashlib.sha256((Path(__file__).parent / 'touch/assets/cloudrcade.svg').read_bytes()).hexdigest()[:16]
# Safari's native UI can inspect HTML before the deferred brand adapter runs.
ICON_INCLUDE = ('<link rel="icon" type="image/png" sizes="32x32" href="/touch-controls/cloudrcade-32.png?v=' + ICON_VERSION + '">'
                '<link rel="icon" type="image/svg+xml" href="/touch-controls/cloudrcade.svg?v=' + ICON_VERSION + '">'
                '<link rel="apple-touch-icon" sizes="180x180" href="/touch-controls/cloudrcade-180.png?v=' + ICON_VERSION + '">'
                '<link rel="manifest" href="/cloud-saves/manifest.php">')
INCLUDE = (MENU_INCLUDE + '<script defer src="' + controller_asset('brand.js') + '"></script><link rel="stylesheet" href="' + controller_asset('controller.css') + '">'
           '<script defer src="' + controller_asset('controller.js') + '"></script>'
           '<script defer src="' + controller_asset('offline.js') + '"></script>')
LIBRARY_INCLUDE = MENU_INCLUDE + '<script defer src="' + controller_asset('brand.js') + '"></script><script defer src="' + controller_asset('offline.js') + '"></script>'
EXTRA_APPS = Path(os.environ.get('WEBRCADE_EXTRA_APPS', str(Path(__file__).parent / 'touch/apps')))
PSX_ONLY = os.environ.get('WEBRCADE_PSX_ONLY') == '1'

def overlay(relative, source, original, bundle, mains, tmp):
    """Write the patched entry point (and bundle) for one library or emulator page."""
    psx = str(relative) == 'app/psx/index.html'
    if psx:
        patch_psx_stream = runpy.run_path(str(Path(__file__).with_name('patch-psx-stream.py')))['patch_psx_stream']
        bundle = patch_psx_stream(bundle)
        original = original.replace('<head>', '<head><script src="' + controller_asset('psx-stream.js') + '"></script>', 1)
    names = re.findall(r'this\["(webpackJsonp[^"\]]+)"\]', bundle[:300])
    assert names and len(set(names)) == 1, source
    cloud = '<script src="/cloud-saves/config.php"></script><script src="' + cloud_asset('runtime.js') + '"></script><script src="/cloud-saves/clock.js?v=1"></script><script src="' + cloud_asset('bridge.js') + '"></script><script>WrcadCloud.attachChunk(' + repr(names[0]) + ');</script>'
    if str(relative) == 'index.html':
        cloud += '<script defer src="' + controller_asset('gamecube-recovery.js') + '"></script>'
        cloud += '<script src="' + controller_asset('category-art.js') + '"></script>'
        cloud += '<script src="' + controller_asset('recently-played.js') + '"></script>'
        cloud += '<link rel="stylesheet" href="' + controller_asset('mobile.css') + '"><script src="' + controller_asset('mobile.js') + '"></script>'
        # The upstream filename hash does not change when we patch it.
        # Give each local patch revision a new URL to bypass old caches.
        revision = runpy.run_path(str(Path(__file__).with_name('patch-player.py')))['player_revision']()
        original = original.replace('src="' + mains[0] + '"',
            'src="' + mains[0] + '?wrcad=' + revision + '"', 1)
    # Emulator builds concatenate these classes inside one module, so
    # they do not appear in webpack exports. Expose only the adapter's
    # three required interfaces before the first SaveManager is made.
    if 'this.saveManager=new ' in bundle:
        cloud_tabs = re.findall(r'\.cloudStorageRef=([\w$]+)\.a\.createRef\(\)(.*?)\.contextType=[\w$]+;', bundle, re.S)
        assert len(cloud_tabs) == 1, ('Unexpected cloud settings tab', source)
        react, tab_source = cloud_tabs[0]
        tab = re.findall(r';([\w$]+)$', tab_source)
        providers = re.findall(r'([\w$]+)\.link\(\)\.catch', tab_source)
        assert len(tab) == len(providers) == 1, ('Unexpected cloud settings interfaces', source)
        context = re.search(re.escape(tab[0]) + r'\.contextType=[\w$]+;', bundle).group()
        bundle = bundle.replace(context, context +
            f'window.WrcadCloud.installUI({{react:{react}.a,CloudStorageTab:{tab[0]},storage:{providers[0]}}});', 1)
        settings = re.findall(r'\w+\.instance\.setSettings\(([\w$]+)\);', bundle)
        managers = re.findall(r'this\.saveManager=new ([\w$]+)\(', bundle)
        storage = re.findall(r'loadCloud=function\([^)]*\).{0,250}?Promise\.resolve\(([\w$]+)\.downloadFile\(', bundle)
        assert len(settings) == len(managers) == len(storage) == 1, source
        marker = f'.instance.setSettings({settings[0]});'
        bundle = bundle.replace(marker, marker + f'window.WrcadCloud.install({{settings:{settings[0]}}});', 1)
        bundle = bundle.replace(f'this.saveManager=new {managers[0]}(',
            'this.saveManager=new (window.WrcadCloud.install({' +
            f'settings:{settings[0]},storage:{storage[0]},saves:{managers[0]}' +
            '}),' + managers[0] + ')(', 1)
        if relative.parts[1] == 'retro-sameboy':
            core_dir = ROOT / relative.parent
            core_dir.mkdir(parents=True, exist_ok=True)
            for extension in ['js', 'wasm']:
                core_source = str(Path(source).parent / 'js' / ('sameboy_libretro.' + extension))
                local = Path(tmp) / ('sameboy_libretro.' + extension)
                copy_source(core_source, local)
                target_core = core_dir / ('clock-core.' + extension)
                staged_core = target_core.with_suffix(target_core.suffix + '.new')
                if extension == 'wasm':
                    staged_core.write_bytes(patch_sameboy(local.read_bytes()))
                else:
                    core_js = local.read_text()
                    assert core_js.count('"sameboy_libretro.wasm"') == 1
                    staged_core.write_text(core_js.replace('"sameboy_libretro.wasm"', '"clock-core.wasm"'))
                staged_core.chmod(0o644)
                staged_core.replace(target_core)
            assert bundle.count('"js/sameboy_libretro.js"') == 1
            bundle = bundle.replace('"js/sameboy_libretro.js"', '"/arcade-bundles/retro-sameboy/clock-core.js"')
        # Runtime namespace configuration also applies to locally built 3DS keys.
        bundle = re.sub(r'(["\'])wrcad(\.[A-Za-z0-9_.-]+)\1',
                        lambda m: '((window.WrcadCloudConfig&&window.WrcadCloudConfig.storagePrefix)||"webrcade")+' + repr(m[2]), bundle)
        extra_app = EXTRA_APPS.joinpath(relative.parts[1], 'index.html').is_file()
        bundle_name = ('cloud-main.' + hashlib.sha256(bundle.encode()).hexdigest()[:16] + '.js'
                       if extra_app or psx else 'cloud-main.js')
        bundle_target = ROOT / relative.parent / bundle_name
        bundle_target.parent.mkdir(parents=True, exist_ok=True)
        staged_bundle = bundle_target.with_suffix('.new')
        staged_bundle.write_text(bundle)
        staged_bundle.chmod(0o644)
        staged_bundle.replace(bundle_target)
        bundle_url = '/arcade-bundles/' + relative.parts[1] + '/' + bundle_name
        original = original.replace('src="' + mains[0] + '"', 'src="' + bundle_url + '"', 1)
    # The adapter must run before inline webpack bootstrap code, not defer.
    original = original.replace('<head>', '<head><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black">' + cloud, 1)
    original, body_count = re.subn(r'(<body\b[^>]*>)',
        r'\1<div id="cr-status-top" aria-hidden="true"></div>', original, count=1)
    assert body_count == 1, ('Unexpected body markup', source)
    original = re.sub(r'<title>.*?</title>', '<title>cloudЯcade</title>', original, flags=re.S)
    # Include this before JS runs, in game frames as well as the library.
    def cover_viewport(match):
        content = re.sub(r',?\s*viewport-fit\s*=\s*\w+', '', match[2])
        return match[1] + content + ', viewport-fit=cover' + match[3]
    original, viewport_count = re.subn(
        r'(<meta\b[^>]*name="viewport"[^>]*content=")([^"]*)(")', cover_viewport, original)
    assert viewport_count == 1, ('Unexpected viewport metadata', source)
    # Supply icons in the initial HTML as well as the runtime brand adapter.
    original = re.sub(r'<link\b[^>]*rel=["\'](?:icon|apple-touch-icon|manifest)["\'][^>]*>', '', original)
    original = original.replace('<head>', '<head>' + ICON_INCLUDE, 1)
    original = re.sub(r'(<meta\b[^>]*name="description"[^>]*content=")[^"]*(")', r'\1cloudЯcade — games in your browser.\2', original)
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    staged = target.with_suffix('.new')
    staged.write_text(original.replace('</head>', (LIBRARY_INCLUDE if str(relative) == 'index.html' else INCLUDE) + '</head>'))
    staged.chmod(0o644)
    staged.replace(target)

def prepare_local_apps(tmp):
    # Locally built apps (e.g. the Nintendo 3DS app) live outside the pinned image.
    # Apache serves their files from EXTRA_APPS; only the entry point is overlaid.
    for index in sorted(EXTRA_APPS.glob('*/index.html')) if EXTRA_APPS.is_dir() else []:
        relative = Path('app') / index.parent.name / 'index.html'
        original = index.read_text()
        assert original.count('</head>') == 1, index
        mains = re.findall(r'<script[^>]+src="([^"]*/main\.[^"]+\.js)"', original)
        assert len(mains) == 1, index
        bundle = (index.parent / mains[0]).read_text()
        overlay(relative, str(index), original, bundle, mains, tmp)

# Extra-only publication validates the local app without touching other emulators.
if os.environ.get('WEBRCADE_EXTRA_ONLY') == '1':
    with tempfile.TemporaryDirectory() as tmp:
        prepare_local_apps(tmp)
    print('Prepared local app controller and Nextcloud overlays')
    raise SystemExit(0)

container = None if SOURCE_ROOT else subprocess.check_output(['docker', 'create', IMAGE], text=True).strip()
def copy_source(source, target):
    if SOURCE_ROOT: shutil.copyfile(source, target)
    else: subprocess.run(['docker', 'cp', container + ':' + source, str(target)], check=True, capture_output=True)
try:
    with tempfile.TemporaryDirectory() as tmp:
        play = Path(SOURCE_ROOT) / 'play' if SOURCE_ROOT else Path('/var/www/html/play')
        paths = [str(p) for p in play.rglob('index.html')] if SOURCE_ROOT else subprocess.check_output([
            'docker', 'run', '--rm', '--entrypoint', 'find', IMAGE, str(play), '-name', 'index.html'], text=True).splitlines()
        for source in paths:
            relative = Path(source).relative_to(play)
            if PSX_ONLY and str(relative) != 'app/psx/index.html':
                continue
            # Only the library and direct emulator entry points, never OAuth callbacks.
            if str(relative) != 'index.html' and not (len(relative.parts) == 3 and relative.parts[0] == 'app'):
                continue
            copy_source(source, tmp + '/index.html')
            original = Path(tmp, 'index.html').read_text()
            assert original.count('</head>') == 1, source
            mains = re.findall(r'<script[^>]+src="([^"]*/main\.[^"]+\.js)"', original)
            assert len(mains) == 1, source
            bundle_path = str(play.parent / mains[0].lstrip('/')) if mains[0].startswith('/') else str(Path(source).parent / mains[0])
            copy_source(bundle_path, tmp + '/main.js')
            bundle = Path(tmp, 'main.js').read_text()
            overlay(relative, source, original, bundle, mains, tmp)
        if not PSX_ONLY:
            prepare_local_apps(tmp)
        assert (ROOT / ('app/psx/index.html' if PSX_ONLY else 'app/nes/index.html')).is_file()
finally:
    if container: subprocess.run(['docker', 'rm', container], check=True, capture_output=True)
print('Prepared controller and Nextcloud overlays')
