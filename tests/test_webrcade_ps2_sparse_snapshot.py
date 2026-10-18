#!/usr/bin/env python3
"""Install the real PS2 patch chain from pinned Git source; no compiler/network.

Run with --play PATH to an existing pinned upstream Play checkout. Its working
files are never used or modified. This source/install regression supplements
the actual native/Wasm page-coherence fixture; it does not claim runtime proof.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
RECIPE = ROOT / 'deploy/webrcade/retro-play'
UPSTREAM = 'd44bfa1814b729d4a3ed3c6c3a945432d5ee5bbe'
FRAMEWORK = '587f278917acc0026bf5fc34b39f995fc26bd015'
BASELINE = {
    'Source/CloudInstructionPage.cpp': '940ceca6685467ce50ecc6f02c5640308281908eafdc7ed262676c4a1c17b393',
    'Source/CloudInstructionPage.h': '9dd4af2ed8c74950341fe0eb2010676180a06dfb8324fd0bb9dd358b77521afe',
    'Source/ee/EeExecutor.cpp': 'ea466c48a6ee09b8eaed50194ba689c2c958b495414c394468ffe9f58cafc3e1',
    'Source/ee/EeExecutor.h': 'edb5bc887ae177a8583ee7eb46a59c97796a1d1c886a40fa469e94224ef67e47',
}
# Independently frozen prototype outputs, not calculated from patch CHANGES.
PATCHED = {
    'Source/CloudInstructionPage.cpp': 'a93868c9e1259d34f7802ae0cae2064d9adfbc1c362f8b2a167dbff33bbb2334',
    'Source/CloudInstructionPage.h': '8b8ba8de5e2d235eb200871b2f2672604cf2125e86670c19679d7e5c41d268b5',
    'Source/ee/EeExecutor.cpp': '40e945d3a66efd26a7905ef5db5cf0e6e60e70def2f7abe0fcd516513e30e6bd',
    'Source/ee/EeExecutor.h': '25c796366e67b31704c2564801952c26dc087051e0312b8a72c1f99a97888f6b',
}
CALL = "subprocess.run([sys.executable, str(here / 'patch-coherence-sparse16.py'), str(root)], check=True)"


def git(checkout, *args):
    return subprocess.check_output(['git', '-C', str(checkout), *args])


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inventory(root):
    return {p.relative_to(root).as_posix(): sha(p)
            for p in root.rglob('*') if p.is_file()}


def extract(checkout, commit, destination, paths):
    # Only exact committed blobs under selected source paths, never scratch
    # working files, generated build outputs, Git metadata or submodule caches.
    entries = git(checkout, 'ls-tree', '-rz', commit, '--', *paths).split(b'\0')
    for entry in filter(None, entries):
        metadata, name = entry.split(b'\t', 1)
        mode, kind, oid = metadata.split()
        if kind != b'blob':
            continue
        relative = Path(name.decode())
        assert not relative.is_absolute() and '..' not in relative.parts
        assert mode in (b'100644', b'100755'), relative
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(git(checkout, 'cat-file', 'blob', oid.decode()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--play', required=True, type=Path)
    args = parser.parse_args()
    assert git(args.play, 'rev-parse', 'HEAD').decode().strip() == UPSTREAM
    framework = args.play / 'deps/Framework'
    assert git(framework, 'rev-parse', 'HEAD').decode().strip() == FRAMEWORK
    assert json.loads((RECIPE / 'core.json').read_text())['commit'] == UPSTREAM
    patch_text = (RECIPE / 'patch-native.py').read_text()
    assert patch_text.count(CALL) == 1
    assert patch_text.rstrip().endswith(CALL), 'Sparse patch must follow baseline helpers'
    spec = importlib.util.spec_from_file_location('sparse_patch', RECIPE / 'patch-coherence-sparse16.py')
    helper = importlib.util.module_from_spec(spec)
    # Avoid creating source-tree bytecode during source-only qualification.
    sys.dont_write_bytecode = True
    spec.loader.exec_module(helper)
    assert helper.PINS == BASELINE

    with tempfile.TemporaryDirectory(prefix='ps2-sparse-install-') as temporary:
        out = Path(temporary)
        pristine = out / 'pristine'
        extract(args.play, UPSTREAM, pristine, ['Source', 'CMakeLists.txt'])
        extract(framework, FRAMEWORK, pristine / 'deps/Framework',
                ['src/idct/IEEE1180.cpp', 'build_cmake/Framework/CMakeLists.txt'])
        baseline = out / 'baseline'
        candidate = out / 'candidate'
        shutil.copytree(pristine, baseline)
        shutil.copytree(pristine, candidate)
        # Execute the actual baseline chain from a temporary sibling recipe,
        # omitting only the explicit new terminal call. Native templates stay
        # the original product inputs; their four installed hashes are pinned.
        baseline_recipe = out / 'recipe'
        shutil.copytree(RECIPE, baseline_recipe, ignore=shutil.ignore_patterns('gpu', '__pycache__'))
        (baseline_recipe / 'patch-native.py').write_text(patch_text.replace(CALL, '', 1))
        subprocess.run([sys.executable, str(baseline_recipe / 'patch-native.py'), str(baseline)], check=True)
        assert {n: sha(baseline / n) for n in BASELINE} == BASELINE
        subprocess.run([sys.executable, str(RECIPE / 'patch-native.py'), str(candidate)], check=True)
        assert {n: sha(candidate / n) for n in PATCHED} == PATCHED
        before = inventory(baseline)
        after = inventory(candidate)
        assert before.keys() == after.keys(), 'Sparse integration changes installed file inventory'
        assert {n for n in before if before[n] != after[n]} == set(PATCHED)

        # Every original must be checked before *any* output is changed.
        # Exercise drift in each independently pinned source and missing input.
        for name in BASELINE:
            for missing in (False, True):
                guarded = out / 'guarded'
                guarded.mkdir()
                for relative in BASELINE:
                    path = guarded / relative
                    path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(baseline / relative, path)
                if missing:
                    (guarded / name).unlink()
                else:
                    with (guarded / name).open('ab') as stream:
                        stream.write(b'\n// controlled source drift\n')
                before_guard = inventory(guarded)
                try:
                    helper.patch(guarded)
                except (ValueError, FileNotFoundError):
                    pass
                else:
                    raise AssertionError('Accepted changed source: ' + name)
                assert inventory(guarded) == before_guard, 'Rejected input partially written'
                shutil.rmtree(guarded)
        before_repeat = inventory(candidate)
        try:
            helper.patch(candidate)
        except ValueError:
            pass
        else:
            raise AssertionError('Repeated sparse patch accepted')
        assert inventory(candidate) == before_repeat

        # A late failed replacement must also leave every original untouched,
        # even after earlier output substitutions have succeeded in memory.
        guarded = out / 'late-anchor'
        for name in BASELINE:
            path = guarded / name
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(baseline / name, path)
        before_anchor = inventory(guarded)
        changes = helper.CHANGES
        helper.CHANGES = [*changes, ('Source/ee/EeExecutor.cpp',
                                    '__controlled_missing_anchor__', '')]
        try:
            helper.patch(guarded)
        except ValueError:
            pass
        else:
            raise AssertionError('Missing late source anchor accepted')
        finally:
            helper.CHANGES = changes
        assert inventory(guarded) == before_anchor

    print('PASS actual pinned patch-native install: exact four prototype outputs, '
          'all other installed sources retained; eight missing/drift, repeat '
          'and late-anchor guards atomic')


if __name__ == '__main__':
    main()
