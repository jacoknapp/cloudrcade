#!/usr/bin/env python3
"""Prepare an isolated GameCube prototype from pinned upstream artifacts.

Requires Git, Node >=22, Python >=3.10, tar and network access. WORK is a
dedicated upstream checkout; OUT is generated release/gamecube. No ROMs,
BIOS, accounts or production configuration are read. Run serve.py afterward.
This verifies the original upstream artifacts and source, then builds the
downstream native patches with the separately pinned Linux toolchain.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from importlib.util import module_from_spec, spec_from_file_location

HERE = Path(__file__).resolve().parent
LOCK = json.loads((HERE / 'core.json').read_text())
COMMON_COMMIT = '9a7cf19b64a440df8ca9b22a4136b34dc6e9f3db'


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)


def prepare(work, out):
    work, out = work.resolve(), out.resolve()
    if out.exists():
        raise SystemExit('OUT already exists; use a new output directory')
    if not (work / '.git').is_dir():
        work.mkdir(parents=True, exist_ok=True)
        if any(work.iterdir()):
            raise SystemExit('WORK must be empty or the dedicated upstream checkout')
        run('git', 'init', '-q', str(work))
        run('git', 'remote', 'add', 'origin', LOCK['repository'], cwd=work)
    origin = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], cwd=work, text=True).strip()
    if origin != LOCK['repository']:
        raise SystemExit('WORK has an unexpected upstream remote')
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=work, text=True)
    if dirty:
        raise SystemExit('WORK has tracked edits; use a clean dedicated checkout')
    run('git', 'fetch', '-q', '--depth', '1', 'origin', LOCK['commit'], cwd=work)
    run('git', 'checkout', '-q', '--detach', LOCK['commit'], cwd=work)
    for name, expected in LOCK['artifacts'].items():
        actual = hashlib.sha256((work / 'cores/dolphin' / name).read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit(f'Pinned artifact hash mismatch: {name}')
    source_lock = json.loads((work / 'provenance/dolphin-source.lock.json').read_text())
    if source_lock['upstream']['commit'] != LOCK['dolphinCommit']:
        raise SystemExit('Unexpected Dolphin source pin')
    # The upstream verifier checks every patch and the resulting source tree.
    run('node', 'tools/fetch-dolphin.mjs', cwd=work)
    run('node', 'tools/patch-upstream-wasm.mjs', cwd=work)
    run('node', 'tools/verify-dolphin-provenance.mjs', cwd=work)
    run('node', 'tools/build-corresponding-source.mjs', cwd=work)
    archives = list((work / 'dist').glob('wasm-dolphin-corresponding-source-*.tar.gz'))
    if len(archives) != 1:
        raise SystemExit('Expected exactly one verified corresponding source archive')
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='gamecube-', dir=out.parent) as tmp:
        stage = Path(tmp)
        spec = spec_from_file_location('gamecube_native_build', HERE / 'native-build.py')
        native = module_from_spec(spec)
        spec.loader.exec_module(native)
        artifacts, source_archive, native_lock = native.build(work, stage / 'native-build')
        shutil.copytree(HERE / 'app', stage / 'app')
        index = stage / 'app/index.html'
        html = index.read_text()
        for name in ['brand.js','controller.js','viewport.css','controller.css','menus.css']:
            revision = hashlib.sha256((HERE.parent / 'touch/assets' / name).read_bytes()).hexdigest()[:16]
            html = html.replace('/touch-controls/' + name + '"', '/touch-controls/' + name + '?v=' + revision + '"')
        index.write_text(html)
        shutil.copytree(work / 'src', stage / 'app/vendor/src')
        fonts = stage / 'app/sys/GC'
        fonts.mkdir(parents=True)
        for name in ['font_western.bin','font_japanese.bin','font-licenses.txt']:
            shutil.copy2(work / 'vendor/dolphin/Data/Sys/GC' / name, fonts / name)
        shutil.copy2(HERE.parent / 'retro-azahar/app/src/emulator/lazyrom.js', stage / 'app/lazyrom.mjs')
        common = work.parent / 'cloudrcade-gamecube-common'
        if not (common / '.git').is_dir():
            run('git', 'clone', '--depth', '1', 'https://github.com/webrcade/webrcade-app-common.git', str(common))
        if subprocess.check_output(['git','remote','get-url','origin'],cwd=common,text=True).strip() != 'https://github.com/webrcade/webrcade-app-common.git':
            raise SystemExit('Unexpected GameCube common SDK remote')
        if subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=common,text=True):
            raise SystemExit('GameCube common SDK checkout has tracked edits')
        run('git','fetch','--depth','1','origin',COMMON_COMMIT,cwd=common)
        run('git','checkout','--detach',COMMON_COMMIT,cwd=common)
        sdk = stage / 'sdk-build'
        shutil.copytree(HERE / 'sdk', sdk, ignore=shutil.ignore_patterns('node_modules'))
        run('npm','ci','--ignore-scripts','--no-audit','--no-fund',cwd=sdk)
        run('node',str(sdk / 'build.mjs'),str(common),str(stage / 'app/save-sdk.mjs'))
        licenses = stage / 'app/sdk-licenses'
        licenses.mkdir()
        for package in (sdk / 'node_modules').iterdir():
            if not package.is_dir() or package.name.startswith('.') or package.name.startswith('@'): continue
            for license in package.iterdir():
                if license.is_file() and license.name.lower().startswith(('license','copying')):
                    shutil.copy2(license, licenses / (package.name + '-' + license.name))
        spec = spec_from_file_location('gamecube_runtime_patch', HERE / 'patch-runtime.py')
        patch = module_from_spec(spec)
        spec.loader.exec_module(patch)
        patch.patch_runtime(stage / 'app', native_lock['artifacts']['dolphin-core-upstream.wasm'])
        cores = stage / 'app/cores/dolphin'
        cores.mkdir(parents=True)
        for name in native_lock['artifacts']:
            shutil.copy2(artifacts / name, cores / name)
        shutil.copy2(work / 'LICENSE', stage / 'app/LICENSE.dolphin')
        shutil.copy2(source_archive, stage / 'app/gamecube-source.tar.gz')
        shutil.copytree(HERE, stage / 'adapter-source', ignore=shutil.ignore_patterns('__pycache__','node_modules'))
        shutil.copytree(common / 'src', stage / 'adapter-source/sdk/common/src')
        shutil.copy2(common / 'LICENSE', stage / 'adapter-source/sdk/common/LICENSE')
        shutil.copy2(HERE.parent / 'retro-azahar/app/src/emulator/lazyrom.js', stage / 'adapter-source/app/lazyrom.mjs')
        shutil.copytree(stage / 'adapter-source', stage / 'app/adapter-source')
        (stage / 'app/core-info.json').write_text(json.dumps({
            **LOCK, 'experimental': True, 'binaryOrigin': 'cloudrcade-linux-source-build',
            'locallySourceBuilt': True, 'upstreamArtifacts': LOCK['artifacts'],
            'artifacts': native_lock['artifacts'], 'nativeBuild': native_lock,
            'saveSdkCommit': COMMON_COMMIT,
            'videoBackend': 'WebGPU-Real', 'streamThresholdBytes': 50_000_000,
            'rangeReaderSha256': hashlib.sha256((stage / 'app/lazyrom.mjs').read_bytes()).hexdigest(),
            'adapterFilesSha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                                   for path in sorted((stage / 'app').glob('*.mjs'))},
            'hostPatchSha256': hashlib.sha256((HERE / 'patch-runtime.py').read_bytes()).hexdigest(),
            'sourceSha256': native.sha(source_archive),
        }, indent=2) + '\n')
        # Distribute sources and artifacts, not the compiler/cache/build objects.
        shutil.rmtree(stage / 'native-build')
        # Rename only after all sources and runtime files have been staged.
        stage.rename(out)
    print(f'Prepared experimental GameCube prototype: {out / "app"}')


if __name__ == '__main__':
    prepare(Path(os.environ.get('WORK', '/tmp/cloudrcade-gamecube-upstream')),
            Path(os.environ.get('OUT', HERE.parents[2] / 'release/gamecube')))
