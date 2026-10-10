"""Package exact patched sources and submodules used to build the PSP release."""
from pathlib import Path
import sys
import tarfile
work, output = map(Path, sys.argv[1:])
excluded = {'.git', 'node_modules', 'CMakeFiles', 'build', '.cache', '__pycache__', 'obj-emscripten'}
roots = ('ppsspp', 'RetroArch', 'webrcade-app-common', 'webrcade-app-retro-ppsspp', 'filesystem')
with tarfile.open(output, 'w:gz') as archive:
    for name in roots:
        for path in sorted((work/name).rglob('*')):
            relative = path.relative_to(work/name)
            if any(part in excluded for part in relative.parts): continue
            if name == 'ppsspp' and relative.parts[:2] == ('ffmpeg', 'linux'): continue
            if path.is_file() and path.suffix not in {'.o', '.a', '.bc', '.wasm', '.so', '.dll', '.dylib'}:
                archive.add(path, arcname=str(Path(name)/relative), recursive=False)
print('Packaged PSP corresponding source')
