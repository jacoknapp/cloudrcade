#!/usr/bin/env python3
"""Prepare Wii with a separately verified native cache and disposable scratch.

Called by core-cache.py after GameCube is prepared. The native builder still
checks the patched source tree, recipe and exact artifact hashes on every miss.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
recipe = ROOT / 'deploy/webrcade/retro-wii'
native = ROOT / 'release/wii-native-build'
with tempfile.TemporaryDirectory(prefix='cloudrcade-wii-') as scratch:
    work = Path(scratch) / 'source'
    env = dict(os.environ, WII_WORK=str(work), OUT=str(native))
    try:
        subprocess.run(['python3', str(recipe / 'build-native.py')], cwd=ROOT, env=env, check=True)
    except subprocess.CalledProcessError:
        for name in ('CMakeCache.txt', 'compile_commands.json', 'build.ninja'):
            path = work / 'build/linux-native' / name
            if path.is_file():
                native.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, native / name)
        raise
    env.update(WII_NATIVE=str(native), OUT=str(ROOT / 'release/wii'))
    subprocess.run(['python3', str(recipe / 'prepare.py')], cwd=ROOT, env=env, check=True)
shutil.rmtree(native)
