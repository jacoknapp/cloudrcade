#!/usr/bin/env python3
"""Compile/run exact pinned-scalar vs SIMD Wasm differential fixture (Docker/Node)."""
import argparse
import hashlib
import shutil
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PIN = '587f278917acc0026bf5fc34b39f995fc26bd015'
SHA = '3113cb12686ab67df133f9843517431ba4aef54e0f07015c9263dba467c6e5a9'
IMAGE = 'emscripten/emsdk@sha256:90b757eb11fa9a0e3ce4d2d9f76d932a56018e4accc37b5a28b2783751e60eb7'
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--framework', type=Path, required=True)
p.add_argument('--output', type=Path)
p.add_argument('--cpu-timing', type=Path, default=ROOT / 'deploy/webrcade/retro-play/native/CpuTiming.h')
a = p.parse_args()
out = a.output or Path(tempfile.mkdtemp(prefix='ps2-movie-fixture-'))
out.mkdir(parents=True, exist_ok=True)
raw = subprocess.check_output(['git', '-C', str(a.framework), 'show', PIN + ':src/idct/IEEE1180.cpp'])
assert hashlib.sha256(raw).hexdigest() == SHA, 'pinned scalar source mismatch'
(out / 'scalar.cpp').write_bytes(raw)
assert a.cpu_timing.is_file(), 'CpuTiming.h missing; supply --cpu-timing when testing this isolated candidate'
shutil.copyfile(a.cpu_timing, out / 'CloudCpuTiming.h')
subprocess.run(['g++', '-std=c++17', '-O2', '-pthread', '-I'+str(out.resolve()), '-I'+str(ROOT / 'deploy/webrcade/retro-play/native'), str(ROOT / 'tests/fixtures/ps2-movie/metrics-fixture.cpp'), '-o', str(out / 'metrics-fixture')], check=True)
subprocess.run([str(out / 'metrics-fixture')], check=True)
print('PASS movie metrics: disabled/classification/epoch/toggle-crossing/concurrent readers', flush=True)
(out / 'scalar-wrapper.cpp').write_text('''#define CIEEE1180 PinnedIEEE1180
#include "idct/IEEE1180.h"
extern "C" void pinnedTransform(const int16* in, int16* out) {
 IDCT::PinnedIEEE1180::GetInstance()->Transform(in, out);
}
''')
for source in ['scalar.cpp', 'scalar-wrapper.cpp']:
 subprocess.run(['docker', 'run', '--rm', '-v', str(out.resolve())+':/fixture', '-v', str(a.framework.resolve())+':/framework:ro', IMAGE,
  'em++', '-O3', '-ffp-contract=off', '-fno-vectorize', '-fno-slp-vectorize', '-DCIEEE1180=PinnedIEEE1180', '-I/framework/include', '-c', '/fixture/'+source, '-o', '/fixture/'+source+'.o'], check=True)
subprocess.run(['docker', 'run', '--rm', '-v', str(out.resolve())+':/fixture', '-v', str(ROOT)+':/repo:ro', '-v', str(a.framework.resolve())+':/framework:ro', IMAGE,
 'em++', '-O3', '-ffp-contract=off', '-msimd128', '-I/framework/include', '-c', '/repo/deploy/webrcade/retro-play/native/IEEE1180.cpp', '-o', '/fixture/candidate.o'], check=True)
# Match production: SIMD is enabled only for the IDCT source, not at final link.
subprocess.run(['docker', 'run', '--rm', '-v', str(out.resolve())+':/fixture', '-v', str(ROOT)+':/repo:ro', '-v', str(a.framework.resolve())+':/framework:ro', IMAGE,
 'em++', '-O3', '-ffp-contract=off', '-I/framework/include', '/repo/tests/fixtures/ps2-movie/idct-fixture.cpp', '/fixture/candidate.o', '/fixture/scalar.cpp.o', '/fixture/scalar-wrapper.cpp.o', '-sENVIRONMENT=node', '-sINITIAL_MEMORY=67108864', '-sWASM_ASYNC_COMPILATION=0', '-o', '/fixture/fixture.cjs', '--emit-symbol-map'], check=True)
subprocess.run(['node', str(out / 'fixture.cjs')], check=True)
# Inspect final linked Wasm, not merely an object file.
subprocess.run(['docker', 'run', '--rm', '-v', str(out.resolve())+':/fixture', IMAGE, '/emsdk/upstream/bin/wasm-dis', '/fixture/fixture.wasm', '-o', '/fixture/candidate.wat'], check=True)
wat = (out / 'candidate.wat').read_text()
for instruction in ['f64x2.mul', 'f64x2.add', 'f64x2.floor']:
 assert instruction in wat, 'missing codegen: ' + instruction
assert 'relaxed' not in wat
print('PASS SIMD codegen; fixture artifacts:', out)
