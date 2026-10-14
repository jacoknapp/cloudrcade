#!/usr/bin/env python3
"""Bootstrap unchanged core inputs from the last qualified immutable release.

Useful when a release branch changes and its Actions caches are unavailable.
This is a verified release cache, never a fallback source/binary download:
changed build inputs or toolchains compile normally, and forced builds bypass it.
New packages still require all current source, image and publication checks.
"""
import importlib.util
import os
from pathlib import Path
import re
import shutil
import subprocess

spec = importlib.util.spec_from_file_location('core_cache', Path(__file__).with_name('core-cache.py'))
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)
SOURCE = 'd9300f06c7fe00ed930f67dac089c1269c64d121'
IMAGE = 'ghcr.io/jacoknapp/cloudrcade@sha256:e49452d23e2eb29d9155cfeb8c73d21d83a7b5ed8204e64553592c66bab161a1'


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, timeout=120)


def toolchain(text):
    # Scheduling, architecture/image tags and test labels don't compile cores.
    versions = tuple(re.findall(r'^\s*(?:-\s*)?(?:runs-on|node-version|uses):\s*(.+)$', text, re.M))
    # Include every declared environment block, including future compiler flags.
    environments = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.strip() != 'env:':
            continue
        indent = len(line) - len(line.lstrip())
        block = []
        for child in lines[i + 1:]:
            if child.strip() and len(child) - len(child.lstrip()) <= indent:
                break
            if child.strip():
                block.append(child.strip())
        environments.append(tuple(block))
    return versions, tuple(environments)


def unchanged(core, root, source=SOURCE):
    before = git(root, 'ls-tree', '-rz', '--name-only', source, '--', *cache.INPUTS[core]).split(b'\0')
    after = git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', *cache.INPUTS[core]).split(b'\0')
    names = sorted(set(n for n in before if n))
    if not names or names != sorted(set(n for n in after if n)):
        return False
    try:
        return all(git(root, 'show', source + ':' + n.decode()) == (root / n.decode()).read_bytes() for n in names)
    except FileNotFoundError:
        return False


def restore(root=cache.ROOT):
    if os.environ.get('FORCE_CORE_REBUILD') == 'true':
        print('Forced source build: qualified release cache bypassed', flush=True)
        return
    try:
        git(root, 'cat-file', '-e', SOURCE)
    except subprocess.CalledProcessError:
        subprocess.run(['git', 'fetch', '--depth', '1', 'origin', SOURCE], cwd=root, check=True, timeout=120)
    previous = git(root, 'show', SOURCE + ':.github/workflows/docker.yml').decode()
    if toolchain(previous) != toolchain((root / '.github/workflows/docker.yml').read_text()):
        print('Build toolchain changed: compile cores normally', flush=True)
        return
    old_helper = git(root, 'show', SOURCE + ':scripts/core-cache.py').decode()
    new_helper = (root / 'scripts/core-cache.py').read_text()
    # Adding the bootstrap file to cache identity changes keys, not the recipe.
    normalize = lambda text: re.sub(r'^SHARED = .*$', 'SHARED = <identity inputs>', text, flags=re.M)
    if normalize(old_helper) != normalize(new_helper):
        print('Core prepare/validation logic changed: compile cores normally', flush=True)
        return
    selected = []
    for core in ('3ds', 'psp'):
        output = root / 'release' / core
        if not cache.reusable(core, output, cache.identity(core, root), root) and unchanged(core, root):
            selected.append(core)
    native = root / 'release/gamecube-native'
    use_native = not cache.native_valid(native, root) and unchanged('gamecube-native', root)
    if not selected and not use_native:
        print('No unchanged cores need qualified release bootstrapping', flush=True)
        return
    subprocess.run(['docker', 'pull', '--platform', 'linux/amd64', IMAGE], check=True)
    container = subprocess.check_output(['docker', 'create', '--platform', 'linux/amd64', IMAGE], text=True).strip()
    try:
        for core in selected:
            output = root / 'release' / core
            if output.exists():
                shutil.rmtree(output)
            (output / 'app').mkdir(parents=True)
            (output / 'sources').mkdir()
            app = {'3ds': 'retro-azahar', 'psp': 'retro-ppsspp'}[core]
            subprocess.run(['docker', 'cp', container + ':/var/www/touch/apps/' + app + '/.', str(output / 'app')], check=True)
            subprocess.run(['docker', 'cp', container + ':/var/www/html/licenses/sources/' + core + '-source.tar.gz', str(output / 'sources')], check=True)
            cache.seal(core, output, cache.identity(core, root), root)
            print('Verified unchanged ' + core + ' inputs and immutable qualified runtime/source package', flush=True)
        if use_native:
            if native.exists():
                shutil.rmtree(native)
            native.mkdir(parents=True)
            subprocess.run(['docker', 'cp', container + ':/var/www/html/experimental/gamecube/cores/dolphin/.', str(native)], check=True)
            if not cache.native_valid(native, root):
                shutil.rmtree(native)
                raise ValueError('Qualified GameCube native artifacts do not match current lock')
            print('Verified unchanged GameCube native inputs and committed artifact hashes', flush=True)
    finally:
        subprocess.run(['docker', 'rm', container], check=True)


if __name__ == '__main__':
    restore()
