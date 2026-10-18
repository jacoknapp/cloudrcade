#!/usr/bin/env python3
"""Prove ranges with pinned real GS swizzles/readers; compile snapshot API mocks."""
import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / 'deploy/webrcade/retro-play'
PLAY = 'd44bfa1814b729d4a3ed3c6c3a945432d5ee5bbe'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--play', type=Path, required=True)
parser.add_argument('--output', type=Path)
parser.add_argument('--sanitize', action='store_true')
args = parser.parse_args()
out = (args.output or Path(tempfile.mkdtemp(prefix='ps2-readback-'))).resolve()
out.mkdir(parents=True, exist_ok=True)
assert subprocess.check_output(['git', '-C', str(args.play), 'rev-parse', 'HEAD'], text=True).strip() == PLAY


def original(name):
    return subprocess.check_output(['git', '-C', str(args.play), 'show', PLAY + ':' + name]).decode()


def body(source, marker):
    assert source.count(marker) == 1, marker
    start = source.index(marker)
    end = source.index('{', start) + 1
    depth = 1
    while depth:
        if source[end] == '{': depth += 1
        if source[end] == '}': depth -= 1
        end += 1
    return source[start:end]


for name in ['Source/gs/GSHandler.h', 'Source/gs/GSHandler.cpp', 'Source/gs/GsPixelFormats.h', 'Source/gs/GsPixelFormats.cpp',
             'Source/MailBox.h', 'Source/MailBox.cpp', 'Source/Integer64.h']:
    dest = out / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(original(name))
source = original('Source/gs/GSHandler.cpp')
subprocess.run(['python3', str(NATIVE / 'patch-gs-registers.py'), str(out)], check=True)
corrected = (out / 'Source/gs/GSHandler.cpp').read_text()
(out / 'state-names.inc').write_text('\n'.join(line for line in source.splitlines() if line.startswith('#define STATE_'))+'\n')
readers = []
for name in ['template <typename Storage>\nvoid CGSHandler::TransferReadHandlerGeneric(',
             'template <typename Storage>\nvoid CGSHandler::TransferReadHandler24(',
             'void CGSHandler::TransferReadHandlerPSMT8H(', 'void CGSHandler::ReadImageDataImpl(']:
    # Only the class qualification changes; every function body compiles verbatim.
    readers.append(body(source, name).replace('CGSHandler::TransferReadHandler', 'Reader::TransferReadHandler')
                   .replace('CGSHandler::ReadImageDataImpl', 'Reader::ReadImageDataImpl'))
(out / 'readers.inc').write_text('\n'.join(readers) + '\n')
methods = ['void CGSHandler::Copy(', 'void CGSHandler::InitFromFrameDump(', 'void CGSHandler::LoadState(',
           'void CGSHandler::ThreadProc()', 'void CGSHandler::SendGSCall(const CMailBox::FunctionType&',
           'void CGSHandler::SendGSCall(CMailBox::FunctionType&&']
(out / 'native-methods.inc').write_text('\n'.join(body(corrected, marker) for marker in methods) + '\n')
frontend = (NATIVE / 'native/GSH_WebGPU.h').read_text()
(out / 'cache-overrides.inc').write_text('\n'.join(body(frontend, marker) for marker in
    ['void SyncMemoryCache() override', 'void WriteBackMemoryCache() override',
     'void LoadState(Framework::CZipArchiveReader& archive) override']) + '\n')
shutil.copyfile(NATIVE / 'native/CloudReadbackRange.h', out / 'CloudReadbackRange.h')
shutil.copyfile(NATIVE / 'gpu/snapshot-readback.inc', out / 'snapshot-readback.inc')
(out / 'reset.inc').write_text(body((NATIVE / 'gpu/bridge.cpp').read_text(), 'EMSCRIPTEN_KEEPALIVE void gpu_reset()') + '\n')
fixtures = ROOT / 'tests/fixtures/ps2-readback'
framework = args.play / 'deps/Framework'
framework_pin = subprocess.check_output(['git', '-C', str(args.play), 'ls-tree', PLAY, 'deps/Framework'], text=True).split()[2]
assert subprocess.check_output(['git', '-C', str(framework), 'rev-parse', 'HEAD'], text=True).strip() == framework_pin
flags = ['-std=c++17', '-O2', '-DNDEBUG', '-pthread', '-Wall', '-Wextra', '-Werror',
         '-Wno-unused-parameter', '-fno-strict-aliasing', '-I', str(out),
         '-I', str(out / 'Source/gs'), '-I', str(framework / 'include')]
if args.sanitize: flags += ['-O1', '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer']
for name, extra in [('reader', [str(out / 'Source/gs/GsPixelFormats.cpp')]), ('snapshot', []),
                    ('native', [str(out / 'Source/MailBox.cpp')])]:
    subprocess.run(['g++', *flags, str(fixtures / (name + '.cpp')), *extra, '-o', str(out / name)], check=True)
    subprocess.run([str(out / name)], check=True, timeout=90)
subprocess.run(['node', str(fixtures / 'bridge.cjs'), str(NATIVE / 'app/gpu.mjs')], check=True)

# Corresponding-source/ABI contracts: existing readback and state bytes stay intact.
header = (out / 'Source/gs/GSHandler.h').read_text()
subprocess.run(['python3', str(NATIVE / 'patch-gs-readback.py'), str(out)], check=True)
assert (out / 'Source/gs/GSHandler.h').read_text() == header.replace('\tvoid ReadImageDataImpl(void*, uint32);', '\tvirtual void ReadImageDataImpl(void*, uint32);')
assert 'Flush(); Queue(9,nullptr,0); Submit(); Call(7,nullptr,0,m_pRAM);' in frontend
assert 'Call(5,gpuState.data(),gpuState.size()); Call(10,m_pRAM,4*1024*1024);' in frontend
bridge = (NATIVE / 'gpu/bridge.cpp').read_text()
assert 'void gpu_download(std::uint8_t* target) { gpu::download(target); }' in bridge
for name, expected in [
    ('EMSCRIPTEN_KEEPALIVE const std::uint8_t* gpu_save()', '1c76504bfe6f63082d51806d2af0e7a0d7e29e6a7dd1659e8894ee6cd608f749'),
    ('EMSCRIPTEN_KEEPALIVE void gpu_load(', 'e6fe4c824d45e69a5c70e2da047803f08647427bd62692fa71f65b5b3c323346')]:
    assert hashlib.sha256(body(bridge, name).encode()).hexdigest() == expected, 'Serialized GPU state changed'
print('PASS pinned reader/range, snapshot transport and unchanged full-readback/state contracts;', out)
