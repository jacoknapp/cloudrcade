"""Checked patch of the pinned renderer; standalone extraction only, no build."""
from pathlib import Path
import shutil
import hashlib
import re

def patch(out):
    here=Path(__file__).resolve().parent
    p=out/'gpu.cpp';s=p.read_text()
    old='#include "timestamp-sampling.hpp"';assert s.count(old)==1
    s=s.replace(old,old+'\n#include "pixel-cache.hpp"')
    old='push_params({tile_offset, prim_offset, setup_offset, tiles, list_offset, snapshot_lo, snapshot_hi})'
    assert s.count(old)==1
    s=s.replace(old,'push_params({tile_offset, prim_offset, setup_offset, tiles, list_offset, snapshot_lo, snapshot_hi,\n        CloudPixelCache::Eligible(b.setups.data(), b.setups.size(), b.minx, b.miny, b.maxx, b.maxy, g_scale, snapshot) ? 1u : 0u})')
    old='g_commands.push_back({kRaster, std::min(tiles, 1024u), (tiles + 1023) / 1024, param});'
    assert s.count(old)==1
    s=s.replace(old,'g_commands.push_back({g_param_records[param][7] ? kRasterCached : kRaster, std::min(tiles, 1024u), (tiles + 1023) / 1024, param});')
    old='kDecode, kComposite, kPipelines';assert s.count(old)==1
    s=s.replace(old,'kDecode, kComposite, kRasterCached, kPipelines')
    old='"decode", "cloud_composite"};';assert s.count(old)==1
    s=s.replace(old,'"decode", "cloud_composite", "raster_cached"};')
    old='extern const char kGsShader[];';assert s.count(old)==1
    s=s.replace(old,old+'\nextern const char kGsCachedShader[];')
    old='    for (int i = 0; i < kPipelines; ++i) {\n        WGPUComputePipelineDescriptor'
    assert s.count(old)==1
    s=s.replace(old,"""    // Create the cached pipeline eagerly during renderer initialization.
    source.code = view(kGsCachedShader);
    WGPUShaderModule cached_module = wgpuDeviceCreateShaderModule(g_device, &md);
    for (int i = 0; i < kPipelines; ++i) {
        WGPUComputePipelineDescriptor""")
    old='        cd.compute.module = module;';assert s.count(old)==1
    s=s.replace(old,'        cd.compute.module = i == kRasterCached ? cached_module : module;')
    old='        if (!g_pipelines[i]) return false;';assert s.count(old)==1
    s=s.replace(old,'        if (!g_pipelines[i]) {\n            wgpuShaderModuleRelease(cached_module);\n            wgpuShaderModuleRelease(module);\n            return false;\n        }')
    old='    wgpuShaderModuleRelease(module);';assert s.count(old)==3
    old='    }\n    wgpuShaderModuleRelease(module);\n    ensure_capacity();';assert s.count(old)==1
    s=s.replace(old,'    }\n    wgpuShaderModuleRelease(cached_module);\n    wgpuShaderModuleRelease(module);\n    ensure_capacity();')
    p.write_text(s);shutil.copy2(here/'pixel-cache.hpp',out/'pixel-cache.hpp')
    p=out/'gs.wgsl';s=p.read_text()
    # Every existing pipeline receives the byte-identical qualified shader.
    assert hashlib.sha256(p.read_bytes()).hexdigest() == '31e291ac30243ea940e2f163493def590c62bb8a4bde8ccf6fa46f853becb25e'
    helpers=(here/'pixel-cache.wgsl').read_text()
    for line in [
        'var<private> cloud_pixel_cache: bool = false;\n',
        '    if (!cloud_pixel_cache) { return load_at(l, k); }\n',
        '    if (!cloud_pixel_cache) { store(l, k, value); return; }\n',
    ]:
        assert helpers.count(line) == (1 if line.startswith('var') else 2)
        helpers=helpers.replace(line,'')
    at=s.index('fn read_frame(');s=s[:at]+helpers+'\n'+s[at:]
    start=s.index('fn read_frame(');end=s.index('\nstruct Attr',start)
    body=s[start:end].replace('load_at(', 'cloud_read_frame(').replace('store(', 'cloud_write_frame(')
    s=s[:start]+body+s[end:]
    old='let old = load_at(zl, k) & s.zmax;';assert s.count(old)==1
    s=s.replace(old,'let old = cloud_read_depth(zl, k) & s.zmax;')
    old='store(zl, k, z);';assert s.count(old)==1;s=s.replace(old,'cloud_write_depth(zl, k, z);')
    start=s.index('fn raster(')
    at=s.index('\n}\n',start);s=s[:at]+'\n    cloud_commit_pixel();'+s[at:]
    s=s.replace('fn raster(', 'fn raster_cached(')
    # The second module exposes exactly one compute entry; shared helper bodies
    # remain unchanged apart from the target-cache substitutions above.
    for match in reversed(list(re.finditer(r'@compute @workgroup_size\([^\n]+\)\nfn (\w+)\(',s))):
        if match[1]=='raster_cached':continue
        body=s.index('{',match.end());end=body+1;depth=1
        while depth:
            depth+=(s[end]=='{')-(s[end]=='}');end+=1
        s=s[:match.start()]+s[end:]
    assert 'cloud_pixel_cache' not in s and 'prm(7u)' not in s
    assert re.findall(r'@compute[^\n]*\nfn (\w+)',s)==['raster_cached']
    (out/'gs-cached.wgsl').write_text(s)
