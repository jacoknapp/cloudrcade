#!/usr/bin/env python3
"""Scan the VU flag ring backwards and stop at the first mature entry."""
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
    reverse = '''#ifdef __EMSCRIPTEN__
\t// The original forward scan keeps the last mature entry. Search in reverse
\t// so the first match is that same entry, even for unsorted saved timestamps.
\t// Preserve signed CONDITION_LE and wrapping 32-bit time arithmetic.
\tfor(unsigned int step = 0; step < FLAG_PIPELINE_SLOTS; step++)
\t{
\t\tconst auto slot = FLAG_PIPELINE_SLOTS - 1 - step;
\t\tcodeGen->PushRelAddrRef(pipeInfo.timeArray);
\t\tcodeGen->PushRel(pipeInfo.index);
\t\tcodeGen->PushCst(slot);
\t\tcodeGen->Add();
\t\tcodeGen->PushCst(FLAG_PIPELINE_SLOTS - 1);
\t\tcodeGen->And();
\t\tcodeGen->LoadFromRefIdx();
\t\tcodeGen->PushRel(offsetof(CMIPS, m_State.pipeTime));
\t\tcodeGen->PushCst(relativePipeTime);
\t\tcodeGen->Add();
\t\tcodeGen->BeginIf(Jitter::CONDITION_LE);
\t\t{
\t\t\tcodeGen->PushRelAddrRef(pipeInfo.valueArray);
\t\t\tcodeGen->PushRel(pipeInfo.index);
\t\t\tcodeGen->PushCst(slot);
\t\t\tcodeGen->Add();
\t\t\tcodeGen->PushCst(FLAG_PIPELINE_SLOTS - 1);
\t\t\tcodeGen->And();
\t\t\tcodeGen->LoadFromRefIdx();
\t\t\tcodeGen->PullRel(pipeInfo.value);
\t\t}
\t\tif(step + 1 < FLAG_PIPELINE_SLOTS) codeGen->Else();
\t}
\tfor(unsigned int step = 0; step < FLAG_PIPELINE_SLOTS; step++)
\t{
\t\tcodeGen->EndIf();
\t}
#else
'''
    replacement = original[:original.index('{') + 2] + reverse + body + '#endif\n}\n'
    path.write_text(text[:start] + replacement + text[end:])


if __name__ == '__main__':
    patch(sys.argv[1])
