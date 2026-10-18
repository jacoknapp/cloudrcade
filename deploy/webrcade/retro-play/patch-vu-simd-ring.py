#!/usr/bin/env python3
"""Select the last mature VU flag-ring entry using two SIMD timestamp loads."""
import hashlib
from pathlib import Path
import sys


def patch(root):
    path = Path(root) / 'Source/ee/VUShared.cpp'
    text = path.read_text()
    start = text.index('void VUShared::CheckFlagPipeline(')
    end = text.index('\nvoid VUShared::QueueInFlagPipeline(', start)
    original = text[start:end]
    if hashlib.sha256(original.encode()).hexdigest() != 'fa3b00bbe8588c06eba02e44f80f5e4700b1cc96d0373a327056abb74b85a331':
        raise ValueError('Pinned VU flag-ring reader changed')
    body = original[original.index('{') + 2:original.rindex('}')]
    simd = '''#ifdef __EMSCRIPTEN__
\tstatic_assert(FLAG_PIPELINE_SLOTS == 8, "SIMD flag lookup requires eight slots.");
\t// Preserve signed comparisons and wrapping time arithmetic. Each zero lane
\t// of (time > now) marks a mature entry. The unchanged MakeSignZero helper
\t// returns these zero bits in reverse lane order in its low nibble.
\tcodeGen->PushRel(offsetof(CMIPS, m_State.pipeTime));
\tcodeGen->PushCst(relativePipeTime);
\tcodeGen->Add();
\tconst auto nowCursor = codeGen->GetTopCursor();
\tcodeGen->PushRel(pipeInfo.index);
\tcodeGen->PushCst(FLAG_PIPELINE_SLOTS - 1);
\tcodeGen->And();
\tconst auto indexCursor = codeGen->GetTopCursor();
\tfor(unsigned int block = 0; block < 2; block++)
\t{
\t\tcodeGen->MD_PushRel(pipeInfo.timeArray + block * 16);
\t\tcodeGen->PushCursor(nowCursor);
\t\tcodeGen->MD_ExpandW();
\t\tcodeGen->MD_CmpGtW();
\t\tcodeGen->MD_MakeSignZero();
\t\tcodeGen->PushCst(0x0F);
\t\tcodeGen->And();
\t\tif(block == 0) codeGen->Shl(4);
\t\telse codeGen->Or();
\t}
\tconst auto physicalMaskCursor = codeGen->GetTopCursor();
\t// Rotate the reversed physical mask left into logical scan order.
\tcodeGen->PushCursor(physicalMaskCursor);
\tcodeGen->PushCursor(indexCursor);
\tcodeGen->Shl();
\tcodeGen->PushCursor(physicalMaskCursor);
\tcodeGen->PushCst(8);
\tcodeGen->PushCursor(indexCursor);
\tcodeGen->Sub();
\tcodeGen->Srl();
\tcodeGen->Or();
\tcodeGen->PushCst(0xFF);
\tcodeGen->And();
\tconst auto logicalMaskCursor = codeGen->GetTopCursor();
\tcodeGen->PushCursor(logicalMaskCursor); // Select condition.
\tcodeGen->PushRelAddrRef(pipeInfo.valueArray);
\t// The lowest set bit is the last mature entry in forward scan order.
\t// Lzc is leading-sign-bit count: clz(x)-1 for nonnegative x.
\tcodeGen->PushCursor(logicalMaskCursor);
\tcodeGen->PushCst(0);
\tcodeGen->PushCursor(logicalMaskCursor);
\tcodeGen->Sub();
\tcodeGen->And();
\tcodeGen->Lzc();
\tcodeGen->PushCst(23);
\tcodeGen->Sub();
\tcodeGen->PushCursor(indexCursor);
\tcodeGen->Add();
\tcodeGen->PushCst(FLAG_PIPELINE_SLOTS - 1);
\tcodeGen->And();
\t// Even an empty mask produces a bounded index; Select retains the old flag.
\tcodeGen->LoadFromRefIdx();
\tcodeGen->PushRel(pipeInfo.value);
\tcodeGen->Select();
\tcodeGen->PullRel(pipeInfo.value);
\tfor(unsigned int temporary = 0; temporary < 4; temporary++) codeGen->PullTop();
#else
'''
    replacement = original[:original.index('{') + 2] + simd + body + '#endif\n}\n'
    path.write_text(text[:start] + replacement + text[end:])


if __name__ == '__main__':
    patch(sys.argv[1])
