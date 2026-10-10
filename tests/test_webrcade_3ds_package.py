#!/usr/bin/env python3
"""Fault-inject the actual patched RetroArch packager (argument: its script path)."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

def main():
    source = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(prefix='3ds-package-test-') as temp:
        root = Path(temp)
        emulatorjs = root / 'RetroArch/emulatorjs'
        emulatorjs.mkdir(parents=True)
        script = emulatorjs / 'build-emulatorjs.sh'
        shutil.copyfile(source, script)
        (emulatorjs / 'azahar_libretro_emscripten.bc').write_bytes(b'fixture')
        (root / 'RetroArch/version.all').write_text('')
        (root / 'RetroArch/azahar_libretro.js').write_text('fresh loader')
        (root / 'RetroArch/azahar_libretro.wasm').write_bytes(b'fresh core')
        fakebin = root / 'bin'
        fakebin.mkdir()
        for name, code in [('make', 0), ('7z', 2)]:
            program = fakebin / name
            program.write_text(f'#!/bin/sh\nexit {code}\n')
            program.chmod(0o755)
        result = subprocess.run(['bash', str(script), '--threads'], cwd=emulatorjs,
                                env=dict(os.environ, EMSCRIPTEN='test', PATH=f'{fakebin}:{os.environ["PATH"]}'),
                                capture_output=True, text=True)
        assert result.returncode != 0, 'Packager swallowed archive failure'
        assert (root / 'RetroArch/azahar_libretro.wasm').exists(), 'Packager continued cleanup after failed archive'
        print('PASS actual RetroArch packager rejects archive failure before cleanup')


if __name__ == "__main__":
    main()
