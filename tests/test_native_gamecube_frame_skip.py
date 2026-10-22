#!/usr/bin/env python3
"""Check the frame-skip header shipped in GAMECUBE_SOURCE_ARCHIVE (GC or Wii).

Requires host C++20; ASan/UBSan validate boundary/restore policy without games.
Real vertex-loader state equivalence is checked separately by the native smoke.
"""
import os
from pathlib import Path
import shlex
import subprocess
import tarfile
import tempfile

archive = os.environ.get('GAMECUBE_SOURCE_ARCHIVE')
if not archive:
    raise SystemExit('Set GAMECUBE_SOURCE_ARCHIVE to a prepared native source archive')
with tempfile.TemporaryDirectory(prefix='gamecube-frame-skip-') as work:
    work = Path(work)
    with tarfile.open(archive) as source:
        header = source.extractfile('vendor/dolphin/Source/Core/VideoCommon/WasmFrameSkip.h')
        if header is None:
            raise RuntimeError('Packaged native frame-skip header is missing')
        (work / 'WasmFrameSkip.h').write_bytes(header.read())
    binary = work / 'frame-skip-test'
    subprocess.run([*shlex.split(os.environ.get('CXX', 'c++')), '-std=c++20', '-O1',
                    '-g', '-fsanitize=address,undefined', '-I', str(work),
                    str(Path(__file__).with_name('native_gamecube_frame_skip.cpp')),
                    '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
