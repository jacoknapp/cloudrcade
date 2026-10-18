#!/usr/bin/env python3
"""Audit generated static variants against qualified baseline and tested dynamic cache.
No compiler/device execution. Retain device parity as an independent gate.
"""
import argparse, hashlib, json, re
from pathlib import Path
p=argparse.ArgumentParser()
for name in ('baseline','dynamic','source','output'):p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(a.source/'gs.wgsl')==sha(a.baseline/'gs.wgsl')=='31e291ac30243ea940e2f163493def590c62bb8a4bde8ccf6fa46f853becb25e'
# Compare complete function bodies, rather than just selected textual snippets.
def functions(text):
 result={}
 for m in re.finditer(r'\bfn (\w+)\(',text):
  i=text.index('{',m.end());j=i+1;level=1
  while level:
   level+=(text[j]=='{')-(text[j]=='}');j+=1
  assert m[1] not in result
  result[m[1]]=text[m.start():j]
 return result
cached=(a.source/'gs-cached.wgsl').read_text();dynamic=(a.dynamic/'gs.wgsl').read_text()
assert re.findall(r'@compute[^\n]*\nfn (\w+)',cached)==['raster_cached']
assert 'cloud_pixel_cache' not in cached and 'prm(7u)' not in cached
original=functions(dynamic);actual=functions(cached)
removed=set(re.findall(r'@compute[^\n]*\nfn (\w+)',dynamic))-{'raster'}
assert set(actual)==(set(original)-removed-{'raster'})|{'raster_cached'}
for name,body in actual.items():
 expected=original['raster' if name=='raster_cached' else name]
 expected=expected.replace('fn raster(', 'fn raster_cached(')
 for line in ('    cloud_pixel_cache = prm(7u) != 0u;\n','    if (!cloud_pixel_cache) { return load_at(l, k); }\n','    if (!cloud_pixel_cache) { store(l, k, value); return; }\n'):
  expected=expected.replace(line,'')
 assert body==expected,name
# Actual helpers, ownership gates, ABI, transfer, presentation and timing sources
# retain their previously checked implementation.
unchanged=[]
for f in a.baseline.iterdir():
 if not f.is_file() or not (a.source/f.name).is_file() or f.name in ('gpu.cpp','gs.wgsl.cpp'):continue
 assert f.read_bytes()==(a.source/f.name).read_bytes(),f.name
 unchanged.append(f.name)
assert (a.source/'pixel-cache.hpp').read_bytes()==(a.dynamic/'pixel-cache.hpp').read_bytes()
s=(a.source/'gpu.cpp').read_text();old=(a.dynamic/'gpu.cpp').read_text()
def entries(s):return re.search(r'kEntryPoints\[kPipelines\] = \{([^}]+)',s)[1]
assert entries(s)==entries(old)+', "raster_cached"'
assert s.count('CloudPixelCache::Eligible(')==1
assert 'g_param_records[param][7] ? kRasterCached : kRaster' in s
assert 'cd.compute.module = i == kRasterCached ? cached_module : module;' in s
# Apart from two metadata declarations, one dispatch selection, and init module
# selection/creation, the whole host source must equal the tested dynamic host.
s=s.replace('\nextern const char kGsCachedShader[];','').replace('kComposite, kRasterCached, kPipelines','kComposite, kPipelines').replace(', "raster_cached"};','};')
s=s.replace('g_param_records[param][7] ? kRasterCached : kRaster','kRaster')
s=s.replace('        if (!g_pipelines[i]) {\n            wgpuShaderModuleRelease(cached_module);\n            wgpuShaderModuleRelease(module);\n            return false;\n        }','        if (!g_pipelines[i]) return false;')
s=s.replace('    // Create the cached pipeline eagerly during renderer initialization.\n    source.code = view(kGsCachedShader);\n    WGPUShaderModule cached_module = wgpuDeviceCreateShaderModule(g_device, &md);\n','').replace('i == kRasterCached ? cached_module : module','module').replace('    wgpuShaderModuleRelease(cached_module);\n','')
assert s==old,'unexpected host change'
tu=(a.source/'gs.wgsl.cpp').read_text()
for name,f in [('kGsShader','gs.wgsl'),('kGsCachedShader','gs-cached.wgsl')]:
 assert 'extern const char '+name+'[] = R"WGSL(\n'+(a.source/f).read_text()+')WGSL";\n' in tu
assert tu.count('extern const char ')==2
report={'status':'PASS_SOURCE_EQUIVALENCE_DEVICE_UNTESTED','fallbackShader':sha(a.source/'gs.wgsl'),'cachedShader':sha(a.source/'gs-cached.wgsl'),'cacheFunctionsCompared':len(actual),'unchangedGeneratedFiles':sorted(unchanged),'eligibilityUnchanged':True,'existingPipelineIdsAndShadersUnchanged':True,'cachedPipelineId':10,'cachedEntryPoint':'raster_cached','pipelineCreation':'eager during renderer init','generatedHashes':{f:sha(a.source/f) for f in ('gpu.cpp','gs.wgsl','gs-cached.wgsl','gs.wgsl.cpp','pixel-cache.hpp')},'limitations':['Source equivalence only; fresh native build and device parity remain required.','Initialization adds second shader module and eleventh pipeline. Measure cold init and first dispatch separately; driver compilation may be deferred.','Eligibility CPU cost and extra mixed-batch pipeline switches remain.']}
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
