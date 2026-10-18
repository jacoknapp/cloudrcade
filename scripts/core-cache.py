#!/usr/bin/env python3
"""Exact-input release caches. No partial keys; validate every byte before reuse."""
import argparse
import ast
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE = 'deploy/webrcade/'
# Cache plumbing and release scheduling are not compiler inputs. Hash the
# effective build environment below, rather than every workflow/helper byte.
SHARED = ['.github/workflows/docker.yml']
READER = BASE + 'retro-azahar/app/src/emulator/lazyrom.js'
INPUTS = {
    '3ds': [BASE + 'retro-azahar', 'scripts/prepare-core.py',
            'scripts/package-core-source.py', 'core-release.json', 'LICENSES'],
    'psp': [BASE + 'retro-ppsspp', READER],
    'ps2': [BASE + 'retro-play', BASE + 'retro-dolphin/sdk'] + [
        BASE + 'touch/assets/' + name for name in
        ('brand.js', 'controller.js', 'viewport.css', 'controller.css', 'menus.css')],
    'gamecube': [BASE + 'retro-dolphin', READER] + [
        BASE + 'touch/assets/' + name for name in
        ('brand.js', 'controller.js', 'viewport.css', 'controller.css', 'menus.css')],
    'gamecube-native': [BASE + 'retro-dolphin/' + name for name in
        ('core.json', 'native-build.json', 'native-build.py', 'build-linux.sh', 'native-patches')],
    'ps2-native': [BASE + 'retro-play/' + name for name in
        ('core.json', 'native-build.json', 'patch-*.py', 'build-linux.sh', 'Dockerfile.build', 'native', 'gpu')],
}
# These two operator guides are neither read by their builders nor shipped in
# their corresponding-source archives. Other documentation (e.g. GC adapter
# source/SDK files) remains an input when its package actually contains it.
NONBUILD_DOCS = {BASE + name + '/README.md' for name in ('retro-azahar', 'retro-ppsspp')}
MANIFEST = '.core-cache.json'
COMMANDS = {
    '3ds': ['python3', 'scripts/prepare-core.py'],
    'psp': ['bash', BASE + 'retro-ppsspp/build.sh'],
    'ps2': ['python3', BASE + 'retro-play/prepare.py'],
    'gamecube': ['python3', BASE + 'retro-dolphin/prepare.py'],
}


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def workflow_inputs(text, core):
    """Select compiler setup/env and this core's invocation, not cache/tag steps.

    The release workflow has one build job and ordinary block-form steps.
    Build options belong in the tracked recipes or global/job/preparation env.
    """
    parent = core.removesuffix('-native')
    match = re.search(r'(?ms)^  build:\s*\n(.*?)(?=^  [\w-]+:|\Z)', text)
    job = match.group(1) if match else text
    prefix = job.split('    steps:', 1)[0]
    global_env = re.search(r'(?m)^env:\s*\n(?:[ \t]+[^\n]*\n)*', text)
    environment = []
    for block in (global_env.group(0) if global_env else '', prefix):
        lines = block.splitlines()
        for i, line in enumerate(lines):
            if line.strip() != 'env:':
                continue
            indent = len(line) - len(line.lstrip())
            for child in lines[i + 1:]:
                if child.strip() and len(child) - len(child.lstrip()) <= indent:
                    break
                if child.strip() and not child.lstrip().startswith(('#', 'FORCE_CORE_REBUILD:')):
                    environment.append(child.strip())
    steps = re.split(r'(?m)^      - ', job)[1:]
    node, invocation = [], []
    for step in steps:
        if 'uses: actions/setup-node@' in step and parent in ('gamecube', 'ps2') and not core.endswith('-native'):
            node.extend(re.findall(r'(?m)^\s*(node-version|node-version-file|architecture|check-latest):\s*(.+)$', step))
        if re.search(r'core-cache\.py prepare ' + re.escape(parent) + r'\b', step):
            invocation.append(re.sub(r'(?m)^\s*(?:name|id|if):[^\n]*\n?', '', step).strip())
    return {'runner': [] if core.endswith('-native') else re.findall(r'(?m)^\s*runs-on:\s*(.+)$', prefix),
            'node': node, 'environment': environment, 'invocation': invocation}


def read_at(root, name, revision=None):
    if revision:
        return subprocess.check_output(['git', 'show', revision + ':' + name], cwd=root, stderr=subprocess.DEVNULL)
    return (root / name).read_bytes()


