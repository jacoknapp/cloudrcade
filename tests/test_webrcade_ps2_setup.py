#!/usr/bin/env python3
"""Compile exact pinned GS parser/cache-prefix differential (host C++, no GPU).

--upstream is the pinned ps2-web-recomp checkout; --output owns scratch artifacts.
The generated parser and actual make_setup/draw cache prefix are compiled, not a
second implementation of the cache. Device raster/VRAM equality is a later gate.
"""
import argparse
import json
import re
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--upstream', type=Path, required=True)
p.add_argument('--output', type=Path)
a = p.parse_args()
pin = json.loads((ROOT / 'deploy/webrcade/retro-play/core.json').read_text())['gpuCommit']
for name in ['LICENSE', 'runtime/src/gs/gs.hpp', 'runtime/src/gs/gs.cpp',
             'runtime/src/gs/gpu/gpu.cpp', 'runtime/src/gs/gpu/gpu.hpp',
             'runtime/src/gs/gpu/gs.wgsl', 'runtime/src/gs/gpu/blit.wgsl']:
    raw = subprocess.check_output(['git', '-C', str(a.upstream), 'show', pin+':'+name])
    assert (a.upstream / name).read_bytes() == raw, 'Pinned input changed: '+name
out = (a.output or Path(tempfile.mkdtemp(prefix='ps2-setup-fixture-'))).resolve()
out.mkdir(parents=True, exist_ok=True)
subprocess.run(['python3', str(ROOT / 'deploy/webrcade/retro-play/gpu/prepare.py'),
                str(a.upstream), str(out)], check=True)
state = (out / 'state.cpp').read_text()
mask = 'constexpr std::uint64_t kVertexRegs = (1ull << 0x00) | (1ull << 0x01)'
assert state.count(mask) == 1, 'PRIM cache candidate missing'
(out / 'state-control.cpp').write_text(state.replace(mask, 'constexpr std::uint64_t kVertexRegs = (1ull << 0x01)'))
gpu = (out / 'gpu.cpp').read_text()
bridge = (out / 'bridge.cpp').read_text()

def function(source, signature):
    assert source.count(signature) == 1, signature
    start = source.index(signature)
    brace = source.index('{', start)
    # Selected snippets have no brace characters in string literals/comments.
    depth = 1
    end = brace + 1
    while depth:
        if source[end] == '{':
            depth += 1
        elif source[end] == '}':
            depth -= 1
        end += 1
    return source[start:end]

def structure(signature):
    value = function(gpu, signature)
    return value + ';'

setup_words = re.findall(r'^constexpr std::uint32_t kSetupWords = \d+;$', gpu, re.M)
assert len(setup_words) == 1
parts = [setup_words[0], structure('struct Range {'), structure('struct SetupCache {'),
         function(gpu, 'void page_size('), function(gpu, 'Range region('),
         function(gpu, 'std::uint32_t z_max('), function(gpu, 'std::uint32_t make_setup(')]
# Structure extractor includes its declaration only. The production variable
# follows its closing brace; the fixture declares that variable itself.
parts.insert(3, 'SetupCache g_setup_cache;')
start = gpu.index('void draw(const State &st, const Vertex *v, int count) {')
end = gpu.index('    const bool fst =', start)
prefix = gpu[start:end]
assert prefix.count('cache.flags = make_setup(st, attr, cache.setup);') == 1
prefix = prefix.replace('cache.flags = make_setup(st, attr, cache.setup);',
                        '++setupMisses; cache.flags = make_setup(st, attr, cache.setup);')
parts.append(prefix + '\n    inspect_setup(st, v, count, prim, c, setup, flags, cache);\n}')
(out / 'cache-actual.inc').write_text('\n\n'.join(parts))
(out / 'bridge-actual.inc').write_text('\n\n'.join(function(bridge, signature) for signature in [
    'EMSCRIPTEN_KEEPALIVE const std::uint8_t* gpu_save()',
    'EMSCRIPTEN_KEEPALIVE void gpu_load(', 'EMSCRIPTEN_KEEPALIVE void gpu_reset()']))
shutil.copyfile(ROOT / 'tests/fixtures/ps2-setup/setup-fixture.cpp', out / 'setup-fixture.cpp')
outputs = {}
for variant, src, reuse in [('control', 'state-control.cpp', 0), ('candidate', 'state.cpp', 1)]:
    binary = out / variant
    subprocess.run(['g++', '-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror',
                    '-DPS2_GPU', '-DPRIM_REUSES_SETUP='+str(reuse), '-I'+str(out),
                    str(out / src), str(out / 'setup-fixture.cpp'), '-o', str(binary)], check=True)
    outputs[variant] = json.loads(subprocess.check_output([str(binary)], text=True))
assert outputs['candidate']['digest'] == outputs['control']['digest'], outputs
for key in ['draws', 'clutLoads', 'imageBegins', 'imageData', 'copies', 'texflushes']:
    assert outputs['candidate'][key] == outputs['control'][key], key
assert outputs['candidate']['setupMisses'] < outputs['control']['setupMisses'], outputs
(out / 'result.json').write_text(json.dumps(outputs, indent=2)+'\n')
print('PASS exact generated GS parser/cache setup, queue/attribute/context/CLUT/state differential:', json.dumps(outputs))
