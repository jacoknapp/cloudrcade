#!/usr/bin/env python3
"""Actual VUShared/CMipsJitter/Wasm differential for the bitmask reader.

Uses retained pinned CodeGen/Framework libraries read-only, replacing the three
changed actual CodeGen translation units explicitly at link time. Compiles the
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
IMAGE = 'sha256:cfb9617d93d63f0eaa3ee2563df595ec98fc7456854df77e680f8b472e173fc6'
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--play', required=True, type=Path)
p.add_argument('--libraries-play', type=Path, help='Retained build with matching CodeGen/Framework sources')
p.add_argument('--output', type=Path)
a = p.parse_args()
play = a.play.resolve()
libraries = (a.libraries_play or play).resolve()
out = (a.output or Path(tempfile.mkdtemp(prefix='ps2-vu-bitmask-'))).resolve()
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
spec = importlib.util.spec_from_file_location('bitmask', ROOT / 'deploy/webrcade/retro-play/patch-vu-bitmask.py')
patcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patcher)
for name in patcher.PINS:
    target = out / 'candidate' / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(play / name, target)
patcher.patch(out / 'candidate')
# Every guarded input must fail closed without partial changes.
guard_root = out / 'guard-negative'
for damaged in patcher.PINS:
    for name in patcher.PINS:
        target = guard_root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(play / name, target)
    damaged_path = guard_root / damaged
    damaged_path.write_bytes(damaged_path.read_bytes() + b'\n// deliberate guard negative control\n')
    before = {name: sha(guard_root / name) for name in patcher.PINS}
    try:
        patcher.patch(guard_root)
    except ValueError:
        pass
    else:
        raise AssertionError('Changed input accepted: ' + damaged)
    assert before == {name: sha(guard_root / name) for name in patcher.PINS}, 'Guard caused partial write'
shutil.rmtree(guard_root)

original = (out / 'baseline/Source/ee/VUShared.cpp').read_text()
candidate = (out / 'candidate/Source/ee/VUShared.cpp').read_text()
start = original.index('void VUShared::CheckFlagPipeline(')
end = original.index('\nvoid VUShared::QueueInFlagPipeline(', start)
new_end = candidate.index('\nvoid VUShared::QueueInFlagPipeline(', start)
assert original[:start] == candidate[:start] and original[end:] == candidate[new_end:]
old_method = original[start:end]
old_body = old_method[old_method.index('{') + 2:old_method.rindex('}')]
assert candidate[start:new_end].split('#else\n', 1)[1] == old_body + '#endif\n}\n'
try:
    patcher.patch(out / 'candidate')
except ValueError:
    pass
else:
    raise AssertionError('Repeated patch must fail closed')
for name in ['generate.cpp', 'execute.cjs']:
    shutil.copyfile(ROOT / 'tests/fixtures/ps2-vu-bitmask' / name, out / name)

# Full candidate headers allow quoted include resolution against the new enum/API.
for name in ['CodeGen', 'Framework']:
    shutil.copytree(play / 'deps' / name / 'include', out / 'candidate/deps' / name / 'include', dirs_exist_ok=True,
                    ignore=lambda directory, names: [n for n in names if
                        str((Path(directory) / n).relative_to(play)) in patcher.PINS])


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
candidate_flags = ['-I/fixture/candidate/deps/CodeGen/include', '-I/fixture/candidate/deps/Framework/include', *flags]
changed_objects = []
for name in ['Jitter.cpp', 'Jitter_CodeGen_Wasm_Md.cpp', 'Jitter_Statement.cpp']:
    obj = 'candidate-' + name + '.o'
    sdk('em++', *candidate_flags, '-c', 'candidate/deps/CodeGen/src/' + name, '-o', obj)
    changed_objects.append(obj)
for variant in ['baseline', 'candidate']:
    selected_flags = flags if variant == 'baseline' else [*candidate_flags, '-DKH_VU_BITMASK_FIXTURE=1']
    sdk('em++', *selected_flags, 'generate.cpp', variant + '/Source/ee/VUShared.cpp', 'mips-jitter.o', 'fp-utils.o',
        *(changed_objects if variant == 'candidate' else []), *['/retained/' + x for x in archives], '-sENVIRONMENT=node', '-sMODULARIZE=1', '-sALLOW_MEMORY_GROWTH=1',
        '-sEXPORTED_FUNCTIONS=[_generate,_generatedSize,_layout,_generateMask]', '-sEXPORTED_RUNTIME_METHODS=HEAPU8', '-o', variant + '.cjs')
subprocess.run(['node', str(out / 'execute.cjs')], check=True)
for variant in ['baseline', 'candidate']:
    sdk('/emsdk/upstream/bin/wasm-dis', variant + '-direct.wasm', '-o', variant + '-direct.wat')
    text = (out / (variant + '-direct.wat')).read_text()
    assert '(i64.' not in text, 'Flag timestamps must retain 32-bit semantics'
    assert 'i32.le_u' not in text and 'i32.gt_u' not in text, 'Unsigned comparison introduced'
    if variant == 'baseline': assert '(i32.le_s' in text
    else:
        assert text.count('(i32x4.gt_s') == 2, 'Signed SIMD compare missing'
        assert text.count('(i32x4.bitmask') == 2, 'Dedicated bitmask missing'
old = (out / 'baseline-direct.wat').read_text()
new = (out / 'candidate-direct.wat').read_text()
assert old.count('(i32.store') == 8, 'Baseline flag stores changed'
assert new.count('(i32.store') == 1, 'Expected one final flag store'
assert new.count('(v128.load') == 2, 'Expected two timestamp loads'
assert '(call ' not in new, 'Unexpected host/runtime call'
receipt = {
    'sourcePins': {**pins, **patcher.PINS},
    'candidatePatchedPins': {name: sha(out / 'candidate' / name) for name in patcher.PINS},
    'changedCodeGenObjects': {name: sha(out / name) for name in changed_objects},
    'candidateVuSharedSha256': sha(out / 'candidate/Source/ee/VUShared.cpp'),
    'sdk': IMAGE,
    'retainedArchives': {name: sha(libraries / name) for name in archives},
    'fixtureInputs': {name: sha(out / name) for name in ['generate.cpp', 'execute.cjs']},
    'baselineDirectBytes': (out / 'baseline-direct.wasm').stat().st_size,
    'candidateDirectBytes': (out / 'candidate-direct.wasm').stat().st_size,
    'directModuleHashes': {v: sha(out / (v + '-direct.wasm')) for v in ['baseline', 'candidate']},
    'gamePerformanceClaim': False,
}
(out / 'provenance.json').write_text(json.dumps(receipt, indent=2) + '\n')
print('PASS actual VU flag-reader generation/execution and signed i32 code shape; artifacts:', out)
