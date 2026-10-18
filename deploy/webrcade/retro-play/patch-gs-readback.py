#!/usr/bin/env python3
"""Expose the actual reader boundary; preserve every original CPU unpack body."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
here = Path(__file__).resolve().parent
path = root / 'Source/gs/GSHandler.h'
source = path.read_text()
old = '\tvoid ReadImageDataImpl(void*, uint32);'
assert source.count(old) == 1, 'Pinned PS2 reader declaration changed'
path.write_text(source.replace(old, '\tvirtual void ReadImageDataImpl(void*, uint32);'))
(root / 'Source/CloudReadbackRange.h').write_bytes((here / 'native/CloudReadbackRange.h').read_bytes())
