#!/usr/bin/env python3
"""Exercise the actual PS2 archive filter with source and generated trees."""
import ast
import io
from pathlib import Path
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
recipe = ROOT / 'deploy/webrcade/retro-play/prepare.py'
tree = ast.parse(recipe.read_text())
functions = [node for node in ast.walk(tree)
             if isinstance(node, ast.FunctionDef) and node.name == 'source_filter']
assert len(functions) == 1
scope = {'Path': Path}
exec(compile(ast.Module(body=functions, type_ignores=[]), str(recipe), 'exec'), scope)

with tempfile.TemporaryDirectory(prefix='ps2-source-archive-') as temporary:
    source = Path(temporary) / 'Play'
    files = {
        'Source/CMakeLists.txt': b'core source recipe\n',
        'build_cmake/build_wasm_release.sh': b'upstream build script\n',
        'deps/Framework/build_cmake/Framework/CMakeLists.txt': b'library recipe\n',
        'deps/Framework/build_cmake/Framework_Common.cmake': b'shared recipe\n',
        'deps/CodeGen/build_cmake/DONOTREMOVE': b'source placeholder\n',
        'build_cmake/build/Release/Play.wasm': b'compiler output',
        '.git/config': b'git metadata',
        'deps/Framework/.git': b'submodule metadata',
        'node_modules/dependency/index.js': b'installed dependency',
        '__pycache__/prepare.pyc': b'python cache',
        'CloudGPU/Gpu.js': b'generated glue',
        'CloudGPU/Gpu.wasm': b'generated gpu',
    }
    for name, content in files.items():
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    packed = io.BytesIO()
    with tarfile.open(fileobj=packed, mode='w') as archive:
        archive.add(source, arcname='ps2/Play', filter=scope['source_filter'])
    packed.seek(0)
    expected = {name: content for name, content in files.items()
                if name.startswith(('Source/', 'deps/Framework/build_cmake/',
                                    'deps/CodeGen/build_cmake/',
                                    'build_cmake/build_wasm_release.sh'))}
    with tarfile.open(fileobj=packed, mode='r') as archive:
        actual = {member.name.removeprefix('ps2/Play/'): archive.extractfile(member).read()
                  for member in archive.getmembers() if member.isfile()}
    assert actual == expected, (actual.keys(), expected.keys())

print('PASS PS2 source archive retains submodule CMake recipes and excludes compiler output, Git and dependency caches')
