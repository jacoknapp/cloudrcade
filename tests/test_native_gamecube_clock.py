#!/usr/bin/env python3
"""Check the clock header shipped in a prepared native source archive.

GAMECUBE_SOURCE_ARCHIVE must name the prepared GameCube or Wii source tarball.
Requires a host C++20 compiler (CXX, default c++); runs ASan/UBSan, without ROMs.
This is a native qualification check, separate from the portable regression suite.
"""
import os
from pathlib import Path
import shlex
import subprocess
import tarfile
import tempfile


def main():
    archive = os.environ.get('GAMECUBE_SOURCE_ARCHIVE')
    if not archive:
        raise SystemExit('Set GAMECUBE_SOURCE_ARCHIVE to a prepared native source archive')
    member = 'vendor/dolphin/Source/Core/Core/PowerPC/CachedInterpreter/WasmInstanceClock.h'
    with tempfile.TemporaryDirectory(prefix='gamecube-clock-') as work:
        work = Path(work)
        with tarfile.open(archive) as source:
            header = source.extractfile(member)
            if header is None:
                raise RuntimeError('Native source archive has no clock header')
            (work / 'WasmInstanceClock.h').write_bytes(header.read())
        binary = work / 'clock-test'
        subprocess.run([*shlex.split(os.environ.get('CXX', 'c++')),
                        '-std=c++20', '-O1', '-g', '-fsanitize=address,undefined',
                        '-I', str(work), str(Path(__file__).with_name(
                            'native_gamecube_wasm_instance_clock.cpp')),
                        '-o', str(binary)], check=True)
        subprocess.run([str(binary)], check=True)
    print('PASS shipped native clock: shared handles, cold retirement, block reuse and lifetime safety')


if __name__ == '__main__':
    main()
