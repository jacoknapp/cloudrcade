#!/usr/bin/env python3
"""Pinned xxHash scalar/SIMD differential and page-hash screen (Docker/Node)."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/ps2-xxhash'
IMAGE = 'emscripten/emsdk@sha256:90b757eb11fa9a0e3ce4d2d9f76d932a56018e4accc37b5a28b2783751e60eb7'
PINS = {'xxhash.h': '17973c0dc49d9854ca26caa191f0e12f7a424b68858d9a78de3860d959d85e4b',
        'xxhash.c': '5c3591fe6e6c86a619eb26760e9520e37a6fd5152882ab5ad93f912e2a855966'}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--xxhash', required=True, type=Path, help='Pinned Play deps/Dependencies/xxHash directory')
parser.add_argument('--output', type=Path)
args = parser.parse_args()
out = (args.output or Path(tempfile.mkdtemp(prefix='ps2-xxhash-fixture-'))).resolve()
out.mkdir(parents=True, exist_ok=True)
for name, sha in PINS.items():
    source = args.xxhash / name
    assert hashlib.sha256(source.read_bytes()).hexdigest() == sha, 'Pinned xxHash changed: ' + name
    shutil.copyfile(source, out / name)
for name in ['hash-fixture.c', 'hash-fixture.cjs']:
    shutil.copyfile(FIXTURE / name, out / name)

def sdk(*command, capture=False):
    argv = ['docker', 'run', '--rm', '--network', 'none', '-v', str(out)+':/fixture', '-w', '/fixture', IMAGE, *command]
    if capture:
        return subprocess.check_output(argv, text=True)
    subprocess.run(argv, check=True)

backends = []
for name, flags, expected in [('scalar', [], 'XXH_SCALAR'), ('simd', ['-msimd128'], 'XXH_NEON')]:
    macros = sdk('emcc', '-O3', *flags, '-dM', '-E', 'xxhash.c', capture=True)
    assert '#define XXH_VECTOR '+expected+'\n' in macros, 'Wrong xxHash backend: ' + name
    backends.append(expected)
    sdk('emcc', '-O3', '-DNDEBUG', *flags, '-c', 'xxhash.c', '-o', name+'.o')
    # Match production: only xxhash.c has the additional SIMD flag, not final link.
    sdk('emcc', '-O3', '-DNDEBUG', '-I/fixture', 'hash-fixture.c', name+'.o',
        '-sMODULARIZE=1', '-sENVIRONMENT=node', '-sALLOW_MEMORY_GROWTH=1',
        '-sEXPORTED_FUNCTIONS=[_hash,_hash_pages,_malloc,_free]', '-sEXPORTED_RUNTIME_METHODS=HEAPU8',
        '-o', name+'.cjs')
(out / 'backends.json').write_text(json.dumps(backends)+'\n')
subprocess.run(['node', str(out / 'hash-fixture.cjs')], check=True)
sdk('/emsdk/upstream/bin/wasm-dis', 'simd.wasm', '-o', 'simd.wat')
wat = (out / 'simd.wat').read_text()
assert 'v128.load' in wat and 'i64x2.add' in wat and 'extmul' in wat, 'Missing xxHash SIMD codegen'
assert 'relaxed' not in wat, 'Unexpected relaxed SIMD'
print('PASS pinned xxHash differential, memory bounds and SIMD codegen; artifacts:', out)
