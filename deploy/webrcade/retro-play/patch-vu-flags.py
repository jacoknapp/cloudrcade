#!/usr/bin/env python3
"""Remove a redundant Wasm SIMD shift from VU sign/zero flag extraction."""
from pathlib import Path
import sys


def patch(root):
    path = Path(root) / 'deps/CodeGen/src/Jitter_CodeGen_Wasm_Md.cpp'
    text = path.read_text()
    start = text.index('void CCodeGen_Wasm::Emit_Md_MakeSz_MemMem(')
    end = text.index('\nvoid CCodeGen_Wasm::', start + 1)
    body = text[start:end]
    old_pattern = '0x0E, 0x0C, 0x0A, 0x08, 0x06, 0x04, 0x02, 0x00,'
    old_sign = '''\t//Compute sign
\t{
\t\tPrepareSymbolUse(src1);

\t\tm_functionStream.Write8(Wasm::INST_I32_CONST);
\t\tm_functionStream.Write8(31);

\t\tm_functionStream.Write8(Wasm::INST_PREFIX_SIMD);
\t\tCWasmModuleBuilder::WriteULeb128(m_functionStream, Wasm::INST_I32x4_SHR_S);
\t}'''
    if body.count(old_pattern) != 1 or body.count(old_sign) != 1:
        raise ValueError('Pinned PS2 MakeSz source changed')
    # i16x8.bitmask reads only the high bit of each shuffled halfword.
    # Select each original word's high byte instead of first sign-extending it
    # across all bytes. The zero comparison and W/Z/Y/X flag order stay exact.
    body = body.replace(old_pattern, '0x0E, 0x0F, 0x0A, 0x0B, 0x06, 0x07, 0x02, 0x03,')
    body = body.replace(old_sign, '''\t//The shuffle selects each original word's sign byte directly.
\tPrepareSymbolUse(src1);''')
    path.write_text(text[:start] + body + text[end:])


if __name__ == '__main__':
    patch(sys.argv[1])
