#!/usr/bin/env python3
"""Preserve native GS register ownership across snapshot/replacement barriers."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
path = root / 'Source/gs/GSHandler.cpp'
source = path.read_text()


def edit(old, new):
    global source
    if source.count(old) != 1:
        raise ValueError('Pinned PS2 GS source changed: ' + old.splitlines()[0])
    source = source.replace(old, new)


# These entry points run on the VM/control thread. A GS-worker Flush only sees
# writes already submitted to its mailbox, not the VM's short register tail.
edit('void CGSHandler::SaveState(Framework::CZipArchiveWriter& archive)\n{',
     'void CGSHandler::SaveState(Framework::CZipArchiveWriter& archive)\n{\n'
     '\tSubmitWriteBuffer();')
edit('void CGSHandler::Copy(CGSHandler* source)\n{',
     'void CGSHandler::Copy(CGSHandler* source)\n{\n'
     '\tsource->SubmitWriteBuffer();')
edit('void CGSHandler::Flip(uint32 flags)\n{',
     'void CGSHandler::Flip(uint32 flags)\n{\n'
     '\tSubmitWriteBuffer();')

# Retire every callback holding register-buffer pointers before reusing storage
# or replacing register/transfer state. Reset discards its tail via ResetBase;
# load discards it explicitly, without replaying old writes into restored state.
# Nonthreaded GS keeps its existing caller-driven queue behavior.
edit('void CGSHandler::Reset()\n{\n\tResetBase();',
     'void CGSHandler::Reset()\n{\n'
     '\tif(m_gsThreaded) SendGSCall([]() {}, true);\n'
     '\tResetBase();')
edit('void CGSHandler::LoadState(Framework::CZipArchiveReader& archive)\n{',
     'void CGSHandler::LoadState(Framework::CZipArchiveReader& archive)\n{\n'
     '\tif(m_gsThreaded) SendGSCall([]() {}, true);\n'
     '\tm_writeBufferSize = 0;\n'
     '\tm_writeBufferProcessIndex = 0;\n'
     '\tm_writeBufferSubmitIndex = 0;')
path.write_text(source)
