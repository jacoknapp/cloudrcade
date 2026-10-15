#!/usr/bin/env python3
"""Build pinned Play!, native menus and source. WORK is owned disposable scratch.

Requires Git, Docker, Node22+, npm and Python3.10+. OUT must not exist. Uses no
ROMs, BIOS, credentials or operator configuration. PS2_BUILD_JOBS defaults to4.
"""
import hashlib
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
LOCK = json.loads((HERE / 'core.json').read_text())

def run(*args, cwd=None, env=None):
    subprocess.run(args, cwd=cwd, env=env, check=True)

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def native_key():
    files = [HERE / name for name in ['core.json', 'patch-native.py', 'build-linux.sh', 'Dockerfile.build']]
    files += sorted((HERE / 'native').glob('*'))
    return hashlib.sha256(''.join(sha(path) for path in files).encode()).hexdigest()

def prepare(work, out):
    work, out = work.resolve(), out.resolve()
    if out.exists():
        raise ValueError('OUT already exists; select a new output directory')
    marker = work / '.cloudrcade-ps2-build'
    if not marker.exists():
        work.mkdir(parents=True, exist_ok=True)
        if any(work.iterdir()):
            raise ValueError('WORK must be empty or previously owned by this builder')
        marker.write_text('Disposable Play! build scratch\n')
    source = work / 'Play'
    if not (source / '.git').exists():
        run('git', 'clone', '--no-checkout', '--depth', '1', '--no-tags', LOCK['repository'], str(source))
    remote = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], cwd=source, text=True).strip()
    if remote != LOCK['repository']:
        raise ValueError('Unexpected PS2 upstream remote')
    run('git', 'fetch', '--depth', '1', '--no-tags', 'origin', LOCK['commit'], cwd=source)
    # Only this builder's marked disposable tree is reset, never a source repo.
    run('git', 'reset', '--hard', LOCK['commit'], cwd=source)
    run('git', 'submodule', 'update', '--init', '--recursive', '--depth', '1', cwd=source)
    run('git', 'submodule', 'foreach', '--recursive', 'git diff --quiet && git diff --cached --quiet', cwd=source)
    run('python3', str(HERE / 'patch-native.py'), str(source))
    artifacts = source / 'build_cmake/build/wasm-ninja/Source/ui_js/Release'
    receipt = work / 'native-receipt.json'
    names = ['Play.js', 'Play.wasm']
    try:
        cached = json.loads(receipt.read_text())
        reusable = cached['key'] == native_key() and all(sha(artifacts / name) == cached['artifacts'][name] for name in names)
    except (OSError, ValueError, KeyError):
        reusable = False
    if not reusable or os.environ.get('FORCE_CORE_REBUILD') == 'true':
        sdk_image='cloudrcade-ps2-sdk:'+native_key()[:12]
        run('docker', 'build', '-t', sdk_image, '-f', str(HERE / 'Dockerfile.build'), str(HERE))
        run('docker', 'run', '--rm', '--platform', 'linux/amd64', '-e', 'PS2_BUILD_JOBS=' + os.environ.get('PS2_BUILD_JOBS', '4'),
            '-v', str(source) + ':/src', '-v', str(HERE / 'build-linux.sh') + ':/build.sh:ro',
            sdk_image, 'bash', '/build.sh')
        receipt.write_text(json.dumps({'key': native_key(), 'artifacts': {name: sha(artifacts / name) for name in names}}))
    native_lock=json.loads((HERE / 'native-build.json').read_text())
    actual={'nativeInputSha256':native_key(),'artifacts':{name:sha(artifacts/name) for name in names}}
    if actual != native_lock:
        raise ValueError('PS2 native build differs from the reviewed lock: '+json.dumps(actual,sort_keys=True))
    common = work / 'common'
    if not (common / '.git').exists():
        run('git', 'clone', '--no-checkout', 'https://github.com/webrcade/webrcade-app-common.git', str(common))
    if subprocess.check_output(['git','remote','get-url','origin'],cwd=common,text=True).strip() != 'https://github.com/webrcade/webrcade-app-common.git':
        raise ValueError('Unexpected PS2 save SDK remote')
    run('git', 'fetch', '--depth', '1', 'origin', LOCK['saveSdkCommit'], cwd=common)
    run('git', 'reset', '--hard', LOCK['saveSdkCommit'], cwd=common)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ps2-', dir=out.parent) as temporary:
        stage = Path(temporary)
        app = stage / 'app'
        shutil.copytree(HERE / 'app', app)
        (app / 'core').mkdir()
        for name in names:
            shutil.copy2(artifacts / name, app / 'core' / name)
        shutil.copy2(source / 'License.txt', app / 'LICENSE.play')
        shutil.copy2(HERE / 'LICENSE', app / 'LICENSE.host')
        sdk = stage / 'sdk'
        shutil.copytree(HERE.parent / 'retro-dolphin/sdk', sdk, ignore=shutil.ignore_patterns('node_modules'))
        pause = sdk / 'pause.jsx'
        pause.write_text(pause.read_text().replace('GameCube performance', 'PlayStation 2 performance').replace('gamecube-', 'ps2-').replace('./gamecube.svg', './ps2.svg'))
        run('npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', cwd=sdk)
        run('node', str(sdk / 'build.mjs'), str(common), str(app / 'save-sdk.mjs'))
        licenses = app / 'sdk-licenses'
        licenses.mkdir()
        for package in (sdk / 'node_modules').iterdir():
            if not package.is_dir() or package.name.startswith(('.', '@')):
                continue
            for license in package.iterdir():
                if license.is_file() and license.name.lower().startswith(('license', 'copying')):
                    shutil.copy2(license, licenses / (package.name + '-' + license.name))
        html = (app / 'index.html').read_text()
        for name in ['brand.js', 'controller.js', 'viewport.css', 'controller.css', 'menus.css']:
            revision = sha(HERE.parent / 'touch/assets' / name)[:16]
            html = html.replace('/touch-controls/' + name + '"', '/touch-controls/' + name + '?v=' + revision + '"')
        (app / 'index.html').write_text(html)
        sources = stage / 'sources'
        sources.mkdir()
        # Exact patched source/submodules and host/save SDK recipe, without Git,
        # dependencies installed by npm, compiler objects or any operator files.
        def source_filter(info):
            parts = Path(info.name).parts
            return None if any(part in {'.git', 'node_modules', '__pycache__', 'build_cmake'} for part in parts) else info
        archive = sources / 'ps2-source.tar.gz'
        with tarfile.open(archive, 'w:gz') as tar:
            tar.add(source, arcname='ps2/Play', filter=source_filter)
            tar.add(HERE, arcname='ps2/adapter', filter=source_filter)
            tar.add(HERE.parent / 'retro-dolphin/sdk', arcname='ps2/save-sdk', filter=source_filter)
            tar.add(common / 'src', arcname='ps2/common/src', filter=source_filter)
            tar.add(common / 'LICENSE', arcname='ps2/common/LICENSE')
        (app / 'core-info.json').write_text(json.dumps({**LOCK, 'experimental': True, 'binaryOrigin': 'cloudrcade-linux-source-build',
            'nativeInputSha256': native_key(), 'artifacts': {name: sha(artifacts / name) for name in names},
            'nativeBuild': native_lock,
            'sourceSha256': sha(archive), 'streamChunkBytes': 2 * 1024 * 1024, 'streamCacheBytes': 16 * 1024 * 1024}, indent=2) + '\n')
        shutil.rmtree(sdk)
        stage.rename(out)
    print('Prepared PS2 core: ' + str(out))

if __name__ == '__main__':
    work=Path(os.environ.get('WORK', '/tmp/cloudrcade-ps2-release')).resolve()
    work.parent.mkdir(parents=True, exist_ok=True)
    with work.with_name(work.name+'.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('PS2 WORK already has a running builder')
        prepare(work, Path(os.environ.get('OUT', ROOT / 'release/ps2')))
