#!/usr/bin/env python3
"""Compile verbatim pinned GS queue/lifecycle methods and the real native mailbox.

No emulator/GPU build or game data. Requires Python 3, Git and g++.
"""
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
parser.add_argument('--play', required=True, type=Path)
parser.add_argument('--output', type=Path)
parser.add_argument('--sanitize', action='store_true', help='Also check memory/undefined behavior with host ASan/UBSan')
args = parser.parse_args()
out = (args.output or Path(tempfile.mkdtemp(prefix='ps2-gs-registers-'))).resolve()
out.mkdir(parents=True, exist_ok=True)
assert subprocess.check_output(['git', '-C', str(args.play), 'rev-parse', 'HEAD'], text=True).strip() == PLAY


def original(name):
    return subprocess.check_output(['git', '-C', str(args.play), 'show', PLAY + ':' + name]).decode()


def block(text, marker):
    assert text.count(marker) == 1, marker
    start = text.index(marker)
    opening = text.index('{', start)
    depth = 1
    cursor = opening + 1
    while depth:
        if text[cursor] == '{': depth += 1
        if text[cursor] == '}': depth -= 1
        cursor += 1
    return text[start:cursor]


source = original('Source/gs/GSHandler.cpp')
header = original('Source/gs/GSHandler.h')
for variant in ['baseline', 'candidate']:
    dest = out / variant
    (dest / 'Source/gs').mkdir(parents=True, exist_ok=True)
    (dest / 'Source/gs/GSHandler.cpp').write_text(source)
    (dest / 'Source/gs/GSHandler.h').write_text(header)
    if variant == 'candidate':
        subprocess.run(['python3', str(NATIVE / 'patch-gs-registers.py'), str(dest)], check=True)
    cpp = (dest / 'Source/gs/GSHandler.cpp').read_text()
    hpp = (dest / 'Source/gs/GSHandler.h').read_text()
    normalized = cpp
    for marker in ['void CGSHandler::Reset()', 'void CGSHandler::SaveState(',
                   'void CGSHandler::LoadState(', 'void CGSHandler::Copy(', 'void CGSHandler::Flip(']:
        normalized = normalized.replace(block(cpp, marker), block(source, marker))
    assert normalized == source, 'GS changes escaped reviewed lifecycle methods'
    assert hpp in [header, header.replace('REGISTERWRITEBUFFER_SUBMIT_THRESHOLD = 0x100',
                                         'REGISTERWRITEBUFFER_SUBMIT_THRESHOLD = 0x400')], 'Unexpected GS header change'
    methods = [
        'void CGSHandler::Reset()', 'void CGSHandler::ResetBase()',
        'void CGSHandler::SaveState(', 'void CGSHandler::LoadState(', 'void CGSHandler::Copy(',
        'void CGSHandler::SetVBlank()', 'void CGSHandler::ResetVBlank()',
        'void CGSHandler::Finish(', 'void CGSHandler::Flip(',
        'void CGSHandler::FeedImageData(', 'void CGSHandler::ReadImageData(',
        'void CGSHandler::ProcessWriteBuffer(', 'void CGSHandler::SubmitWriteBuffer()',
        'void CGSHandler::FlushWriteBuffer()', 'void CGSHandler::SubmitWriteBufferImpl(',
        'void CGSHandler::ThreadProc()',
        'void CGSHandler::SendGSCall(const CMailBox::FunctionType&',
        'void CGSHandler::SendGSCall(CMailBox::FunctionType&&',
    ]
    for marker in ['void CGSHandler::ProcessWriteBuffer(', 'void CGSHandler::Finish(',
                   'void CGSHandler::FlushWriteBuffer()', 'void CGSHandler::FeedImageData(',
                   'void CGSHandler::ReadImageData(', 'void CGSHandler::SubmitWriteBufferImpl(']:
        assert block(source, marker) == block(cpp, marker), 'Unexpected ordering/event change: ' + marker
    (dest / 'methods.inc').write_text('\n\n'.join(block(cpp, m) for m in methods) + '\n')
    enums = block(hpp, 'enum GS_REGS') + ';\n'
    (dest / 'registers.inc').write_text(enums)
    defs = '\n'.join(line for line in cpp.splitlines() if line.startswith('#define STATE_'))
    (dest / 'state-names.inc').write_text(defs + '\n#define GS_REVISION (7)\n')
    types = [block(hpp, 'enum RAMSIZE'), block(hpp, 'enum CLUTSIZE'),
             block(hpp, 'enum PRIVATE_REGISTER'), block(hpp, 'enum REGISTER_MAX'),
             block(hpp, 'enum CRT_MODE'), block(hpp, 'struct DELAYED_REGISTER'),
             block(hpp, 'struct SIGNAL :'), block(hpp, 'struct LABEL :'),
             block(hpp, 'struct SIGLBLID :'), block(hpp, 'struct TRXCONTEXT')]
    # Anonymous CSR and register-buffer enums have no unique named marker.
    for symbol in ['CSR_SIGNAL_EVENT =', 'REGISTERWRITEBUFFER_SIZE =']:
        at = hpp.index(symbol)
        begin = hpp.rfind('enum', 0, at)
        opening = hpp.index('{', begin)
        closing = hpp.index('}', opening)
        types.append(hpp[begin:closing + 1])
    (dest / 'types.inc').write_text('\n'.join(t + ';' for t in types) + '\n')
    # The inline producer operation also comes from the real class body.
    (dest / 'write.inc').write_text(block(hpp, 'inline void WriteRegister(') + '\n')
    for name in ['MailBox.h', 'MailBox.cpp', 'Integer64.h']:
        (dest / name).write_text(original('Source/' + name))
    framework = args.play / 'deps/Framework'
    framework_pin = subprocess.check_output(['git', '-C', str(args.play), 'ls-tree', PLAY, 'deps/Framework'], text=True).split()[2]
    assert subprocess.check_output(['git', '-C', str(framework), 'rev-parse', 'HEAD'], text=True).strip() == framework_pin
    for name in ['Convertible.h', 'Types.h']:
        (dest / name).write_bytes(subprocess.check_output(['git', '-C', str(framework), 'show', framework_pin + ':include/' + name]))
    shutil.copyfile(ROOT / 'tests/fixtures/ps2-gs-registers/fixture.cpp', dest / 'fixture.cpp')
    sanitizer = ['-O1', '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer'] if args.sanitize else []
    subprocess.run(['g++', '-std=c++17', '-O2', *sanitizer, '-pthread', '-Wall', '-Wextra', '-Werror',
                    '-Wno-class-memaccess', '-Wno-unused-parameter', '-fno-strict-aliasing', '-I', str(dest),
                    str(dest / 'fixture.cpp'), str(dest / 'MailBox.cpp'), '-o', str(dest / 'fixture')], check=True)
    subprocess.run([str(dest / 'fixture'), variant], check=True, timeout=40)
    if variant == 'baseline':
        failure = subprocess.run([str(dest / 'fixture'), 'candidate'], capture_output=True, text=True, timeout=40)
        assert failure.returncode == 1 and failure.stderr.strip() == 'save tail control', failure
        print('PASS unpatched baseline fails fixed-state invariant: save tail control', flush=True)
    print(variant, 'GS source sha256', hashlib.sha256(cpp.encode()).hexdigest(), flush=True)
print('PASS verbatim pinned GS lifecycle/queue methods, real mailbox, baseline failure controls and source contracts; artifacts:', out)
