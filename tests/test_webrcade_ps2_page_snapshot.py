#!/usr/bin/env python3
"""Actual installed coherence source plus lifecycle/bounds/codegen (Docker/Node)."""
import argparse
import hashlib
import json
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
from test_webrcade_ps2_sparse_snapshot import BASELINE, PATCHED, CALL

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / 'deploy/webrcade/retro-play'
FIXTURE = ROOT / 'tests/fixtures/ps2-page-snapshot'
SDK = 'emscripten/emsdk@sha256:90b757eb11fa9a0e3ce4d2d9f76d932a56018e4accc37b5a28b2783751e60eb7'
PLAY = 'd44bfa1814b729d4a3ed3c6c3a945432d5ee5bbe'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--play', required=True, type=Path, help='Pinned Play checkout (read only; original files from git)')
parser.add_argument('--output', type=Path)
parser.add_argument('--source-only', action='store_true', help='Install/check/extract both variants; no compiler, Docker or Node')
args = parser.parse_args()
out = (args.output or Path(tempfile.mkdtemp(prefix='ps2-page-snapshot-'))).resolve()
out.mkdir(parents=True, exist_ok=True)
assert subprocess.check_output(['git', '-C', str(args.play), 'rev-parse', 'HEAD'], text=True).strip() == PLAY


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def between(text, start, end):
    assert text.count(start) == 1 and text.count(end) == 1
    return text.split(start, 1)[1].split(end, 1)[0]


# Execute the real baseline installer and then the actual new terminal helper.
# Exact installed four-source pins prevent a stale fragment from qualifying.
patch = (NATIVE / 'patch-native.py').read_text()
assert patch.count(CALL) == 1 and patch.rstrip().endswith(CALL)
fragment = patch[patch.index('# Keep the exact page-comparison SIMD'):patch.index('# Snapshot source offsets')]
source_receipt = {}
for variant, pins in [('baseline', BASELINE), ('candidate', PATCHED)]:
    work = out / variant
    work.mkdir()  # Never overwrite an earlier fixture or its failure evidence.
    for name in ['Source/CMakeLists.txt', 'Source/ee/EeExecutor.cpp', 'Source/ee/EeExecutor.h', 'Source/ee/PS2OS.cpp']:
        dest = work / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(subprocess.check_output(['git', '-C', str(args.play), 'show', 'HEAD:'+name]))

    def edit(name, old, new):
        target = work / name
        text = target.read_text()
        assert text.count(old) == 1, 'Pinned source changed: '+name
        target.write_text(text.replace(old, new))

    exec(compile(fragment, str(NATIVE / 'patch-native.py'), 'exec'), {'root': work, 'here': NATIVE, 'edit': edit})
    assert {name: digest(work / name) for name in BASELINE} == BASELINE
    if variant == 'candidate':
        subprocess.run([sys.executable, str(NATIVE / 'patch-coherence-sparse16.py'), str(work)], check=True)
    actual = {name: digest(work / name) for name in pins}
    assert actual == pins
    # Always re-extract actual product bodies AFTER applying the real helper.
    source = (work / 'Source/ee/EeExecutor.cpp').read_text()
    header = (work / 'Source/ee/EeExecutor.h').read_text()
    sections = {
        'members.inc': between(header, '\tCachedBlockMap m_cachedBlocks;\n#ifdef __EMSCRIPTEN__\n', '\n#endif\n\n\tIdleLoopBlockMap'),
        'register.inc': between(source, '\tmemcpy(&hash, &xxHash, sizeof(xxHash));\n#ifdef __EMSCRIPTEN__\n', '\n#endif\n\tstatic_assert'),
        'clear.inc': between(source, '\tCGenericMipsExecutor::ClearActiveBlocksInRange(start, end, executing);\n#ifdef __EMSCRIPTEN__\n', '\n#endif\n}\n\nBasicBlockPtr'),
        'reset.inc': between(source, '\tm_cachedBlocks.clear();\n#ifdef __EMSCRIPTEN__\n', '\n#endif\n\tm_blockFpRoundingModes.clear();'),
        'sync.inc': source[source.index('void CEeExecutor::SyncInstructionCache()'):].removesuffix('#endif\n'),
    }
    for name, text in sections.items():
        (work / name).write_text(text)
    for name in ['cache-fixture.cpp', 'cache-fixture.cjs', 'sparse-tests.inc', 'registration-tests.inc']:
        shutil.copyfile(FIXTURE / name, work / name)
    for name in ['CloudInstructionPage.h', 'CloudInstructionPage.cpp']:
        shutil.copyfile(work / 'Source' / name, work / name)
    for name, sha in [('xxhash.h', '17973c0dc49d9854ca26caa191f0e12f7a424b68858d9a78de3860d959d85e4b'), ('xxhash.c', '5c3591fe6e6c86a619eb26760e9520e37a6fd5152882ab5ad93f912e2a855966')]:
        src = args.play / 'deps/Dependencies/xxHash' / name
        assert digest(src) == sha
        shutil.copyfile(src, work / name)
    source_receipt[variant] = {'installedSources': actual,
                               'extractedBodies': {name: digest(work / name) for name in sections}}

