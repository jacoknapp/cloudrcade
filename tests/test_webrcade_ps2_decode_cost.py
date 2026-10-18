#!/usr/bin/env python3
"""Host differential of exact pinned/candidate decode planners; no GPU or ROM.

python3 tests/test_webrcade_ps2_decode_cost.py --upstream <pinned gs checkout>
Actual generated planner code is compiled with observed renderer range state.
This tests scheduling/key/budget invariants, not GPU pixel equality or speed.
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--upstream', type=Path, required=True)
p.add_argument('--output', type=Path)
a = p.parse_args()
pin = json.loads((ROOT / 'deploy/webrcade/retro-play/core.json').read_text())['gpuCommit']
for name in ['LICENSE', 'runtime/src/gs/gs.cpp', 'runtime/src/gs/gs.hpp',
             'runtime/src/gs/gpu/gpu.cpp', 'runtime/src/gs/gpu/gpu.hpp',
             'runtime/src/gs/gpu/gs.wgsl', 'runtime/src/gs/gpu/blit.wgsl']:
    raw = subprocess.check_output(['git', '-C', str(a.upstream), 'show', pin+':'+name])
    assert (a.upstream/name).read_bytes() == raw, 'Pinned input changed: '+name
out = (a.output or Path(tempfile.mkdtemp(prefix='ps2-decode-cost-'))).resolve()
out.mkdir(parents=True, exist_ok=True)
subprocess.run(['python3', str(ROOT/'deploy/webrcade/retro-play/gpu/prepare.py'),
                str(a.upstream), str(out)], check=True)
current = (out/'gpu.cpp').read_text()
reference = (a.upstream/'runtime/src/gs/gpu/gpu.cpp').read_text()
def section(source, signature):
    assert source.count(signature) == 1, signature
    start = source.index(signature)
    end = source.index('{', start)+1
    depth = 1
    while depth:
        if source[end] == '{': depth += 1
        elif source[end] == '}': depth -= 1
        end += 1
    return source[start:end]
constants = []
for name in ['kPrimWords', 'kSetupWords', 'kDecodedWords', 'kDecodePrims']:
    matches = re.findall(r'^constexpr std::uint32_t '+name+r' = .*?;$', current, re.M)
    assert len(matches) == 1
    constants += matches
parts = constants+[section(current, 'struct Range {')+';',
                   section(current, 'struct Batch {')+';']
parts += ['Batch g_batch;', 'std::uint32_t g_scale=1, g_decoded_used=0;',
          'bool g_decode=true, g_rendered[512]{};',
          section(current, 'struct Decode {')+';',
          'std::vector<Decode> g_decodes; std::vector<std::uint64_t> g_decode_pixels;']
parts += [section(current, s) for s in ['void page_size(', 'Range pages(', 'bool rendered(']]
parts += [section(reference, 'void plan_decodes(').replace('void plan_decodes(', 'void reference_plan('),
          section(current, 'void plan_decodes(')]
(out/'planner-actual.inc').write_text('\n\n'.join(parts))
shutil.copyfile(ROOT/'tests/fixtures/ps2-decode-cost/planner-fixture.cpp',out/'planner-fixture.cpp')
subprocess.run(['g++','-std=c++17','-O2','-Wall','-Wextra','-Werror','-I'+str(out),
                str(out/'planner-fixture.cpp'),'-o',str(out/'planner-fixture')],check=True)
subprocess.run([str(out/'planner-fixture')],check=True)
print('PASS exact pinned/generated planner differential; GPU pixel/replay qualification remains required')
