#!/usr/bin/env python3
"""Check the final VU flag-ring slot before the unchanged eight-slot scan."""
import hashlib
from pathlib import Path
import sys


def patch(root):
    path = Path(root) / 'Source/ee/VUShared.cpp'
    text = path.read_text()
    start = text.index('void VUShared::CheckFlagPipeline(')
    end = text.index('\nvoid VUShared::QueueInFlagPipeline(', start)
    original = text[start:end]
    # Exact method body check also rejects repeat application and upstream drift.
    if hashlib.sha256(original.encode()).hexdigest() != 'fa3b00bbe8588c06eba02e44f80f5e4700b1cc96d0373a327056abb74b85a331':
        raise ValueError('Pinned VU flag-ring reader changed')
    body = original[original.index('{') + 2:original.rindex('}')]
    prefix = '''#ifdef __EMSCRIPTEN__
\t// The last slot visited by the original scan wins whenever it is mature.
\t// This does not require sorted timestamps, including after a state restore.
\t// Keep CONDITION_LE: the Wasm backend uses the original signed comparison.
\tcodeGen->PushRelAddrRef(pipeInfo.timeArray);
\tcodeGen->PushRel(pipeInfo.index);
\tcodeGen->PushCst(FLAG_PIPELINE_SLOTS - 1);
\tcodeGen->Add();
\tcodeGen->PushCst(FLAG_PIPELINE_SLOTS - 1);
\tcodeGen->And();
\tcodeGen->LoadFromRefIdx();
\tcodeGen->PushRel(offsetof(CMIPS, m_State.pipeTime));
\tcodeGen->PushCst(relativePipeTime);
\tcodeGen->Add();
\tcodeGen->BeginIf(Jitter::CONDITION_LE);
\t{
\t\tcodeGen->PushRelAddrRef(pipeInfo.valueArray);
\t\tcodeGen->PushRel(pipeInfo.index);
\t\tcodeGen->PushCst(FLAG_PIPELINE_SLOTS - 1);
\t\tcodeGen->Add();
\t\tcodeGen->PushCst(FLAG_PIPELINE_SLOTS - 1);
\t\tcodeGen->And();
\t\tcodeGen->LoadFromRefIdx();
\t\tcodeGen->PullRel(pipeInfo.value);
\t}
\tcodeGen->Else();
#endif
'''
    suffix = '''#ifdef __EMSCRIPTEN__
\tcodeGen->EndIf();
#endif
'''
    replacement = original[:original.index('{') + 2] + prefix + body + suffix + '}\n'
    path.write_text(text[:start] + replacement + text[end:])


if __name__ == '__main__':
    patch(sys.argv[1])
