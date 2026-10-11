#!/usr/bin/env python3
"""Prepare an isolated GameCube prototype from pinned upstream artifacts.

Requires Git, Node >=22, Python >=3.10, tar and network access. WORK is a
dedicated upstream checkout; OUT is generated release/gamecube. No ROMs,
BIOS, accounts or production configuration are read. Run serve.py afterward.
This packages the upstream binary and verified corresponding source; it does
not claim a local native rebuild (the upstream toolchain is Windows-specific).
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
        shutil.copytree(HERE / 'app', stage / 'app')
        shutil.copytree(work / 'src', stage / 'app/vendor/src')
        shutil.copy2(HERE.parent / 'retro-azahar/app/src/emulator/lazyrom.js', stage / 'app/lazyrom.mjs')
        spec = spec_from_file_location('gamecube_runtime_patch', HERE / 'patch-runtime.py')
        patch = module_from_spec(spec)
        spec.loader.exec_module(patch)
        patch.patch_runtime(stage / 'app')
        cores = stage / 'app/cores/dolphin'
        cores.mkdir(parents=True)
        for name in LOCK['artifacts']:
            shutil.copy2(work / 'cores/dolphin' / name, cores / name)
        shutil.copy2(work / 'LICENSE', stage / 'app/LICENSE.dolphin')
        shutil.copy2(archives[0], stage / 'app/gamecube-source.tar.gz')
        shutil.copytree(HERE, stage / 'adapter-source', ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copy2(HERE.parent / 'retro-azahar/app/src/emulator/lazyrom.js', stage / 'adapter-source/app/lazyrom.mjs')
        (stage / 'app/core-info.json').write_text(json.dumps({
            **LOCK, 'experimental': True, 'binaryOrigin': 'pinned-upstream',
            'locallySourceBuilt': False,
            'videoBackend': 'WebGPU-Real', 'streamThresholdBytes': 50_000_000,
            'rangeReaderSha256': hashlib.sha256((stage / 'app/lazyrom.mjs').read_bytes()).hexdigest(),
            'adapterFilesSha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                                   for path in sorted((stage / 'app').glob('*.mjs'))},
            'hostPatchSha256': hashlib.sha256((HERE / 'patch-runtime.py').read_bytes()).hexdigest(),
            'sourceSha256': hashlib.sha256(archives[0].read_bytes()).hexdigest(),
        }, indent=2) + '\n')
        # Rename only after all sources and runtime files have been staged.
        stage.rename(out)
    print(f'Prepared experimental GameCube prototype: {out / "app"}')


if __name__ == '__main__':
    prepare(Path(os.environ.get('WORK', '/tmp/cloudrcade-gamecube-upstream')),
            Path(os.environ.get('OUT', HERE.parents[2] / 'release/gamecube')))
