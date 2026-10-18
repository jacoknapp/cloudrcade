#!/usr/bin/env python3
"""Run native timing semantics and inspect pinned JS-EH Wasm call paths."""
import argparse
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/ps2-timing'
IMAGE = 'emscripten/emsdk@sha256:90b757eb11fa9a0e3ce4d2d9f76d932a56018e4accc37b5a28b2783751e60eb7'
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', type=Path)
p.add_argument('--baseline-header', type=Path, help='Optional prior CpuTiming.h for balanced warm microbenchmark')
a = p.parse_args()
out = (a.output or Path(tempfile.mkdtemp(prefix='ps2-timing-codegen-'))).resolve()
out.mkdir(parents=True, exist_ok=True)
shutil.copyfile(ROOT / 'deploy/webrcade/retro-play/native/CpuTiming.h', out / 'candidate.h')
for name in ['codegen.cpp', 'screen.cjs']:
    shutil.copyfile(FIXTURE / name, out / name)
variants = ['candidate']
if a.baseline_header:
    shutil.copyfile(a.baseline_header, out / 'baseline.h')
    variants.insert(0, 'baseline')
elif (out / 'baseline.cjs').exists():
    raise ValueError('Output contains stale baseline; choose an empty output directory')

def sdk(*args):
    subprocess.run(['docker', 'run', '--rm', '--network', 'none',
                    '-v', str(ROOT)+':/repo:ro', '-v', str(out)+':/fixture', '-w', '/fixture', IMAGE, *args], check=True)

sdk('em++', '-O2', '-std=c++17', '-pthread', '-fexceptions',
    '/repo/tests/test_webrcade_ps2_cpu_timing.cpp', '-sPTHREAD_POOL_SIZE=1',
    '-sENVIRONMENT=node', '-sEXIT_RUNTIME=1', '-o', 'semantics.cjs')
subprocess.run(['node', str(out / 'semantics.cjs')], check=True)
indirect_counts = {}
for name in variants:
    sdk('em++', '-O3', '-std=c++17', '-pthread', '-fexceptions', '-DHEADER="'+name+'.h"',
        'codegen.cpp', '-sENVIRONMENT=node', '-sMODULARIZE=1',
        '-sEXPORTED_FUNCTIONS=[_runTimed,_runDirect,_enable,_bodyPointer,_body,_calls,_samples]',
        '--emit-symbol-map', '-o', name+'.cjs')
    sdk('/emsdk/upstream/bin/wasm-dis', name+'.wasm', '-o', name+'.wat')
    wat = (out / (name+'.wat')).read_text()
    imports = len(re.findall(r'^ \(import .*\(func ', wat, re.M))
    symbols = {int(line.split(':', 1)[0]): line.split(':', 1)[1]
               for line in (out / (name+'.cjs.symbols')).read_text().splitlines()}
    index = next(index for index, label in symbols.items() if label == 'runTimed')
    functions = list(re.finditer(r'^ \(func ', wat, re.M))
    body = wat[functions[index-imports].start():functions[index-imports+1].start()]
    indirect_counts[name] = body.count('(call_indirect')
    (out / (name+'-runTimed.wat')).write_text(body)
assert indirect_counts['candidate'] >= 2, 'Missing direct disabled/unsampled body call paths'
if 'baseline' in variants:
    assert indirect_counts['candidate'] > indirect_counts['baseline'], 'Expected an additional cleanup-free unsampled path'
subprocess.run(['node', str(out / 'screen.cjs')], check=True)
print('PASS JS-EH codegen direct disabled/unsampled paths:', indirect_counts, 'artifacts:', out)
