#!/usr/bin/env python3
"""Exact-input release caches. No partial keys; validate every byte before reuse."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE = 'deploy/webrcade/'
SHARED = ['scripts/core-cache.py', '.github/workflows/docker.yml']
READER = BASE + 'retro-azahar/app/src/emulator/lazyrom.js'
INPUTS = {
    '3ds': [BASE + 'retro-azahar', 'scripts/prepare-core.py',
            'scripts/package-core-source.py', 'core-release.json', 'LICENSES'],
    'psp': [BASE + 'retro-ppsspp', READER],
    'gamecube': [BASE + 'retro-dolphin', READER] + [
        BASE + 'touch/assets/' + name for name in
        ('brand.js', 'controller.js', 'viewport.css', 'controller.css', 'menus.css')],
    'gamecube-native': [BASE + 'retro-dolphin/' + name for name in
        ('core.json', 'native-build.json', 'native-build.py', 'build-linux.sh', 'native-patches')],
}
MANIFEST = '.core-cache.json'
COMMANDS = {
    '3ds': ['python3', 'scripts/prepare-core.py'],
    'psp': ['bash', BASE + 'retro-ppsspp/build.sh'],
    'gamecube': ['python3', BASE + 'retro-dolphin/prepare.py'],
}


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def identity(core, root=ROOT):
    # Git's input list excludes generated build directories and dependency caches.
    # Include new, nonignored files for local validation before a commit, too.
    paths = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others',
                                     '--exclude-standard', '--', *SHARED, *INPUTS[core]], cwd=root)
    names = sorted(set(p.decode() for p in paths.split(b'\0') if p))
    if not names:
        raise ValueError('No core inputs')
    records = {name: sha(root / name) for name in names}
    digest = hashlib.sha256(json.dumps(records, sort_keys=True).encode()).hexdigest()
    return 'core-v1-' + core + '-' + digest


def inventory(output):
    records = {}
    for path in sorted(output.rglob('*')):
        if path.is_symlink():
            raise ValueError('Symlinks are not permitted in cached packages')
        if path.is_file() and path != output / MANIFEST:
            records[path.relative_to(output).as_posix()] = sha(path)
    if not records:
        raise ValueError('Empty core package')
    return records


def native_valid(output, root=ROOT):
    lock = json.loads((root / BASE / 'retro-dolphin/native-build.json').read_text())
    return all((output / name).is_file() and not (output / name).is_symlink()
               and sha(output / name) == digest for name, digest in lock['artifacts'].items())


def validate(core, output, root=ROOT):
    required = ['app/index.html']
    if core == 'gamecube':
        required += ['app/gamecube-source.tar.gz', 'app/core-info.json',
                     'app/adapter-source/native-build.json']
        if not native_valid(output / 'app/cores/dolphin', root):
            raise ValueError('GameCube artifact lock mismatch')
        info = json.loads((output / 'app/core-info.json').read_text())
        lock = json.loads((root / BASE / 'retro-dolphin/native-build.json').read_text())
        if info['nativeBuild'] != lock or info['sourceSha256'] != sha(output / 'app/gamecube-source.tar.gz'):
            raise ValueError('GameCube source/lock mismatch')
    else:
        required += ['sources/' + core + '-source.tar.gz']
        wasm = list((output / 'app').rglob('*.wasm'))
        if not wasm:
            raise ValueError('Missing WASM core')
        for path in wasm:
            with path.open('rb') as stream:
                if stream.read(8) != b'\0asm\x01\0\0\0':
                    raise ValueError('Invalid WASM core')
    for name in required:
        if not (output / name).is_file() or not (output / name).stat().st_size:
            raise ValueError('Incomplete package: ' + name)


def reusable(core, output, key, root=ROOT):
    try:
        manifest = json.loads((output / MANIFEST).read_text())
        if manifest['key'] != key or manifest['files'] != inventory(output):
            return False
        validate(core, output, root)
        return True
    except (OSError, ValueError, KeyError, TypeError):
        return False


def seal(core, output, key, root=ROOT):
    records = inventory(output)
    validate(core, output, root)
    (output / MANIFEST).write_text(json.dumps({'key': key, 'files': records}, sort_keys=True) + '\n')


def prepare(core, root=ROOT):
    output = root / 'release' / core
    key = identity(core, root)
    force = os.environ.get('FORCE_CORE_REBUILD') == 'true'
    if not force and reusable(core, output, key, root):
        print(f'Reusing verified {core} package ({key})', flush=True)
        result = 'reused'
    else:
        print(f'Building {core}: cache missing, invalid, changed, or bypassed', flush=True)
        if output.exists():
            shutil.rmtree(output)
        env = dict(os.environ)
        # Do not allow ambient native reuse to bypass the explicit fresh-build mode.
        env.pop('GAMECUBE_NATIVE_CACHE', None)
        native = root / 'release/gamecube-native'
        if core == 'gamecube' and not force and native_valid(native, root):
            env['GAMECUBE_NATIVE_CACHE'] = str(native)
            print('Reusing GameCube native artifacts; rebuilding adapter/source package', flush=True)
        subprocess.run(COMMANDS[core], cwd=root, env=env, check=True)
        if identity(core, root) != key:
            raise ValueError('Inputs changed during build')
        if core == 'gamecube':
            # prepare.py retains SDK build scratch and a second adapter-source copy.
            # Only app/ is shipped; it already contains both source distributions.
            for name in ('sdk-build', 'adapter-source'):
                shutil.rmtree(output / name, ignore_errors=True)
        seal(core, output, key, root)
        result = 'built'
    if core == 'gamecube':
        native = root / 'release/gamecube-native'
        if native.exists():
            shutil.rmtree(native)
        shutil.copytree(output / 'app/cores/dolphin', native)
        if not native_valid(native, root):
            raise ValueError('Invalid native cache export')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as stream:
            stream.write(f'- **{core}**: {result}; exact inputs and package checks passed.\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['keys', 'prepare'])
    parser.add_argument('core', nargs='?', choices=COMMANDS)
    args = parser.parse_args()
    if args.command == 'keys':
        values = '\n'.join(f'{core}={identity(core)}' for core in INPUTS) + '\n'
        print(values, end='')
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
                stream.write(values)
    elif args.core:
        prepare(args.core)
    else:
        parser.error('prepare requires a core')


if __name__ == '__main__':
    main()