(out / 'installed-source.json').write_text(json.dumps(source_receipt, indent=2)+'\n')
if args.source_only:
    print('PASS source-only actual baseline/candidate installation and fresh body extraction; no execution proof:', out)
    raise SystemExit(0)

for variant in ['baseline', 'candidate']:
    work = out / variant

    def sdk(*command):
        subprocess.run(['docker', 'run', '--rm', '--network', 'none', '-v', str(work)+':/fixture', '-w', '/fixture', SDK, *command], check=True)

    sdk('emcc', '-O3', '-DNDEBUG', '-fexceptions', '-pthread', '-msimd128', '-c', 'xxhash.c', '-o', 'xxhash.o')
    sdk('em++', '-O3', '-fexceptions', '-pthread', '-msimd128', '-c', 'CloudInstructionPage.cpp', '-o', 'page.o')
    # These macros select only fixture expectations/oracles, never product code.
    fixture_flags = ['-DCOHERENCE_PENDING', '-DPROTOTYPE_SPARSE'] if variant == 'candidate' else []
    # Existing EE source and final link retain their original no-SIMD flags.
    sdk('em++', '-O3', '-fexceptions', '-pthread', '-std=c++17', *fixture_flags,
        'cache-fixture.cpp', 'page.o', 'xxhash.o', '--profiling-funcs',
        '-sMODULARIZE=1', '-sENVIRONMENT=node', '-sALLOW_MEMORY_GROWTH=1', '-sASSERTIONS=1',
        '-sEXPORTED_FUNCTIONS=[_run_fixture,_run_sparse_checks,_run_registration_matrix,_run_extended_lifecycle,_instruction_page_bytes,_assign_snapshot,_equals_snapshot,_equals_covered_snapshot,_create_pages,_destroy_pages,_compare_pages,_hash_pages,_malloc,_free]',
        '-sEXPORTED_RUNTIME_METHODS=HEAPU8', '-o', 'cache.cjs')
    subprocess.run(['node', str(work / 'cache-fixture.cjs'), variant], check=True)
    sdk('/emsdk/upstream/bin/wasm-dis', 'cache.wasm', '-o', 'cache.wat')
    wat = (work / 'cache.wat').read_text()
    for op in ['v128.load', 'v128.xor', 'v128.or', 'v128.any_true']:
        assert op in wat, 'Missing page-compare SIMD: '+op
    assert 'relaxed' not in wat
    # With JS exceptions enabled, equality feeds the unchanged-page branch
    # directly (or inline), without an intervening EH flag check.
    start = wat.index(' (func $CEeExecutor::SyncInstructionCache')
    body = wat[start:wat.index('\n (func ', start + 1)]
    comparison = 'EqualsCovered' if variant == 'candidate' else 'Equals'
    if '(call $CloudInstructionPage::'+comparison in body:
        assert re.search(r'\(br_if \$\S+\s+\(call \$CloudInstructionPage::'+comparison, body), 'Comparison retains EH flag checks'
    else:
        assert body.count('(v128.xor') >= 4, 'Missing inlined exact comparison'
    if variant == 'candidate':
        start = wat.index(' (func $CloudInstructionPage::EqualsCovered')
        sparse = wat[start:wat.index('\n (func ', start+1)]
        for op in ['v128.load', 'v128.xor', 'v128.or', 'v128.any_true', 'i64.ctz']:
            assert '('+op in sparse, 'Missing sparse codegen: '+op
        assert 'popcnt' not in sparse and 'popcnt' not in body, 'Per-flush popcount introduced'

print('PASS actual baseline and sparse coherence, retained negative controls, lifecycle, byte/bounds and target-local SIMD codegen; artifacts:', out)
