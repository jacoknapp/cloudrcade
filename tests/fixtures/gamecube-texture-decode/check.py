#!/usr/bin/env python3
"""Focused native and transport checks; no GPU, remote service or full native build.
Usage: check.py /path/to/verified/baseline/wasm-dolphin [--prepared|--packaged] [--native-only]
The baseline must already contain the shipped nine downstream native patches.
--prepared accepts the October17 thirteen-patch shipped source instead.
--packaged accepts the complete current corresponding-source tree as-is.
"""
import os, pathlib, re, runpy, shutil, subprocess, sys, tempfile
fixture=pathlib.Path(__file__).resolve().parent
repo=fixture.parents[2]; adapter=repo/'deploy/webrcade/retro-dolphin'
baseline=pathlib.Path(sys.argv[1]).resolve(); dolphin=baseline/'vendor/dolphin'
patch=adapter/'native-patches/0012-webgpu-texture-decode.patch'
transfer_patch=adapter/'native-patches/0014-order-texture-transfers.patch'
flags=set(sys.argv[2:])
if flags-{'--prepared','--packaged','--native-only'} or {'--prepared','--packaged'}<=flags:
 raise SystemExit('Choose at most one source state: --prepared or --packaged')
with tempfile.TemporaryDirectory(prefix='gc-texture-check-') as work:
 work=pathlib.Path(work); native=work/'native';native.mkdir()
 for rel in re.findall(r'^--- a/(.+)$',patch.read_text(),re.M):
  target=native/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dolphin/rel,target)
 if '--packaged' not in flags:
  if '--prepared' not in flags:
   subprocess.run(['git','apply',str(patch)],cwd=native,check=True)
  subprocess.run(['git','apply',str(transfer_patch)],cwd=native,check=True)
 cmd=['g++','-std=c++23','-O2','-ffunction-sections','-fdata-sections','-Wl,--gc-sections']
 cmd+=['-I'+str(p) for p in [fixture/'stubs',native/'Source/Core',dolphin/'Source/Core',dolphin/'Externals/fmt/fmt/include']]
 cmd += [str(fixture/'native-shadow.cpp'),str(native/'Source/Core/VideoBackends/WebGPU/WebGPUTexture.cpp'),str(dolphin/'Source/Core/VideoCommon/TextureDecoder_Generic.cpp'),'-o',str(work/'native-shadow')]
 subprocess.run(cmd,check=True);subprocess.run([str(work/'native-shadow')],check=True)
 if '--native-only' in flags:
  print('PASS actual texture implementation: CPU parity and transfer ordering (host checks omitted)')
  sys.exit(0)
 app=work/'app';(app/'vendor/src').mkdir(parents=True)
 shutil.copy2(baseline/'src/upstream-discio-worker.js',app/'vendor/src/upstream-discio-worker.js')
 runpy.run_path(str(adapter/'patch-runtime.py'))['patch_runtime'](app)
 worker=app/'vendor/src/upstream-discio-worker.js'
 subprocess.run(['node','--check',str(worker)],check=True)
 subprocess.run(['node',str(repo/'tests/test_webrcade_gamecube_texture_decode.cjs')],env={**os.environ,'GAMECUBE_PATCHED_WORKER':str(worker)},check=True)
 print('PASS isolated native patch application, real shadow implementation, pinned host patch and replay ownership')
