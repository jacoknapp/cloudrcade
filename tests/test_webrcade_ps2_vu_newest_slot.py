#!/usr/bin/env python3
"""Actual VUShared/CMipsJitter/Wasm differential for the newest-slot reader.

Uses retained pinned CodeGen/Framework libraries read-only. Compiles only the
small generator plus actual VUShared/MipsJitter/FpUtils, never a full PS2 core.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'emscripten/emsdk@sha256:90b757eb11fa9a0e3ce4d2d9f76d932a56018e4accc37b5a28b2783751e60eb7'
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--play', required=True, type=Path)
p.add_argument('--libraries-play', type=Path, help='Retained build with matching CodeGen/Framework sources')
p.add_argument('--output', type=Path)
a = p.parse_args()
play = a.play.resolve()
libraries = (a.libraries_play or play).resolve()
out = (a.output or Path(tempfile.mkdtemp(prefix='ps2-vu-newest-slot-'))).resolve()
out.mkdir(parents=True, exist_ok=True)
if any(out.iterdir()):
    raise ValueError('Use an empty output directory')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

pins = {
    'Source/ee/VUShared.cpp': 'c27335f4258e2863a5631d53275bc8de2d66b9d70c4ec073e17e8bb94643b868',
    'deps/CodeGen/src/Jitter_CodeGen_Wasm.cpp': '94b3926c7e852569c31d0c6f7c6db08aceedfcad938356a4f08eda9079aba65a',
    'deps/CodeGen/src/Jitter_CodeGen_Wasm_Md.cpp': '2b95f7cea0ba4537c92424e1f495f9bbd35d1a18049dc188e12130592e4071f1',
}
for name, expected in pins.items():
    assert sha(play / name) == expected, 'Baseline input changed: ' + name
# Reuse only archives whose retained source trees match the actual source under
# test. Hash all C++/header inputs in both dependencies, not just named emitters.
for dependency in ['CodeGen', 'Framework']:
    source = play / 'deps' / dependency
    other = libraries / 'deps' / dependency
    files = [x for part in ['src', 'include'] for x in (source / part).rglob('*')
             if x.is_file() and x.suffix in ['.cpp', '.c', '.h', '.hpp', '.inc']]
    for file in files:
        assert sha(file) == sha(other / file.relative_to(source)), 'Retained dependency differs: ' + str(file)

for variant in ['baseline', 'candidate']:
    target = out / variant / 'Source/ee'
    target.mkdir(parents=True)
    shutil.copyfile(play / 'Source/ee/VUShared.cpp', target / 'VUShared.cpp')
spec = importlib.util.spec_from_file_location('newest_slot', ROOT / 'deploy/webrcade/retro-play/patch-vu-newest-slot.py')
patcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patcher)
patcher.patch(out / 'candidate')
try:
    patcher.patch(out / 'candidate')
except ValueError:
    pass
else:
    raise AssertionError('Repeated patch must fail closed')
for name in ['generate.cpp', 'execute.cjs']:
    shutil.copyfile(ROOT / 'tests/fixtures/ps2-vu-newest-slot' / name, out / name)

def sdk(*args):
    subprocess.run(['docker', 'run', '--rm', '--network', 'none',
                    '-v', str(play) + ':/src:ro', '-v', str(libraries) + ':/retained:ro',
                    '-v', str(out) + ':/fixture', '-w', '/fixture', IMAGE, *args], check=True)

flags = ['-O3', '-DNDEBUG', '-std=c++17', '-pthread', '-fexceptions',
         '-I/src/Source', '-I/src/Source/ee', '-I/src/deps/CodeGen/include', '-I/src/deps/Framework/include']
for source, obj in [('MipsJitter.cpp', 'mips-jitter.o'), ('FpUtils.cpp', 'fp-utils.o')]:
    sdk('em++', *flags, '-c', '/src/Source/' + source, '-o', obj)
build = 'build_cmake/build/wasm-ninja/Source/ui_js/Source'
archives = [build + '/CodeGen/Release/libCodeGen.a', build + '/Framework/Release/libFramework.a']
for variant in ['baseline', 'candidate']:
    sdk('em++', *flags, 'generate.cpp', variant + '/Source/ee/VUShared.cpp', 'mips-jitter.o', 'fp-utils.o',
        *['/retained/' + x for x in archives], '-sENVIRONMENT=node', '-sMODULARIZE=1', '-sALLOW_MEMORY_GROWTH=1',
        '-sEXPORTED_FUNCTIONS=[_generate,_generatedSize,_layout]', '-sEXPORTED_RUNTIME_METHODS=HEAPU8', '-o', variant + '.cjs')
subprocess.run(['node', str(out / 'execute.cjs')], check=True)
for variant in ['baseline', 'candidate']:
    sdk('/emsdk/upstream/bin/wasm-dis', variant + '-direct.wasm', '-o', variant + '-direct.wat')
    text = (out / (variant + '-direct.wat')).read_text()
    assert '(i64.' not in text, 'Flag timestamps must retain 32-bit semantics'
    assert 'i32.le_u' not in text and 'i32.gt_u' not in text, 'Unsigned comparison introduced'
    assert '(i32.le_s' in text, 'Original signed timestamp compare missing'
old = (out / 'baseline-direct.wat').read_text()
new = (out / 'candidate-direct.wat').read_text()
assert old.count('(i32.store') == 8, 'Baseline flag stores changed'
assert new.count('(i32.store') == 9 and '(if' in new, 'Missing guarded single-store fast path'
receipt = {
    'sourcePins': pins,
    'candidateVuSharedSha256': sha(out / 'candidate/Source/ee/VUShared.cpp'),
    'sdk': IMAGE,
    'retainedArchives': {name: sha(libraries / name) for name in archives},
    'fixtureInputs': {name: sha(out / name) for name in ['generate.cpp', 'execute.cjs']},
    'baselineDirectBytes': (out / 'baseline-direct.wasm').stat().st_size,
    'candidateDirectBytes': (out / 'candidate-direct.wasm').stat().st_size,
    'gamePerformanceClaim': False,
}
(out / 'provenance.json').write_text(json.dumps(receipt, indent=2) + '\n')
print('PASS actual VU flag-reader generation/execution and signed i32 code shape; artifacts:', out)
