#!/usr/bin/env python3
"""Checked, default-off EE-only tail-chain prototype on pinned Play scratch."""
from pathlib import Path
import sys
root=Path(sys.argv[1]);here=Path(__file__).resolve().parent
(root/'Source/CloudTailChain.h').write_bytes((here/'native/TailChain.h').read_bytes())
def edit(name,old,new):
 p=root/name;s=p.read_text()
 if s.count(old)!=1:raise ValueError('Pinned tail-chain source changed: '+name)
 p.write_text(s.replace(old,new))
edit('Source/MIPS.h','#include "Types.h"','#include "Types.h"\n#include "CloudTailChain.h"')
edit('Source/MIPS.h','\tTLBExceptionChecker m_TLBExceptionChecker = nullptr;','\tTLBExceptionChecker m_TLBExceptionChecker = nullptr;\n CloudTail::State* m_cloudChain = nullptr;')
edit('Source/BasicBlock.h','\tbool IsCompiled() const;', '''\tbool IsCompiled() const;
 uint32 GetCloudFunction() const { return static_cast<uint32>(reinterpret_cast<uintptr_t>(m_function.GetCode())); }''')
edit('Source/BasicBlock.cpp','\tm_function = CMemoryFunction(stream.GetBuffer(), stream.GetSize());', ''' if(m_category == BLOCK_CATEGORY_PS2_EE && !IsEmpty() && m_context.m_cloudChain) {
  const auto bytes = CloudTail::Rewrite(stream.GetBuffer(), stream.GetSize(), {
   offsetof(CMIPS, m_State.nPC), offsetof(CMIPS, m_State.nHasException),
   offsetof(CMIPS, m_State.cycleQuota), offsetof(CMIPS, m_cloudChain)});
  m_function = CMemoryFunction(bytes.data(), bytes.size());
 } else {
\tm_function = CMemoryFunction(stream.GetBuffer(), stream.GetSize());
 }''')
edit('Source/GenericMipsExecutor.h','\t\tm_emptyBlock->Compile();',''' if(blockCategory == BLOCK_CATEGORY_PS2_EE && CloudTail::Enabled().load(std::memory_order_relaxed) && CloudTail::Supported()) {
  m_cloudChain = std::make_unique<CloudTail::State>();
  m_cloudChain->addressMask = m_addressMask;
  m_context.m_cloudChain = m_cloudChain.get();
 }
\t\tm_emptyBlock->Compile();''')
edit('Source/GenericMipsExecutor.h','\tvirtual ~CGenericMipsExecutor() = default;', '\tvirtual ~CGenericMipsExecutor() { if(m_cloudChain) m_context.m_cloudChain = nullptr; }')
edit('Source/GenericMipsExecutor.h','\t\tm_context.m_State.cycleQuota = cycles;','\t\tm_context.m_State.cycleQuota = cycles;\n uint32 cloudEntries = 0;')
edit('Source/GenericMipsExecutor.h','\t\t\tblock->Execute();','\t\t\tif(m_cloudChain) { m_cloudChain->budget = 63; ++cloudEntries; }\n\t\t\tblock->Execute();')
edit('Source/GenericMipsExecutor.h','\t\treturn m_context.m_State.cycleQuota;', ''' if(m_cloudChain && (CloudCpuTiming::State().load(std::memory_order_relaxed) & 1))
  CloudTail::Entries().fetch_add(cloudEntries, std::memory_order_relaxed);
\t\treturn m_context.m_State.cycleQuota;''')
edit('Source/GenericMipsExecutor.h','\t\tm_blockLookup.Clear();','\t\tif(m_cloudChain) m_cloudChain->Clear();\n\t\tm_blockLookup.Clear();')
edit('Source/GenericMipsExecutor.h','\t\tm_blockLookup.AddBlock(block.get());','\t\tm_blockLookup.AddBlock(block.get());\n  if(m_cloudChain) m_cloudChain->Add(start, block->GetCloudFunction());')
edit('Source/GenericMipsExecutor.h','\t\t\tm_blockLookup.DeleteBlock(block);','\t\t\tif(m_cloudChain) m_cloudChain->Remove(block->GetBeginAddress());\n\t\t\tm_blockLookup.DeleteBlock(block);')
edit('Source/GenericMipsExecutor.h','\tBlockStore m_blocks;','\tstd::unique_ptr<CloudTail::State> m_cloudChain;\n\tBlockStore m_blocks;')
# A second table keeps helper IDs separate from recyclable Emscripten handles.
edit('deps/CodeGen/src/MemoryFunction.cpp','fctTable : Module.codeGenImportTable','fctTable : Module.codeGenImportTable,\n            guestTable: wasmTable')
