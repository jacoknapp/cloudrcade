#!/usr/bin/env python3
"""Pinned actual Emscripten CMipsJitter/Wasm bounded-memarg differential; no core build."""
import argparse, hashlib, importlib.util, json, shutil, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
IMAGE='sha256:cfb9617d93d63f0eaa3ee2563df595ec98fc7456854df77e680f8b472e173fc6'
p=argparse.ArgumentParser();p.add_argument('--play',type=Path,required=True);p.add_argument('--libraries-play',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--prepare-only',action='store_true');a=p.parse_args()
play=a.play.resolve();libraries=a.libraries_play.resolve();out=a.output.resolve();out.mkdir(exist_ok=True,parents=True)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
spec=importlib.util.spec_from_file_location('patcher',ROOT/'deploy/webrcade/retro-play/patch-context-memarg.py');patcher=importlib.util.module_from_spec(spec);spec.loader.exec_module(patcher)
for dep in ['CodeGen','Framework']:
 for folder in ['src','include']:
  for f in (play/'deps'/dep/folder).rglob('*'):
   if f.is_file() and f.suffix in ['.cpp','.h','.hpp','.c','.inc']:
    assert sha(f)==sha(libraries/f.relative_to(play)),str(f)
for variant in ['baseline','candidate']:
 for dep in ['CodeGen','Framework']:
  for folder in ['src','include']:shutil.copytree(play/'deps'/dep/folder,out/variant/'deps'/dep/folder,dirs_exist_ok=True)
 (out/variant/'Source').mkdir(exist_ok=True);shutil.copyfile(play/'Source/MipsJitter.cpp',out/variant/'Source/MipsJitter.cpp')
patcher.patch(out/'candidate')
for damaged in patcher.PINS:
 for f in patcher.PINS:
  t=out/'guard-negative'/f;t.parent.mkdir(exist_ok=True,parents=True);shutil.copyfile(play/f,t)
 f=out/'guard-negative'/damaged;f.write_bytes(f.read_bytes()+b'\n// guard negative\n')
 before={f:sha(out/'guard-negative'/f) for f in patcher.PINS}
 try:patcher.patch(out/'guard-negative')
 except ValueError:pass
 else:raise AssertionError('Accepted modified source: '+damaged)
 assert before=={f:sha(out/'guard-negative'/f) for f in patcher.PINS}
shutil.rmtree(out/'guard-negative')
try:patcher.patch(out/'candidate')
except ValueError:pass
else:raise AssertionError('Repeated patch accepted')
for f in (ROOT/'tests/fixtures/ps2-context-memarg').iterdir():
 if f.is_file():shutil.copyfile(f,out/f.name)
build='build_cmake/build/wasm-ninja/Source/ui_js/Source'
archives=[build+'/CodeGen/Release/libCodeGen.a',build+'/Framework/Release/libFramework.a']
def sdk(*args):subprocess.run(['docker','run','--rm','--network','none','-v',str(play)+':/src:ro','-v',str(libraries)+':/retained:ro','-v',str(out)+':/fixture','-w','/fixture',IMAGE,*args],check=True)
# Recompile all four Wasm emitter TUs and the generic base/factory with candidate
# headers. The appended virtual preserves old optimizer virtual slot numbers;
# untouched retained optimizer objects never allocate the expanded Wasm class.
units=['Jitter_CodeGen.cpp','Jitter_CodeGenFactory.cpp','Jitter_CodeGen_Wasm.cpp','Jitter_CodeGen_Wasm_64.cpp','Jitter_CodeGen_Wasm_Fpu.cpp','Jitter_CodeGen_Wasm_Md.cpp']
if a.prepare_only:raise SystemExit()
for variant in ['baseline','candidate']:
 flags=['-O3','-DNDEBUG','-std=c++17','-pthread','-fexceptions','-I/fixture/'+variant+'/deps/CodeGen/include','-I/fixture/'+variant+'/deps/Framework/include','-I/src/Source','-I/src/Source/ee']
 objects=[]
 for name in units:
  obj=variant+'-'+name+'.o';sdk('em++',*flags,'-c',variant+'/deps/CodeGen/src/'+name,'-o',obj);objects.append(obj)
 obj=variant+'-MipsJitter.o';sdk('em++',*flags,'-c',variant+'/Source/MipsJitter.cpp','-o',obj);objects.append(obj)
 sdk('em++',*flags,*(['-DKH_CONTEXT_MEMARG_FIXTURE=1'] if variant=='candidate' else []),'generate.cpp','access.cpp','/src/Source/ee/VUShared.cpp','/src/Source/FpUtils.cpp',*objects,*['/retained/'+x for x in archives],'-sENVIRONMENT=node','-sMODULARIZE=1','-sALLOW_MEMORY_GROWTH=1','-sEXPORTED_FUNCTIONS=[_generate,_generatedSize,_layout,_generateAccess,_accessSize,_accessLayout,_registerObserver]','-sEXPORTED_RUNTIME_METHODS=HEAPU8,UTF8ToString,convertJsFunctionToWasm','-o',variant+'.cjs')
(out/'provenance.json').write_text(json.dumps({'sdk':IMAGE,'originalPins':patcher.PINS,'candidatePins':{f:sha(out/'candidate'/f) for f in patcher.PINS},'retainedArchives':{f:sha(libraries/f) for f in archives},'freshCodeGenUnitsPerVariant':units,'guardNegativeCases':len(patcher.PINS),'repeatedPatchRejected':True,'fixtureInputs':{f.name:sha(f) for f in (ROOT/'tests/fixtures/ps2-context-memarg').iterdir() if f.is_file()},'actualEmscriptenCMipsConstructor':True,'fullCoreBuild':False,'performanceClaim':False},indent=2)+'\n')
for tier,flags in [('default',[]),('liftoff',['--liftoff-only']),('turbofan',['--no-liftoff'])]:
 for script in ['execute-vu.cjs','execute-access.cjs']:
  subprocess.run(['node',*flags,str(out/script)],check=True)
  result='result.json' if script=='execute-vu.cjs' else 'access-result.json'
  shutil.copyfile(out/result,out/(tier+'-'+result))
subprocess.run(['node','-e',"const p=process.argv[1]; require(p+'/portable-check.js').runContextMemargCorpus(require(p+'/portable-generated-corpus.json')).then(x=>require('fs').writeFileSync(p+'/portable-node-result.json',JSON.stringify(x,null,2))).catch(e=>{console.error(e);process.exitCode=1;});",str(out)],check=True)
print('PASS',out)
