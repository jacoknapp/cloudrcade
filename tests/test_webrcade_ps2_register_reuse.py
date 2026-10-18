#!/usr/bin/env python3
"""Actual CMipsJitter/Wasm register reuse proof; no fullcore rebuild.
Requires original installed5833 Play source and its existing Emscripten Framework
archive. Uses pinned offline SDK; all CodeGen STATEMENT/header consumers fresh.
"""
import argparse,hashlib,importlib.util,json,shutil,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
IMAGE='sha256:cfb9617d93d63f0eaa3ee2563df595ec98fc7456854df77e680f8b472e173fc6'
p=argparse.ArgumentParser();p.add_argument('--play',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--prepare-only',action='store_true');a=p.parse_args()
play=a.play.resolve();out=a.output.resolve();out.mkdir(exist_ok=True,parents=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
spec=importlib.util.spec_from_file_location('patcher',ROOT/'deploy/webrcade/retro-play/patch-register-reuse.py');patcher=importlib.util.module_from_spec(spec);spec.loader.exec_module(patcher)
for variant in ['baseline','candidate']:
 for dep in ['CodeGen','Framework']:
  for folder in ['src','include']:shutil.copytree(play/'deps'/dep/folder,out/variant/'deps'/dep/folder,dirs_exist_ok=True)
 (out/variant/'Source').mkdir(exist_ok=True)
 for name in ['MipsJitter.cpp','MipsJitter.h','MIPS.h']:shutil.copyfile(play/'Source'/name,out/variant/'Source'/name)
patcher.patch(out/'candidate')
for damaged in patcher.PINS:
 for f in patcher.PINS:
  t=out/'guard-negative'/f;t.parent.mkdir(exist_ok=True,parents=True);shutil.copyfile(play/f,t)
 f=out/'guard-negative'/damaged;f.write_bytes(f.read_bytes()+b'\n// source guard negative\n')
 before={f:sha(out/'guard-negative'/f) for f in patcher.PINS}
 try:patcher.patch(out/'guard-negative')
 except ValueError:pass
 else:raise AssertionError('Accepted drift: '+damaged)
 assert before=={f:sha(out/'guard-negative'/f) for f in patcher.PINS}
shutil.rmtree(out/'guard-negative')
try:patcher.patch(out/'candidate')
except ValueError:pass
else:raise AssertionError('Repeated patch accepted')
for f in (ROOT/'tests/fixtures/ps2-register-reuse').iterdir():
 if f.is_file():shutil.copyfile(f,out/f.name)
units=['Jitter.cpp','Jitter_Optimize.cpp','Jitter_RegAlloc.cpp','Jitter_Statement.cpp','Jitter_SymbolTable.cpp','Jitter_CodeGen.cpp','Jitter_CodeGenFactory.cpp','Jitter_CodeGen_Wasm.cpp','Jitter_CodeGen_Wasm_64.cpp','Jitter_CodeGen_Wasm_Fpu.cpp','Jitter_CodeGen_Wasm_Md.cpp','WasmModuleBuilder.cpp']
archive='build_cmake/build/wasm-ninja/Source/ui_js/Source/Framework/Release/libFramework.a'
def sdk(*args):subprocess.run(['docker','run','--rm','--network','none','-v',str(play)+':/src:ro','-v',str(out)+':/fixture','-w','/fixture',IMAGE,*args],check=True)
if a.prepare_only:raise SystemExit()
for variant in ['baseline','candidate']:
 flags=['-O2','-DNDEBUG','-std=c++17','-pthread','-fexceptions','-I/fixture/'+variant+'/deps/CodeGen/include','-I/fixture/'+variant+'/deps/Framework/include','-I/src/Source','-I/src/Source/ee']
 objects=[]
 for name in units:
  obj=variant+'-'+name+'.o';sdk('em++',*flags,'-c',variant+'/deps/CodeGen/src/'+name,'-o',obj);objects.append(obj)
 obj=variant+'-MipsJitter.o';sdk('em++',*flags,'-c',variant+'/Source/MipsJitter.cpp','-o',obj);objects.append(obj)
 sdk('em++',*flags,*(['-DKH_REGISTER_REUSE_FIXTURE=1'] if variant=='candidate' else []),'generate.cpp','/src/Source/ee/VUShared.cpp','/src/Source/FpUtils.cpp',*objects,'/src/'+archive,'-sENVIRONMENT=node','-sMODULARIZE=1','-sALLOW_MEMORY_GROWTH=1','-sEXPORTED_FUNCTIONS=[_generate,_size,_layout,_registerObserver,_disabledSize,_disabledPtr]','-sEXPORTED_RUNTIME_METHODS=HEAPU8,UTF8ToString,convertJsFunctionToWasm','-o',variant+'.cjs')
(out/'provenance.json').write_text(json.dumps({'sdk':IMAGE,'originalPins':patcher.PINS,'candidatePins':{f:sha(out/'candidate'/f) for f in patcher.PATCHED},'retainedFramework':sha(play/archive),'freshCodeGenUnitsPerVariant':units,'guardNegativeCases':len(patcher.PINS),'repeatedPatchRejected':True,'fixtureInputs':{f.name:sha(f) for f in (ROOT/'tests/fixtures/ps2-register-reuse').iterdir() if f.is_file()},'fullCoreBuild':False,'performanceClaim':False},indent=2)+'\n')
for tier,flags in [('default',[]),('liftoff',['--liftoff-only']),('turbofan',['--no-liftoff'])]:
 subprocess.run(['node',*flags,str(out/'execute.cjs')],check=True)
 shutil.copyfile(out/'result.json',out/(tier+'-result.json'))
sdk('python3','audit-wat.py')
subprocess.run(['node','-e',"const fs=require('fs'),p=process.argv[1];require(p+'/portable-runner.js').runPortableCorpus(JSON.parse(fs.readFileSync(p+'/portable-corpus.json'))).then(r=>fs.writeFileSync(p+'/portable-node-result.json',JSON.stringify(r,null,2)+'\\n')).catch(e=>{console.error(e);process.exitCode=1;});",str(out)],check=True)
print('PASS',out)
