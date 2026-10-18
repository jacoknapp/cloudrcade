#!/usr/bin/env python3
"""Checked V4-32 contiguous unpack batching. Apply only to owned Play scratch.

No stream direct pointer is used: Read retains the actual FIFO/tag/refill state.
--reverse restores the byte-identical pinned source; wrong/already patched inputs
fail without writing. No game-specific checks or serialized members are added.
"""
import argparse
import hashlib
from pathlib import Path

BASE_SHA = '2de231a74611cc3bfa41ff73d6680ec54a31995565f9258e41db1414cb4471ba'
STREAM_SHA = '90447cfc89c4778bab51b0c6a04378ad8cea9cb0d33665cf41f88cb5b4c828de'
PAYLOAD_ANCHOR = '\t\tinline uint32 GetRemainingDmaTransferSize() const'
PAYLOAD = '''\t\t// Unlike the legacy availability count, exclude a tag not yet refilled.
\t\tinline uint32 GetAvailablePayloadBytes() const
\t\t{
\t\t\tconst uint32 available = GetAvailableReadBytes();
\t\t\treturn available - (m_tagIncluded ? std::min<uint32>(available, 8) : 0);
\t\t}

'''
ANCHOR = '\t\twhile(currentNum != 0)\n\t\t{\n\t\t\tbool mustWrite = false;'
INSERT = '''\t\twhile(currentNum != 0)
\t\t{
\t\t\t// Only the ordinary contiguous V4-32 path has one input per output.
\t\t\t// Keep Read's FIFO buffering/tag handling, including its final buffer.
\t\t\tif constexpr((dataType == 0x0C) && clGreaterEqualWl && !useMask && (mode == 0))
\t\t\t{
\t\t\t\tif((cl == wl) && (cl != 0) && (m_readTick == m_writeTick) && (m_readTick < cl))
\t\t\t\t{
\t\t\t\t\tuint32 count = std::min<uint32>(currentNum, stream.GetAvailablePayloadBytes() / 0x10);
\t\t\t\t\tcount = std::min<uint32>(count, (vuMemSize - nDstAddr) / 0x10);
\t\t\t\t\tif(count >= 2)
\t\t\t\t\t{
\t\t\t\t\t\tstream.Read(vuMem + nDstAddr, count * 0x10);
\t\t\t\t\t\tcurrentNum -= count;
\t\t\t\t\t\tm_readTick = (m_readTick + count) % cl;
\t\t\t\t\t\tm_writeTick = m_readTick;
\t\t\t\t\t\tnDstAddr = (nDstAddr + count * 0x10) & (vuMemSize - 1);
\t\t\t\t\t\tcontinue;
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t\tbool mustWrite = false;'''


def transformed(original):
    if hashlib.sha256(original).hexdigest() != BASE_SHA:
        raise ValueError('Pinned VIF header changed')
    old = ANCHOR.encode()
    if original.count(old) != 1:
        raise ValueError('Pinned VIF unpack anchor changed')
    if original.count(PAYLOAD_ANCHOR.encode()) != 1:
        raise ValueError('Pinned VIF payload anchor changed')
    return original.replace(old, INSERT.encode()).replace(PAYLOAD_ANCHOR.encode(), (PAYLOAD + PAYLOAD_ANCHOR).encode())


def apply(root, reverse=False):
    path = root / 'Source/ee/Vif.h'
    data = path.read_bytes()
    if hashlib.sha256((root / 'Source/ee/Vif.cpp').read_bytes()).hexdigest() != STREAM_SHA:
        raise ValueError('Pinned VIF stream implementation changed')
    if reverse:
        if data.count(INSERT.encode()) != 1:
            raise ValueError('Expected exactly one VIF bulk insertion')
        if data.count((PAYLOAD + PAYLOAD_ANCHOR).encode()) != 1:
            raise ValueError('Expected exactly one VIF payload query')
        result = data.replace(INSERT.encode(), ANCHOR.encode()).replace((PAYLOAD + PAYLOAD_ANCHOR).encode(), PAYLOAD_ANCHOR.encode())
        if transformed(result) != data:
            raise ValueError('VIF bulk reversal failed source guard')
    else:
        result = transformed(data)
    path.write_bytes(result)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('play', type=Path)
    parser.add_argument('--reverse', action='store_true')
    args = parser.parse_args()
    apply(args.play, args.reverse)
