#!/usr/bin/env python3
"""Use a dedicated Wasm lane-sign mask for exact VU flag-ring lookup.

All original input hashes are checked before any write. Native readers and
other backend emitters retain their original implementation; MakeSz is untouched.
"""
import hashlib
from pathlib import Path
import sys

PINS = {'Source/ee/VUShared.cpp': 'c27335f4258e2863a5631d53275bc8de2d66b9d70c4ec073e17e8bb94643b868',
 'deps/CodeGen/include/Jitter_Statement.h': '7cc9308d4b50ed395c0fb519f5d434428e259e7bb4c6121968e49480c82e9ba0',
 'deps/CodeGen/include/Jitter.h': '3fd4700a8039306eece2801f0439dfb7b9a57f874b69d8af6cea8de6afff0a00',
 'deps/CodeGen/src/Jitter.cpp': 'b13118e645c07304ccbcb6dd7937af7493fa9e4fbfed486636fa82c21d7f5494',
 'deps/CodeGen/include/WasmDefs.h': '782b8f2f8feadc9f17f5a09457f2485bb7cd5f830b127a9a920832c87fd1d761',
 'deps/CodeGen/src/Jitter_CodeGen_Wasm_Md.cpp': '2b95f7cea0ba4537c92424e1f495f9bbd35d1a18049dc188e12130592e4071f1',
 'deps/CodeGen/src/Jitter_Statement.cpp': 'af3b1a96121f9a1bfb7ad01dc2b9766fc3df481989e7f21c9f138a7677ee533b'}
CHANGES = {'deps/CodeGen/include/Jitter_Statement.h': ('\t\tOP_LABEL,\n',
                                             '\t\tOP_LABEL,\n'
                                             '\t\tOP_MD_BITMASK_W, // Appended to preserve '
                                             'existing operation numbers.\n'),
 'deps/CodeGen/include/Jitter.h': ('\t\tvoid MD_MakeSignZero();\n',
                                   '\t\tvoid MD_MakeSignZero();\n'
                                   '#ifdef __EMSCRIPTEN__\n'
                                   '\t\t// Wasm-only: scalar bit i is the sign bit of 32-bit '
                                   'vector lane i.\n'
                                   '\t\tvoid MD_BitmaskW();\n'
                                   '#endif\n'),
 'deps/CodeGen/src/Jitter.cpp': ('void CJitter::MD_ToInt32TruncateS()',
                                 '#ifdef __EMSCRIPTEN__\n'
                                 'void CJitter::MD_BitmaskW()\n'
                                 '{\n'
                                 '\tInsertUnaryStatement(OP_MD_BITMASK_W);\n'
                                 '}\n'
                                 '#endif\n'
                                 '\n'
                                 'void CJitter::MD_ToInt32TruncateS()'),
 'deps/CodeGen/include/WasmDefs.h': ('\t\tINST_I32x4_SHL = 0xAB,',
                                     '\t\tINST_I32x4_BITMASK = 0xA4,\n\t\tINST_I32x4_SHL = 0xAB,'),
 'deps/CodeGen/src/Jitter_CodeGen_Wasm_Md.cpp': ('\t{ OP_MD_MAKESZ,',
                                                 '\t{ OP_MD_BITMASK_W,  MATCH_MEMORY,         '
                                                 'MATCH_MEMORY128,      MATCH_NIL,           '
                                                 'MATCH_NIL,      '
                                                 '&CCodeGen_Wasm::Emit_Md_MemMem<Wasm::INST_I32x4_BITMASK>       '
                                                 '},\n'
                                                 '\t{ OP_MD_MAKESZ,'),
 'deps/CodeGen/src/Jitter_Statement.cpp': ('\t\tcase OP_MD_MAKESZ:',
                                           '\t\tcase OP_MD_BITMASK_W:\n'
                                           '\t\t\toutputStream << " BITMASK(W)";\n'
                                           '\t\t\tbreak;\n'
                                           '\t\tcase OP_MD_MAKESZ:')}


def patch(root):
    root = Path(root)
    originals = {name: (root / name).read_text() for name in PINS}
    for name, expected in PINS.items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
            raise ValueError('Pinned bitmask input changed: ' + name)
    outputs = {}
    for name, (before, after) in CHANGES.items():
        if originals[name].count(before) != 1:
            raise ValueError('Expected unique bitmask patch anchor: ' + name)
        outputs[name] = originals[name].replace(before, after)
    name = 'Source/ee/VUShared.cpp'
    text = originals[name]
    start = text.index('void VUShared::CheckFlagPipeline(')
    end = text.index('\nvoid VUShared::QueueInFlagPipeline(', start)
    original = text[start:end]
    if hashlib.sha256(original.encode()).hexdigest() != 'fa3b00bbe8588c06eba02e44f80f5e4700b1cc96d0373a327056abb74b85a331':
        raise ValueError('Pinned VU flag-ring reader changed')
    body = original[original.index('{') + 2:original.rindex('}')]
    bitmask = '''#ifdef __EMSCRIPTEN__
\tstatic_assert(FLAG_PIPELINE_SLOTS == 8, "Bitmask flag lookup requires eight slots.");
\t// Signed comparisons retain wrapping time arithmetic. Bitmask maps lane i
\t// to bit i, so inverted future bits identify mature physical slots.
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
\t\tcodeGen->MD_BitmaskW();
\t\tif(block == 1)
\t\t{
\t\t\tcodeGen->Shl(4);
\t\t\tcodeGen->Or();
\t\t}
\t}
\tcodeGen->PushCst(0xFF);
\tcodeGen->Xor();
\tconst auto physicalMaskCursor = codeGen->GetTopCursor();
\t// Rotate the physical mask right into forward logical scan order.
\tcodeGen->PushCursor(physicalMaskCursor);
\tcodeGen->PushCursor(indexCursor);
\tcodeGen->Srl();
\tcodeGen->PushCursor(physicalMaskCursor);
\tcodeGen->PushCst(8);
\tcodeGen->PushCursor(indexCursor);
\tcodeGen->Sub();
\tcodeGen->Shl();
\tcodeGen->Or();
\tcodeGen->PushCst(0xFF);
\tcodeGen->And();
\tconst auto logicalMaskCursor = codeGen->GetTopCursor();
\tcodeGen->PushCursor(logicalMaskCursor); // Select condition.
\tcodeGen->PushRelAddrRef(pipeInfo.valueArray);
\t// The highest logical bit is the last mature entry in forward scan order.
\t// Lzc is leading-sign-bit count: clz(x)-1 for nonnegative x.
\tcodeGen->PushCst(30);
\tcodeGen->PushCursor(logicalMaskCursor);
\tcodeGen->Lzc();
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
    replacement = original[:original.index('{') + 2] + bitmask + body + '#endif\n}\n'
    outputs[name] = text[:start] + replacement + text[end:]
    for name, text in outputs.items():
        (root / name).write_text(text)


if __name__ == '__main__':
    patch(sys.argv[1])
