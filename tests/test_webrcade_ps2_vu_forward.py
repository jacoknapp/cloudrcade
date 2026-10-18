#!/usr/bin/env python3
"""Actual VUShared/CMipsJitter/Wasm execution differential for flag forwarding.
Uses retained baseline CodeGen/Framework libraries read-only; compiles only tiny
fixture and changed emitter/source dependencies. No full Play build, ROM or GPU.
"""
import argparse
import hashlib
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
IMAGE='emscripten/emsdk@sha256:90b757eb11fa9a0e3ce4d2d9f76d932a56018e4accc37b5a28b2783751e60eb7'
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--play',required=True,type=Path)
p.add_argument('--output',type=Path)
a=p.parse_args();play=a.play.resolve();out=(a.output or Path(tempfile.mkdtemp(prefix='ps2-vu-forward-'))).resolve();out.mkdir(parents=True,exist_ok=True)
pins={'Source/ee/VUShared.cpp':'c27335f4258e2863a5631d53275bc8de2d66b9d70c4ec073e17e8bb94643b868','deps/CodeGen/src/Jitter_CodeGen_Wasm_Md.cpp':'2b95f7cea0ba4537c92424e1f495f9bbd35d1a18049dc188e12130592e4071f1'}
for relative,sha in pins.items():assert hashlib.sha256((play/relative).read_bytes()).hexdigest()==sha,'Baseline source changed: '+relative
for variant in ['baseline','candidate']:
    dst=out/variant/'Source/ee';dst.mkdir(parents=True,exist_ok=True);shutil.copyfile(play/'Source/ee/VUShared.cpp',dst/'VUShared.cpp')
def patch(name,where):
    spec=importlib.util.spec_from_file_location(name,ROOT/'deploy/webrcade/retro-play'/name)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.patch(where)
patch('patch-vu-forward.py',out/'candidate')
try:patch('patch-vu-forward.py',out/'candidate')
except ValueError:pass
else:raise AssertionError('Repeated patch must fail closed')
# Both variants include the separately frozen MakeSz sign-byte optimization.
dst=out/'common/deps/CodeGen/src';dst.mkdir(parents=True,exist_ok=True);shutil.copyfile(play/'deps/CodeGen/src/Jitter_CodeGen_Wasm_Md.cpp',dst/'Jitter_CodeGen_Wasm_Md.cpp');patch('patch-vu-flags.py',out/'common')
assert hashlib.sha256((dst/'Jitter_CodeGen_Wasm_Md.cpp').read_bytes()).hexdigest()=='45ec29647126d9df197f04294269edf8e12bb213854dbf5682666f2b0f1f9d93'
for name in ['generate.cpp','execute.cjs']:shutil.copyfile(ROOT/'tests/fixtures/ps2-vu-forward'/name,out/name)
def sdk(*args):subprocess.run(['docker','run','--rm','--network','none','-v',str(play)+':/src:ro','-v',str(out)+':/fixture','-w','/fixture',IMAGE,*args],check=True)
flags=['-O3','-DNDEBUG','-std=c++17','-pthread','-fexceptions','-I/src/Source','-I/src/Source/ee','-I/src/deps/CodeGen/include','-I/src/deps/Framework/include']
for source,obj in [('common/deps/CodeGen/src/Jitter_CodeGen_Wasm_Md.cpp','md.o'),('/src/Source/MipsJitter.cpp','mips-jitter.o'),('/src/Source/FpUtils.cpp','fp-utils.o')]:sdk('em++',*flags,'-c',source,'-o',obj)
build='/src/build_cmake/build/wasm-ninja/Source/ui_js/Source'
libs=[build+'/CodeGen/Release/libCodeGen.a',build+'/Framework/Release/libFramework.a']
for variant in ['baseline','candidate']:
    sdk('em++',*flags,'generate.cpp',variant+'/Source/ee/VUShared.cpp','md.o','mips-jitter.o','fp-utils.o',*libs,
        '-sENVIRONMENT=node','-sMODULARIZE=1','-sALLOW_MEMORY_GROWTH=1','-sEXPORTED_FUNCTIONS=[_generate,_generatedSize,_layout]','-sEXPORTED_RUNTIME_METHODS=HEAPU8','-o',variant+'.cjs')
subprocess.run(['node',str(out/'execute.cjs')],check=True)
for variant in ['baseline','candidate']:
    for kind in ['full','partial']:
        sdk('/emsdk/upstream/bin/wasm-dis',variant+'-'+kind+'.wasm','-o',variant+'-'+kind+'.wat')
for kind,expected in [('full',4),('partial',5)]:
    old=(out/('baseline-'+kind+'.wat')).read_text();new=(out/('candidate-'+kind+'.wat')).read_text()
    assert old.count('(v128.load')==expected and new.count('(v128.load')==expected-2,(kind,'missing actual VU reload elimination')
    assert old.count('(v128.store')==new.count('(v128.store')==1
    assert old.count('(i32.store')==new.count('(i32.store')
    assert new.index('(v128.store')<new.index('(i32.store'),'guest store must precede flag pipeline stores'
print('PASS actual VU+CodeGen execution, partial aliases/pipelines, original store position, two reloads removed; artifacts:',out)
