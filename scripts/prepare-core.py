#!/usr/bin/env python3
"""Reuse a checksum-pinned key-free build, or rebuild changed 3DS inputs."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'deploy/webrcade/retro-azahar'
OUT = ROOT / 'release/3ds'
deploy = runpy.run_path(str(SOURCE / 'deploy.py'))
stamp, records = deploy['inputs'](SOURCE)
lock = json.loads((ROOT / 'core-release.json').read_text())
if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir(parents=True)
if stamp == lock['sourceHash'] and os.environ.get('FORCE_CORE_REBUILD') != 'true':
    package = ROOT / 'release/core-package.tar.gz'
    with urllib.request.urlopen(lock['url'], timeout=120) as response, package.open('wb') as target:
        shutil.copyfileobj(response, target)
    if hashlib.sha256(package.read_bytes()).hexdigest() != lock['sha256']:
        raise SystemExit('Core release checksum mismatch')
    with tarfile.open(package) as archive:
        archive.extractall(OUT, filter='data')
    package.unlink()
else:
    work = Path(os.environ.get('CLOUDRCADE_CORE_WORK', '/tmp/cloudrcade-core-build'))
    subprocess.run(['bash', str(SOURCE / 'build.sh')], check=True,
                   env={**os.environ, 'WORK': str(work), 'OUT': str(OUT / 'app')})
    subprocess.run(['python3', str(ROOT / 'scripts/package-core-source.py'),
                    str(work), str(OUT / 'sources/3ds-source.tar.gz')], check=True)
    shutil.copytree(ROOT / 'LICENSES', OUT / 'licenses', dirs_exist_ok=True)
if not (OUT / 'app/index.html').is_file() or not (OUT / 'sources/3ds-source.tar.gz').is_file():
    raise SystemExit('Incomplete core package')
# The release contains only app output, license texts and sanitized source.
for path in OUT.rglob('*'):
    if path.name in {'default_keys.h', 'aes_keys.txt', 'keys.txt', 'boot9.bin', 'keys.bin'}:
        raise SystemExit('Unexpected runtime key file in core package')
(OUT / 'manifest.json').write_text(json.dumps({'sourceHash': stamp, 'inputs': records}, indent=2) + '\n')
print(f'Prepared key-free 3DS app for source {stamp[:12]}')
