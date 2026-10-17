#!/usr/bin/env python3
"""Focused native and transport checks; no GPU, remote service or full native build.
Usage: check.py /path/to/verified/baseline/wasm-dolphin
The baseline must already contain the shipped nine downstream native patches.
"""
import os, pathlib, re, runpy, shutil, subprocess, sys, tempfile
fixture=pathlib.Path(__file__).resolve().parent
repo=fixture.parents[2]; adapter=repo/'deploy/webrcade/retro-dolphin'
baseline=pathlib.Path(sys.argv[1]).resolve(); dolphin=baseline/'vendor/dolphin'
patch=adapter/'native-patches/0012-webgpu-texture-decode.patch'
with tempfile.TemporaryDirectory(prefix='gc-texture-check-') as work:
 work=pathlib.Path(work); native=work/'native';native.mkdir()
 for rel in re.findall(r'^--- a/(.+)$',patch.read_text(),re.M):
  target=native/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dolphin/rel,target)
 subprocess.run(['git','apply',str(patch)],cwd=native,check=True)
 cmd=['g++','-std=c++23','-O2','-ffunction-sections','-fdata-sections','-Wl,--gc-sections']
 cmd+=['-I'+str(p) for p in [fixture/'stubs',native/'Source/Core',dolphin/'Source/Core',dolphin/'Externals/fmt/fmt/include']]
 cmd += [str(fixture/'native-shadow.cpp'),str(native/'Source/Core/VideoBackends/WebGPU/WebGPUTexture.cpp'),str(dolphin/'Source/Core/VideoCommon/TextureDecoder_Generic.cpp'),'-o',str(work/'native-shadow')]
 subprocess.run(cmd,check=True);subprocess.run([str(work/'native-shadow')],check=True)
 app=work/'app';(app/'vendor/src').mkdir(parents=True)
 shutil.copy2(baseline/'src/upstream-discio-worker.js',app/'vendor/src/upstream-discio-worker.js')
 runpy.run_path(str(adapter/'patch-runtime.py'))['patch_runtime'](app)
 worker=app/'vendor/src/upstream-discio-worker.js'
 subprocess.run(['node','--check',str(worker)],check=True)
 subprocess.run(['node',str(repo/'tests/test_webrcade_gamecube_texture_decode.cjs')],env={**os.environ,'GAMECUBE_PATCHED_WORKER':str(worker)},check=True)
 print('PASS isolated native patch application, real shadow implementation, pinned host patch and replay ownership')
