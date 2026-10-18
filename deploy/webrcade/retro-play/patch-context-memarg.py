#!/usr/bin/env python3
"""Fold bounded CMIPS context accesses into Wasm memargs; generic default unchanged.

All source hashes and replacement anchors are checked before any file is written.
Only CMipsJitter opts in to the valid-whole-context-object contract. No guest
reference/address formation, interpreter timing, or other backend is changed.
"""
import hashlib
from pathlib import Path
import sys

PINS = {'deps/CodeGen/include/Jitter_CodeGen.h': '23e63f6fca9facb574ca0e3043dcde0c78aec06365433d8c4485495c022e70e2',
 'deps/CodeGen/include/Jitter_CodeGen_Wasm.h': 'd61cbfd7c4f213f09b21050453a9e21ca9c8e1afb54dd86e1a21fd33a1a89159',
 'deps/CodeGen/src/Jitter_CodeGen_Wasm.cpp': '94b3926c7e852569c31d0c6f7c6db08aceedfcad938356a4f08eda9079aba65a',
 'deps/CodeGen/src/Jitter_CodeGen_Wasm_64.cpp': '58d640719c9053b6e543ea8d4fabb91345a79683922aa9534469bb9fe4f3c025',
 'deps/CodeGen/src/Jitter_CodeGen_Wasm_Fpu.cpp': 'b1b6df0f94eee8ad44927bb0ed2f0bb203a07581df5d90a4333740ce868bcf7d',
 'deps/CodeGen/src/Jitter_CodeGen_Wasm_Md.cpp': '2b95f7cea0ba4537c92424e1f495f9bbd35d1a18049dc188e12130592e4071f1',
 'Source/MipsJitter.cpp': '23dccca86dc7e36012a466d411adcf354f9bf743e9c6c787644dbfb2a3bf595e'}

