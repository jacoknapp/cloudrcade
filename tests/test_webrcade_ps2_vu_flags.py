#!/usr/bin/env python3
"""Execute actual pinned CodeGen Wasm MakeSz before/after the sign-byte change.
Requires a retained Play build (read-only), Docker SDK and Node; no ROM/GPU.
Only the changed emitter object + tiny fixture are compiled, never Play itself.
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
p.add_argument('--play', required=True, type=Path, help='Retained baseline Play checkout with Release libraries')
p.add_argument('--output', type=Path)
a = p.parse_args()
play = a.play.resolve()
out = (a.output or Path(tempfile.mkdtemp(prefix='ps2-vu-flags-'))).resolve()
out.mkdir(parents=True, exist_ok=True)
source = play / 'deps/CodeGen/src/Jitter_CodeGen_Wasm_Md.cpp'
original = source.read_bytes()
# Pin exact emitted instruction recipe, not a hand-written imitation.
assert hashlib.sha256(original).hexdigest() == '2b95f7cea0ba4537c92424e1f495f9bbd35d1a18049dc188e12130592e4071f1', 'Baseline CodeGen emitter changed'
for variant in ['baseline', 'candidate']:
    dst = out / variant / 'deps/CodeGen/src'
    dst.mkdir(parents=True, exist_ok=True)
    (dst / source.name).write_bytes(original)
patch = ROOT / 'deploy/webrcade/retro-play/patch-vu-flags.py'
spec = importlib.util.spec_from_file_location('vu_flags_patch', patch)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.patch(out / 'candidate')
candidate = (out / 'candidate/deps/CodeGen/src' / source.name).read_text()
start = original.decode().index('void CCodeGen_Wasm::Emit_Md_MakeSz_MemMem(')
end = original.decode().index('\nvoid CCodeGen_Wasm::', start + 1)
new_start = candidate.index('void CCodeGen_Wasm::Emit_Md_MakeSz_MemMem(')
new_end = candidate.index('\nvoid CCodeGen_Wasm::', new_start + 1)
assert original.decode()[:start] == candidate[:new_start] and original.decode()[end:] == candidate[new_end:]
try:
    module.patch(out / 'candidate')
except ValueError:
    pass
else:
    raise AssertionError('Repeated patch must fail closed')
for name in ['generate.cpp', 'execute.cjs']:
    shutil.copyfile(ROOT / 'tests/fixtures/ps2-vu-flags' / name, out / name)
build = 'build_cmake/build/wasm-ninja/Source/ui_js/Source'
libraries = [f'/src/{build}/CodeGen/Release/libCodeGen.a', f'/src/{build}/Framework/Release/libFramework.a']

def sdk(*args):
    subprocess.run(['docker', 'run', '--rm', '--network', 'none', '-v', str(play)+':/src:ro',
                    '-v', str(out)+':/fixture', '-w', '/fixture', IMAGE, *args], check=True)

for variant in ['baseline', 'candidate']:
    common = ['-O3', '-DNDEBUG', '-std=c++17', '-pthread', '-fexceptions',
              '-I/src/deps/CodeGen/include', '-I/src/deps/Framework/include']
    sdk('em++', *common, '-c', variant+'/deps/CodeGen/src/'+source.name, '-o', variant+'.o')
    sdk('em++', *common, 'generate.cpp', variant+'.o', *libraries,
        '-sENVIRONMENT=node', '-sMODULARIZE=1', '-sALLOW_MEMORY_GROWTH=1',
        '-sEXPORTED_FUNCTIONS=[_generate,_generatedSize]', '-sEXPORTED_RUNTIME_METHODS=HEAPU8',
        '-o', variant+'.cjs')
subprocess.run(['node', str(out / 'execute.cjs')], check=True)
for variant in ['baseline', 'candidate']:
    sdk('/emsdk/upstream/bin/wasm-dis', variant+'-generated.wasm', '-o', variant+'-generated.wat')
old = (out / 'baseline-generated.wat').read_text()
new = (out / 'candidate-generated.wat').read_text()
assert old.count('(i32x4.shr_s') == 1 and new.count('(i32x4.shr_s') == 0
assert old.count('(f32x4.eq') == new.count('(f32x4.eq') == 1
assert old.count('(i8x16.shuffle') == new.count('(i8x16.shuffle') == 1
assert old.count('(i16x8.bitmask') == new.count('(i16x8.bitmask') == 1
assert '14 15 10 11 6 7 2 3' in new
assert (out / 'baseline-generated.wasm').stat().st_size - (out / 'candidate-generated.wasm').stat().st_size == 5
print('PASS actual pinned Wasm MakeSz execution and codegen: one vector shift/five bytes removed per operation; artifacts:', out)
