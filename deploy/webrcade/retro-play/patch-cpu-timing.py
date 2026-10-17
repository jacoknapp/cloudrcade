#!/usr/bin/env python3
"""Apply checked opt-in timing boundaries to an already patched Play scratch tree."""
from pathlib import Path
import sys
root = Path(sys.argv[1])
here = Path(__file__).resolve().parent
(root / 'Source/CloudCpuTiming.h').write_bytes((here / 'native/CpuTiming.h').read_bytes())
def edit(name, old, new):
    path = root / name
    text = path.read_text()
    if text.count(old) != 1:
        raise ValueError('Pinned PS2 timing source changed: ' + name)
    path.write_text(text.replace(old, new))
for name in ['Source/GenericMipsExecutor.h', 'Source/BasicBlock.cpp', 'Source/PS2VM.cpp', 'Source/gs/GSHandler.cpp']:
    path = root / name
    path.write_text('#include "CloudCpuTiming.h"\n' + path.read_text())
edit('Source/GenericMipsExecutor.h', '\tint Execute(int cycles) override\n\t{', '''\tint Execute(int cycles) override
\t{
        const auto timingCategory = m_blockCategory == BLOCK_CATEGORY_PS2_EE ? CloudCpuTiming::EE :
            m_blockCategory == BLOCK_CATEGORY_PS2_IOP ? CloudCpuTiming::IOP : CloudCpuTiming::VU;
        CloudCpuTiming::Scope cloudTiming(timingCategory);''')
edit('Source/BasicBlock.cpp', 'void CBasicBlock::Compile()\n{', 'void CBasicBlock::Compile()\n{\n CloudCpuTiming::Scope cloudTiming(CloudCpuTiming::Compile, true);')
edit('Source/PS2VM.cpp', 'void CPS2VM::UpdateSpu()\n{', 'void CPS2VM::UpdateSpu()\n{\n CloudCpuTiming::Scope cloudTiming(CloudCpuTiming::SPU);')
# Actual synchronous GS message waits include queue drain and event delivery.
# The graphics worker bridge wait is measured separately by GSH_WebGPU.
edit('Source/gs/GSHandler.cpp', '\twaitForCompletion |= forceWaitForCompletion;\n\tm_mailBox.SendCall(function, waitForCompletion);', '\twaitForCompletion |= forceWaitForCompletion;\n CloudCpuTiming::Scope cloudTiming(CloudCpuTiming::GSSync, true, waitForCompletion);\n\tm_mailBox.SendCall(function, waitForCompletion);')
