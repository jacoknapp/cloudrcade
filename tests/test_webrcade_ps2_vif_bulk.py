#!/usr/bin/env python3
"""Compile actual pinned VIF unpack/FIFO methods against an independent byte oracle.

Native C++ only; no SDK, browser, GPU, game, network or build-lock update. --play
is read-only. Generated original/patched snippets and receipts stay in --output.
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
PATCH = ROOT / 'deploy/webrcade/retro-play/patch-vif-bulk.py'
FIXTURE = ROOT / 'tests/fixtures/ps2-vif-bulk/fixture.cpp'
PIN = 'd44bfa1814b729d4a3ed3c6c3a945432d5ee5bbe'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def between(text, start, end):
    if text.count(start) != 1 or text.count(end) != 1:
        raise ValueError('Pinned extraction boundary changed')
    return text[text.index(start):text.index(end)]


def generate(header, source, name):
    stream = between(header, '\tclass CFifoStream\n', '\ttypedef CFifoStream StreamType;').replace('private:', 'public:')
    methods = source[source.index('CVif::CFifoStream::CFifoStream('):].replace('CVif::', '')
    unpack = between(header, '\tinline bool Unpack_S32(', '\ttypedef void (CVif::*Unpacker)')
    return f'namespace {name} {{\n' + stream + '\n' + methods + '\nstruct Vif : State {\n Vpu m_vpu;\n typedef CFifoStream StreamType;\n uint32 GetColMaskOp(unsigned int col) const { return (m_MASK >> (col * 8)) & 0xFF; }\n' + unpack + '\n};\n}\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--play', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--compiler', default='g++')
    parser.add_argument('--sanitize', action='store_true')
    parser.add_argument('--check-mutations', action='store_true')
    args = parser.parse_args()
    out = (args.output or Path(tempfile.mkdtemp(prefix='ps2-vif-bulk-'))).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if subprocess.check_output(['git', '-C', str(args.play), 'rev-parse', 'HEAD'], text=True).strip() != PIN:
        raise ValueError('Wrong pinned Play revision')
    spec = importlib.util.spec_from_file_location('vif_patch', PATCH)
    patch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(patch)
    inputs = {}
    for name in ['Source/ee/Vif.h', 'Source/ee/Vif.cpp', 'Source/uint128.h', 'deps/Framework/include/Types.h', 'deps/Framework/include/Convertible.h']:
        data = (args.play / name).read_bytes()
        # These methods must still be the upstream bytes, not ambient overrides.
        repo, rel = (args.play / 'deps/Framework', name.removeprefix('deps/Framework/')) if name.startswith('deps/Framework/') else (args.play, name)
        if data != subprocess.check_output(['git', '-C', str(repo), 'show', 'HEAD:' + rel]):
            raise ValueError('Modified extraction source: ' + name)
        inputs[name] = sha(data)
        dest = out / 'baseline' / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    shutil.copytree(out / 'baseline', out / 'candidate', dirs_exist_ok=True)
    patch.apply(out / 'candidate')
    original = (out / 'baseline/Source/ee/Vif.h').read_bytes()
    candidate = (out / 'candidate/Source/ee/Vif.h').read_bytes()
    patch.apply(out / 'candidate', reverse=True)
    if (out / 'candidate/Source/ee/Vif.h').read_bytes() != original:
        raise ValueError('Reversal mismatch')
    patch.apply(out / 'candidate')
    controls = []
    for label, mutation in [('double-apply', None), ('header-corruption', 'header'), ('stream-corruption', 'stream'), ('insertion-corruption', 'insertion')]:
        control = out / ('control-' + label)
        shutil.copytree(out / ('baseline' if mutation in ('header', 'stream') else 'candidate'), control, dirs_exist_ok=True)
        reverse = label == 'insertion-corruption'
        if mutation:
            target = control / ('Source/ee/Vif.cpp' if mutation == 'stream' else 'Source/ee/Vif.h')
            data = target.read_bytes()
            target.write_bytes(data.replace(b'count >= 2', b'count >= 3') if mutation == 'insertion' else data + b'\n// corruption\n')
        before = {p: p.read_bytes() for p in control.rglob('*') if p.is_file()}
        try:
            patch.apply(control, reverse=reverse)
        except ValueError:
            pass
        else:
            raise ValueError('Guard accepted: ' + label)
        if any(p.read_bytes() != data for p, data in before.items()):
            raise ValueError('Rejected guard wrote source: ' + label)
        controls.append(label)
    alias_inputs = {}
    for name in ['Source/ee/Ee_SubSystem.cpp', 'Source/ee/Vpu.cpp', 'Source/ee/Vpu.h']:
        data = (args.play / name).read_bytes()
        dest = out / 'nonalias-source' / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        alias_inputs[name] = sha(data)
    h = original.decode()
    source = (out / 'baseline/Source/ee/Vif.cpp').read_text()
    types = between(h, '\tstruct STAT :', '\tvoid ProcessFifoWrite(')
    fields = between(h, '\tuint8 m_fifoBuffer[FIFO_SIZE];', '\n};\n')
    (out / 'state.inc').write_text('struct StateTypes {\n static constexpr uint32 FIFO_SIZE = 0x100;\n' + types + '\n};\nstruct State : StateTypes {\n unsigned int m_number;\n' + fields + '\n};\n')
    (out / 'methods.inc').write_text(generate(h, source, 'Baseline') + generate(candidate.decode(), source, 'Candidate'))
    for name, original_path in [('Types.h', 'deps/Framework/include/Types.h'), ('Convertible.h', 'deps/Framework/include/Convertible.h'), ('uint128.h', 'Source/uint128.h')]:
        shutil.copyfile(out / 'baseline' / original_path, out / name)
    shutil.copyfile(FIXTURE, out / 'fixture.cpp')
    cmd = [args.compiler, '-std=c++17', '-O1' if args.sanitize else '-O2', '-DNDEBUG', '-fno-strict-aliasing', '-Wall', '-Werror', str(out / 'fixture.cpp'), '-o', str(out / 'fixture')]
    if args.sanitize:
        cmd[1:1] = ['-fsanitize=address,undefined', '-fno-omit-frame-pointer']
    compiled = subprocess.run(cmd, capture_output=True, text=True)
    (out / 'compile.log').write_text(compiled.stdout + compiled.stderr)
    compiled.check_returncode()
    run = subprocess.run([str(out / 'fixture')], capture_output=True, text=True)
    (out / 'run.log').write_text(run.stdout + run.stderr)
    run.check_returncode()
    result = json.loads(run.stdout)
    mutation_results = {}
    if args.check_mutations:
        changes = {
            'tick-update': ('(m_readTick + count) % cl', '(m_readTick + count + 1) % cl'),
            'pending-tag-bound': ('return available - (m_tagIncluded ? std::min<uint32>(available, 8) : 0);', 'return available;'),
            'mask-exclusion': ('&& !useMask && (mode == 0)', '&& (mode == 0)'),
            'mode-exclusion': ('&& !useMask && (mode == 0)', '&& !useMask && (mode <= 1)'),
        }
        for label, (old, new) in changes.items():
            mutated = candidate.decode()
            if mutated.count(old) != 1:
                raise ValueError('Mutation anchor changed: ' + label)
            directory = out / ('mutation-' + label)
            directory.mkdir(exist_ok=True)
            for name in ['fixture.cpp', 'state.inc', 'Types.h', 'Convertible.h', 'uint128.h']:
                shutil.copyfile(out / name, directory / name)
            (directory / 'methods.inc').write_text(generate(h, source, 'Baseline') + generate(mutated.replace(old, new), source, 'Candidate'))
            compilation = subprocess.run([args.compiler, '-std=c++17', '-O0', '-DNDEBUG', '-fno-strict-aliasing', str(directory / 'fixture.cpp'), '-o', str(directory / 'fixture')], capture_output=True, text=True)
            (directory / 'compile.log').write_text(compilation.stdout + compilation.stderr)
            compilation.check_returncode()
            negative = subprocess.run([str(directory / 'fixture')], capture_output=True, text=True)
            (directory / 'run.log').write_text(negative.stdout + negative.stderr)
            if negative.returncode != 1 or 'FAIL ' not in negative.stderr:
                raise ValueError('Oracle failed to reject mutation: ' + label)
            mutation_results[label] = negative.stderr.strip().splitlines()[-1]

    result.update({'sourcePin': PIN, 'inputs': inputs, 'nonaliasContext': alias_inputs, 'patchSha256': sha(PATCH.read_bytes()), 'fixtureSha256': sha(FIXTURE.read_bytes()), 'driverSha256': sha(Path(__file__).read_bytes()), 'candidateHeaderSha256': sha(candidate), 'reversal': 'byte-identical', 'semanticMutationControls': mutation_results, 'guardControls': controls, 'compiler': subprocess.check_output([args.compiler, '--version'], text=True).splitlines()[0], 'flags': cmd[1:-3], 'sanitize': args.sanitize, 'stateCoverage': 'all extracted mutable plain VIF fields (number/FIFO/registers/ticks/profiler-zone), entire VU allocation, every FIFO stream member including saved QW and unchanged pointers; VPU/INTC/reference identity via source audit' , 'scope': 'native extracted methods only; no Wasm/browser/full-core/performance qualification'})
    (out / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    if any((args.play / name).read_bytes() != (out / 'baseline' / name).read_bytes() for name in inputs):
        raise ValueError('Read-only input changed')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
