"""Build our downstream native core after the upstream source verifier passes.

The Windows upstream binary remains an independently verified input pin. Our
Linux artifacts, patch series and corresponding source have separate identities.
No ROMs, credentials or operator data are inputs. Docker needs network access.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def source_digest(source):
    digest = hashlib.sha256()
    for name in ('vendor/dolphin', 'core/upstream', 'tools/naga-spirv-wgsl', 'tools/jit-cache-prejs.js'):
        root = source / name
        paths = sorted(root.rglob('*')) if root.is_dir() else [root]
        for path in paths:
            if path.is_file() and not {'.git', 'target', '__pycache__'}.intersection(path.relative_to(source).parts):
                digest.update(path.relative_to(source).as_posix().encode() + b'\0')
                digest.update(bytes.fromhex(sha(path)))
    return digest.hexdigest()


def build(work, output):
    lock = json.loads((HERE / 'native-build.json').read_text())
    if set(lock['artifacts']) != {'dolphin-core-upstream.js', 'dolphin-core-upstream.wasm'}:
        raise RuntimeError('Native build must have two qualified artifact hashes')
    if sha(HERE / 'build-linux.sh') != lock['recipeSha256']:
        raise RuntimeError('Native build recipe does not match its lock')
    output.mkdir()
    source = output / 'source'
    source.mkdir()
    # The build recipe supplies revision metadata, independent of Git checkout.
    # Copy the verified source tree; exclude Git metadata from distribution.
    for name in ('vendor/dolphin', 'core/upstream', 'patches/dolphin-wasm', 'provenance', 'tools'):
        shutil.copytree(work / name, source / name,
                        ignore=shutil.ignore_patterns('target', 'node_modules', '__pycache__'))
    for name in ('LICENSE', 'package.json'):
        shutil.copy2(work / name, source / name)
    patches = sorted((HERE / 'native-patches').glob('*.patch'))
    if {path.name: sha(path) for path in patches} != lock['patches']:
        raise RuntimeError('Native patch set does not match its lock')
    for path in patches:
        subprocess.run(['git', 'apply', '--check', str(path)], cwd=source / 'vendor/dolphin', check=True)
        subprocess.run(['git', 'apply', str(path)], cwd=source / 'vendor/dolphin', check=True)
    if source_digest(source) != lock['sourceTreeSha256']:
        raise RuntimeError('Native source tree does not match its lock')
    # Optional byte-verified reuse of a previously qualified Linux build. CI
    # leaves this unset and independently rebuilds from source.
    cached = os.environ.get('GAMECUBE_NATIVE_CACHE')
    if cached:
        artifacts = Path(cached).resolve()
    else:
        toolchain = output / 'toolchain'
        toolchain.mkdir()
        subprocess.run(['docker', 'run', '--rm', '--platform', lock['platform'],
                        '-e', 'GAMECUBE_BUILD_JOBS=' + os.environ.get('GAMECUBE_BUILD_JOBS', '8'),
                        '-e', f'GAMECUBE_BUILD_UID={os.getuid()}',
                        '-e', f'GAMECUBE_BUILD_GID={os.getgid()}',
                        '-v', f'{source}:/work', '-v', f'{toolchain}:/toolchain',
                        '-v', f'{HERE}:/recipe:ro', lock['image'],
                        'bash', '/recipe/build-linux.sh'], check=True)
        artifacts = source / 'build/linux-artifacts'
        if source_digest(source) != lock['sourceTreeSha256']:
            raise RuntimeError('Build changed its native source inputs')
    # Snapshot before verification. A caller-provided cache can be rebuilt
    # concurrently; packaging must use exactly the bytes that passed the lock.
    inputs = artifacts
    artifacts = output / 'qualified-artifacts'
    artifacts.mkdir()
    for name in lock['artifacts']:
        shutil.copy2(inputs / name, artifacts / name)
    actual = {name: sha(artifacts / name) for name in lock['artifacts']}
    if actual != lock['artifacts']:
        raise RuntimeError(f'Linux artifact mismatch: {actual}')
    downstream = source / 'cloudrcade-native'
    shutil.copytree(HERE / 'native-patches', downstream / 'native-patches')
    for name in ('build-linux.sh', 'native-build.py', 'native-build.json', 'core.json'):
        shutil.copy2(HERE / name, downstream / name)
    (source / 'README.md').write_text('''# CloudRcade GameCube corresponding source

The native artifact is built from the pinned wasm-dolphin source plus the
CloudRcade patches in cloudrcade-native/native-patches. vendor/dolphin already
contains both patch series. provenance describes the verified upstream base;
cloudrcade-native/native-build.json identifies the downstream build and artifacts.
The original Windows binary hashes in core.json describe the base only.

To rebuild, mount this source at /work, an empty writable toolchain directory at
/toolchain, and cloudrcade-native at /recipe in the exact SDK container from
native-build.json. Run bash /recipe/build-linux.sh. This requires network access
for the pinned Rust toolchain and locked Cargo dependencies. Output is
build/linux-artifacts/dolphin-core-upstream.{js,wasm}. Use a fresh build directory.
The source archive omits Git metadata. The build recipe supplies Dolphin's pinned
revision metadata explicitly, so recipients do not need a repository checkout.
The adapter host and save SDK source are shipped separately as adapter-source.
''')
    archive = output / 'gamecube-source.tar.gz'
    subprocess.run(['tar', '--sort=name', '--mtime=@' + str(lock['sourceDateEpoch']),
                    '--owner=0', '--group=0', '--numeric-owner', '--exclude=.git',
                    '--exclude=target', '-czf', str(archive), '-C', str(source),
                    'LICENSE', 'README.md', 'package.json', 'vendor/dolphin',
                    'core/upstream', 'patches/dolphin-wasm', 'provenance', 'tools',
                    'cloudrcade-native'], check=True)
    return artifacts, archive, lock