def command_at(root, core, revision=None):
    parent = core.removesuffix('-native')
    if not revision:
        return COMMANDS[parent]
    # Read only literal command declarations; never execute historical code.
    def literal(node):
        if isinstance(node, ast.Constant): return node.value
        if isinstance(node, ast.Name) and node.id == 'BASE': return BASE
        if isinstance(node, ast.List): return [literal(item) for item in node.elts]
        if isinstance(node, ast.Dict): return {literal(k): literal(v) for k, v in zip(node.keys, node.values)}
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add): return literal(node.left) + literal(node.right)
        raise ValueError('Unrecognized historical compiler command')
    tree = ast.parse(read_at(root, 'scripts/core-cache.py', revision))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'COMMANDS' for t in node.targets):
            return literal(node.value)[parent]
    raise ValueError('Missing historical compiler command')


def input_records(core, root=ROOT, revision=None):
    # Git's input list excludes generated build directories and dependency caches.
    # Include new, nonignored files for local validation before a commit, too.
    command = (['git', 'ls-tree', '-rz', '--name-only', revision] if revision else
               ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    paths = subprocess.check_output([*command, '--', *INPUTS[core]], cwd=root)
    names = sorted(set(p.decode() for p in paths.split(b'\0') if p and p.decode() not in NONBUILD_DOCS))
    if not names:
        raise ValueError('No core inputs')
    records = {name: hashlib.sha256(read_at(root, name, revision)).hexdigest() for name in names}
    workflow = read_at(root, '.github/workflows/docker.yml', revision).decode()
    records['@build-environment'] = workflow_inputs(workflow, core)
    for name, value in records['@build-environment']['node']:
        if name == 'node-version-file':
            filename = value.strip('\'"')
            if '$' in filename or Path(filename).is_absolute() or '..' in Path(filename).parts:
                raise ValueError('Node version file must be a repository path')
            records['@node-version-file:' + filename] = hashlib.sha256(read_at(root, filename, revision)).hexdigest()
    records['@command'] = command_at(root, core, revision)
    return records


def identity(core, root=ROOT):
    records = input_records(core, root)
    digest = hashlib.sha256(json.dumps(records, sort_keys=True).encode()).hexdigest()
    return 'core-v2-' + core + '-' + digest


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


def ps2_native_key(root=ROOT):
    here = root / BASE / 'retro-play'
    files = [here / name for name in ('core.json', 'build-linux.sh', 'Dockerfile.build')]
    files += sorted(here.glob('patch-*.py'))
    files += sorted((here / 'native').glob('*'))
    files += sorted(p for p in (here / 'gpu').rglob('*') if p.is_file() and '__pycache__' not in p.parts)
    return hashlib.sha256(''.join(sha(p) for p in files).encode()).hexdigest()


def native_valid(output, root=ROOT, core='gamecube'):
    folder = 'retro-play' if core == 'ps2' else 'retro-dolphin'
    lock = json.loads((root / BASE / folder / 'native-build.json').read_text())
    if core == 'ps2' and ps2_native_key(root) != lock['nativeInputSha256']:
        return False
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
    elif core == 'ps2':
        required += ['sources/ps2-source.tar.gz', 'app/core-info.json']
        info = json.loads((output / 'app/core-info.json').read_text())
        lock = json.loads((root / BASE / 'retro-play/native-build.json').read_text())
        if not native_valid(output / 'app/core', root, 'ps2') or info['nativeBuild'] != lock or info['sourceSha256'] != sha(output / 'sources/ps2-source.tar.gz'):
            raise ValueError('PS2 native artifact/source lock mismatch')
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
        env.pop('PS2_NATIVE_CACHE', None)
        native = root / 'release/gamecube-native'
        if core == 'gamecube' and not force and native_valid(native, root):
            env['GAMECUBE_NATIVE_CACHE'] = str(native)
            print('Reusing GameCube native artifacts; rebuilding adapter/source package', flush=True)
        if core == 'ps2' and not force and native_valid(root / 'release/ps2-native', root, 'ps2'):
            env['PS2_NATIVE_CACHE'] = str(root / 'release/ps2-native')
            print('Reusing PS2 native artifacts; rebuilding adapter/source package', flush=True)
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
    if core in ('gamecube', 'ps2'):
        native = root / 'release' / (core + '-native')
        if native.exists():
            shutil.rmtree(native)
        shutil.copytree(output / ('app/core' if core == 'ps2' else 'app/cores/dolphin'), native)
        if not native_valid(native, root, core):
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
