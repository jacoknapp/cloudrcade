#!/usr/bin/env python3
"""Package the exact patched core sources and submodules, excluding build/data."""
import argparse
from pathlib import Path
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('work', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
roots = ('azahar', 'RetroArch', 'webrcade-app-common', 'webrcade-app-retro-azahar')
excluded = {'.git', 'node_modules', 'CMakeFiles', '.cache', '__pycache__', 'obj', 'objs'}
for name in roots:
    if not (args.work / name).is_dir():
        raise SystemExit(f'Missing build source: {name}')
if (args.work / 'azahar/src/core/hw/default_keys.h').exists():
    raise SystemExit('Refusing to package a preset key header')
args.output.parent.mkdir(parents=True, exist_ok=True)
with tarfile.open(args.output, 'w:gz') as archive:
    for name in roots:
        root = args.work / name
        for path in sorted(root.rglob('*')):
            relative = path.relative_to(root)
            if any(part in excluded for part in relative.parts) or relative.parts[0] in {'build', 'build-emscripten'}:
                continue
            if path.name in {'default_keys.h', 'aes_keys.txt', 'keys.txt', 'keys.bin',
                             'boot9.bin', 'boot11.bin', 'otp.bin', 'movable.sed'}:
                raise SystemExit(f'Refusing a runtime key file: {relative}')
            if path.is_file() and path.suffix not in {'.o', '.a', '.bc', '.wasm'}:
                archive.add(path, arcname=str(Path(name) / relative), recursive=False)
print(f'Packaged corresponding source: {args.output.name}')