CHANGES = [
    ('deps/CodeGen/include/Jitter_CodeGen.h',
     '\t\tvirtual uint32 GetPointerSize() const = 0;',
     '\t\tvirtual uint32 GetPointerSize() const = 0;\n\n\t\t// Opt in only when every invocation receives a valid object of this size.\n\t\t// Zero retains generic context-pointer arithmetic. Other backends ignore it.\n\t\tvirtual void SetValidContextSize(uint32) {}'),
    ('deps/CodeGen/include/Jitter_CodeGen_Wasm.h',
     '\t\tuint32 GetPointerSize() const override;',
     '\t\tuint32 GetPointerSize() const override;\n\t\tvoid SetValidContextSize(uint32 size) override { m_validContextSize = size; }'),
    ('deps/CodeGen/include/Jitter_CodeGen_Wasm.h',
     '\t\tvoid PushRelativeAddress(CSymbol*);',
     '\t\tbool CanUseContextMemarg(CSymbol*, uint32 width) const;\n\t\tvoid PushRelativeMemoryBase(CSymbol*, uint32 width);\n\t\tvoid WriteRelativeMemoryOffset(CSymbol*, uint32 width);\n\t\tvoid PushRelativeAddress(CSymbol*);'),
    ('deps/CodeGen/include/Jitter_CodeGen_Wasm.h',
     '\t\tParamStack m_params;',
     '\t\tParamStack m_params;\n\t\tuint32 m_validContextSize = 0;'),
    ('deps/CodeGen/src/Jitter_CodeGen_Wasm.cpp',
     'void CCodeGen_Wasm::PushRelativeAddress(CSymbol* symbol)',
     'bool CCodeGen_Wasm::CanUseContextMemarg(CSymbol* symbol, uint32 width) const\n{\n\t// Memarg addition does not wrap like i32.add. A valid whole context object\n\t// makes the two equivalent only for nonnegative, fully contained accesses.\n\tconst uint32 offset = symbol->m_valueLow;\n\treturn (offset <= 0x7FFFFFFF) && (width != 0) &&\n\t       (width <= m_validContextSize) && (offset <= (m_validContextSize - width));\n}\n\nvoid CCodeGen_Wasm::PushRelativeMemoryBase(CSymbol* symbol, uint32 width)\n{\n\tif(CanUseContextMemarg(symbol, width))\n\t{\n\t\tPushContext();\n\t}\n\telse if(symbol->m_type == SYM_REL_REFERENCE)\n\t{\n\t\tPushRelativeRefAddress(symbol);\n\t}\n\telse\n\t{\n\t\tPushRelativeAddress(symbol);\n\t}\n}\n\nvoid CCodeGen_Wasm::WriteRelativeMemoryOffset(CSymbol* symbol, uint32 width)\n{\n\tCWasmModuleBuilder::WriteULeb128(m_functionStream,\n\t    CanUseContextMemarg(symbol, width) ? symbol->m_valueLow : 0);\n}\n\nvoid CCodeGen_Wasm::PushRelativeAddress(CSymbol* symbol)'),
    ('deps/CodeGen/src/Jitter_CodeGen_Wasm.cpp',
     'void CCodeGen_Wasm::PushRelative(CSymbol* symbol)\n{\n\tPushRelativeAddress(symbol);\n\n\tm_functionStream.Write8(Wasm::INST_I32_LOAD);\n\tm_functionStream.Write8(0x02);\n\tm_functionStream.Write8(0x00);\n}',
     'void CCodeGen_Wasm::PushRelative(CSymbol* symbol)\n{\n\tPushRelativeMemoryBase(symbol, 4);\n\n\tm_functionStream.Write8(Wasm::INST_I32_LOAD);\n\tm_functionStream.Write8(0x02);\n\tWriteRelativeMemoryOffset(symbol, 4);\n}'),
    ('deps/CodeGen/src/Jitter_CodeGen_Wasm.cpp',
     'void CCodeGen_Wasm::PushRelativeRef(CSymbol* symbol)\n{\n\tPushRelativeRefAddress(symbol);\n\n\tm_functionStream.Write8(Wasm::INST_I32_LOAD);\n\tm_functionStream.Write8(0x02);\n\tm_functionStream.Write8(0x00);\n}',
     'void CCodeGen_Wasm::PushRelativeRef(CSymbol* symbol)\n{\n\tPushRelativeMemoryBase(symbol, 4);\n\n\tm_functionStream.Write8(Wasm::INST_I32_LOAD);\n\tm_functionStream.Write8(0x02);\n\tWriteRelativeMemoryOffset(symbol, 4);\n}'),
    ('deps/CodeGen/src/Jitter_CodeGen_Wasm_64.cpp',
     'void CCodeGen_Wasm::PushRelative64(CSymbol* symbol)\n{\n\tPushRelativeAddress(symbol);\n\n\tm_functionStream.Write8(Wasm::INST_I64_LOAD);\n\tm_functionStream.Write8(0x03);\n\tm_functionStream.Write8(0x00);\n}',
     'void CCodeGen_Wasm::PushRelative64(CSymbol* symbol)\n{\n\tPushRelativeMemoryBase(symbol, 8);\n\n\tm_functionStream.Write8(Wasm::INST_I64_LOAD);\n\tm_functionStream.Write8(0x03);\n\tWriteRelativeMemoryOffset(symbol, 8);\n}'),
    ('deps/CodeGen/src/Jitter_CodeGen_Wasm_Fpu.cpp',
     'void CCodeGen_Wasm::PushRelativeFp32(CSymbol* symbol)\n{\n\tPushRelativeAddress(symbol);\n\n\tm_functionStream.Write8(Wasm::INST_F32_LOAD);\n\tm_functionStream.Write8(0x02);\n\tm_functionStream.Write8(0x00);\n}',
     'void CCodeGen_Wasm::PushRelativeFp32(CSymbol* symbol)\n{\n\tPushRelativeMemoryBase(symbol, 4);\n\n\tm_functionStream.Write8(Wasm::INST_F32_LOAD);\n\tm_functionStream.Write8(0x02);\n\tWriteRelativeMemoryOffset(symbol, 4);\n}'),
    ('deps/CodeGen/src/Jitter_CodeGen_Wasm_Md.cpp',
     'void CCodeGen_Wasm::PushRelative128(CSymbol* symbol)\n{\n\tPushRelativeAddress(symbol);\n\n\tm_functionStream.Write8(Wasm::INST_PREFIX_SIMD);\n\tm_functionStream.Write8(Wasm::INST_V128_LOAD);\n\tm_functionStream.Write8(0x04);\n\tm_functionStream.Write8(0x00);\n}',
     'void CCodeGen_Wasm::PushRelative128(CSymbol* symbol)\n{\n\tPushRelativeMemoryBase(symbol, 16);\n\n\tm_functionStream.Write8(Wasm::INST_PREFIX_SIMD);\n\tm_functionStream.Write8(Wasm::INST_V128_LOAD);\n\tm_functionStream.Write8(0x04);\n\tWriteRelativeMemoryOffset(symbol, 16);\n}'),
    ('deps/CodeGen/src/Jitter_CodeGen_Wasm.cpp',
     '\tcase SYM_RELATIVE:\n\tcase SYM_RELATIVE64:\n\tcase SYM_RELATIVE128:\n\tcase SYM_FP_RELATIVE32:\n\t\tPushRelativeAddress(symbol);',
     '\tcase SYM_RELATIVE:\n\tcase SYM_FP_RELATIVE32:\n\t\tPushRelativeMemoryBase(symbol, 4);\n\t\tbreak;\n\tcase SYM_RELATIVE64:\n\t\tPushRelativeMemoryBase(symbol, 8);\n\t\tbreak;\n\tcase SYM_RELATIVE128:\n\t\tPushRelativeMemoryBase(symbol, 16);'),
    ('deps/CodeGen/src/Jitter_CodeGen_Wasm.cpp',
     'void CCodeGen_Wasm::CommitSymbol(CSymbol* symbol)\n{\n\tswitch(symbol->m_type)\n\t{\n\tcase SYM_RELATIVE:\n\t\tm_functionStream.Write8(Wasm::INST_I32_STORE);\n\t\tm_functionStream.Write8(0x02);\n\t\tm_functionStream.Write8(0x00);\n\t\tbreak;\n\tcase SYM_TEMPORARY:\n\t\tPullTemporary(symbol);\n\t\tbreak;\n\tcase SYM_TMP_REFERENCE:\n\t\tPullTemporaryRef(symbol);\n\t\tbreak;\n\tcase SYM_RELATIVE64:\n\t\tm_functionStream.Write8(Wasm::INST_I64_STORE);\n\t\tm_functionStream.Write8(0x03);\n\t\tm_functionStream.Write8(0x00);\n\t\tbreak;\n\tcase SYM_TEMPORARY64:\n\t\tPullTemporary64(symbol);\n\t\tbreak;\n\tcase SYM_FP_RELATIVE32:\n\t\tm_functionStream.Write8(Wasm::INST_F32_STORE);\n\t\tm_functionStream.Write8(0x02);\n\t\tm_functionStream.Write8(0x00);\n\t\tbreak;\n\tcase SYM_FP_TEMPORARY32:\n\t\tPullTemporaryFp32(symbol);\n\t\tbreak;\n\tcase SYM_RELATIVE128:\n\t\tm_functionStream.Write8(Wasm::INST_PREFIX_SIMD);\n\t\tm_functionStream.Write8(Wasm::INST_V128_STORE);\n\t\tm_functionStream.Write8(0x04);\n\t\tm_functionStream.Write8(0x00);\n\t\tbreak;\n\tcase SYM_TEMPORARY128:\n\t\tPullTemporary128(symbol);\n\t\tbreak;\n\tdefault:\n\t\tassert(false);\n\t\tbreak;\n\t}\n}',
     'void CCodeGen_Wasm::CommitSymbol(CSymbol* symbol)\n{\n\tswitch(symbol->m_type)\n\t{\n\tcase SYM_RELATIVE:\n\t\tm_functionStream.Write8(Wasm::INST_I32_STORE);\n\t\tm_functionStream.Write8(0x02);\n\t\tWriteRelativeMemoryOffset(symbol, 4);\n\t\tbreak;\n\tcase SYM_TEMPORARY:\n\t\tPullTemporary(symbol);\n\t\tbreak;\n\tcase SYM_TMP_REFERENCE:\n\t\tPullTemporaryRef(symbol);\n\t\tbreak;\n\tcase SYM_RELATIVE64:\n\t\tm_functionStream.Write8(Wasm::INST_I64_STORE);\n\t\tm_functionStream.Write8(0x03);\n\t\tWriteRelativeMemoryOffset(symbol, 8);\n\t\tbreak;\n\tcase SYM_TEMPORARY64:\n\t\tPullTemporary64(symbol);\n\t\tbreak;\n\tcase SYM_FP_RELATIVE32:\n\t\tm_functionStream.Write8(Wasm::INST_F32_STORE);\n\t\tm_functionStream.Write8(0x02);\n\t\tWriteRelativeMemoryOffset(symbol, 4);\n\t\tbreak;\n\tcase SYM_FP_TEMPORARY32:\n\t\tPullTemporaryFp32(symbol);\n\t\tbreak;\n\tcase SYM_RELATIVE128:\n\t\tm_functionStream.Write8(Wasm::INST_PREFIX_SIMD);\n\t\tm_functionStream.Write8(Wasm::INST_V128_STORE);\n\t\tm_functionStream.Write8(0x04);\n\t\tWriteRelativeMemoryOffset(symbol, 16);\n\t\tbreak;\n\tcase SYM_TEMPORARY128:\n\t\tPullTemporary128(symbol);\n\t\tbreak;\n\tdefault:\n\t\tassert(false);\n\t\tbreak;\n\t}\n}'),
    ('deps/CodeGen/src/Jitter_CodeGen_Wasm_Fpu.cpp',
     "void CCodeGen_Wasm::Emit_Fp_ToSingleI32_MemMem(const STATEMENT& statement)\n{\n\tauto dst = statement.dst->GetSymbol().get();\n\tauto src1 = statement.src1->GetSymbol().get();\n\n\tassert(src1->m_type == SYM_FP_RELATIVE32);\n\n\tPrepareSymbolDef(dst);\n\n\t//Can't use PrepareSymbolUse here because src1 is a f32 and we need an i32\n\tPushRelativeAddress(src1);\n\tm_functionStream.Write8(Wasm::INST_I32_LOAD);\n\tm_functionStream.Write8(0x02);\n\tm_functionStream.Write8(0x00);\n\n\tm_functionStream.Write8(Wasm::INST_F32_CONVERT_I32_S);\n\n\tCommitSymbol(dst);\n}",
     "void CCodeGen_Wasm::Emit_Fp_ToSingleI32_MemMem(const STATEMENT& statement)\n{\n\tauto dst = statement.dst->GetSymbol().get();\n\tauto src1 = statement.src1->GetSymbol().get();\n\n\tassert(src1->m_type == SYM_FP_RELATIVE32);\n\n\tPrepareSymbolDef(dst);\n\n\t//Can't use PrepareSymbolUse here because src1 is a f32 and we need an i32\n\tPushRelativeMemoryBase(src1, 4);\n\tm_functionStream.Write8(Wasm::INST_I32_LOAD);\n\tm_functionStream.Write8(0x02);\n\tWriteRelativeMemoryOffset(src1, 4);\n\n\tm_functionStream.Write8(Wasm::INST_F32_CONVERT_I32_S);\n\n\tCommitSymbol(dst);\n}"),
    ('deps/CodeGen/src/Jitter_CodeGen_Wasm_Fpu.cpp',
     "void CCodeGen_Wasm::Emit_Fp_ToInt32TruncS_MemMem(const STATEMENT& statement)\n{\n\tauto dst = statement.dst->GetSymbol().get();\n\tauto src1 = statement.src1->GetSymbol().get();\n\n\tassert(dst->m_type == SYM_FP_RELATIVE32);\n\n\tPrepareSymbolDef(dst);\n\tPrepareSymbolUse(src1);\n\n\tm_functionStream.Write8(Wasm::INST_PREFIX_FC);\n\tm_functionStream.Write8(Wasm::INST_I32_TRUNC_SAT_F32_S);\n\n\t//Can't use CommitSymbol here since we got a i32 on the stack and our dst symbol is a f32.\n\tm_functionStream.Write8(Wasm::INST_I32_STORE);\n\tm_functionStream.Write8(0x02);\n\tm_functionStream.Write8(0x00);\n}",
     "void CCodeGen_Wasm::Emit_Fp_ToInt32TruncS_MemMem(const STATEMENT& statement)\n{\n\tauto dst = statement.dst->GetSymbol().get();\n\tauto src1 = statement.src1->GetSymbol().get();\n\n\tassert(dst->m_type == SYM_FP_RELATIVE32);\n\n\tPrepareSymbolDef(dst);\n\tPrepareSymbolUse(src1);\n\n\tm_functionStream.Write8(Wasm::INST_PREFIX_FC);\n\tm_functionStream.Write8(Wasm::INST_I32_TRUNC_SAT_F32_S);\n\n\t//Can't use CommitSymbol here since we got a i32 on the stack and our dst symbol is a f32.\n\tm_functionStream.Write8(Wasm::INST_I32_STORE);\n\tm_functionStream.Write8(0x02);\n\tWriteRelativeMemoryOffset(dst, 4);\n}"),
    ('Source/MipsJitter.cpp',
     '    , m_lastBlockLabel(-1)\n{\n',
     '    , m_lastBlockLabel(-1)\n{\n\t// Basic blocks invoke generated code with a valid, complete CMIPS object.\n\t// Guest pointer fields retain their independent wrapping/address semantics.\n\tcodeGen->SetValidContextSize(sizeof(CMIPS));\n'),
]

def patch(root):
    root = Path(root)
    originals = {name: (root / name).read_bytes() for name in PINS}
    for name, expected in PINS.items():
        if hashlib.sha256(originals[name]).hexdigest() != expected:
            raise ValueError('Unexpected original source: ' + name)
    outputs = {name: data.decode() for name, data in originals.items()}
    for name, old, new in CHANGES:
        if outputs[name].count(old) != 1:
            raise ValueError('Unexpected source anchor: ' + name)
        outputs[name] = outputs[name].replace(old, new, 1)
    for name, text in outputs.items():
        (root / name).write_bytes(text.encode())

if __name__ == '__main__':
    patch(sys.argv[1])
