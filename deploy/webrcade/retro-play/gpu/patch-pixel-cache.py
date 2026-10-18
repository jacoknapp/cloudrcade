"""Checked patch of the pinned renderer; standalone extraction only, no build."""
from pathlib import Path
import shutil

def patch(out):
    here=Path(__file__).resolve().parent
    p=out/'gpu.cpp';s=p.read_text()
    old='#include "timestamp-sampling.hpp"';assert s.count(old)==1
    s=s.replace(old,old+'\n#include "pixel-cache.hpp"')
    old='push_params({tile_offset, prim_offset, setup_offset, tiles, list_offset, snapshot_lo, snapshot_hi})'
    assert s.count(old)==1
    s=s.replace(old,'push_params({tile_offset, prim_offset, setup_offset, tiles, list_offset, snapshot_lo, snapshot_hi,\n        CloudPixelCache::Eligible(b.setups.data(), b.setups.size(), b.minx, b.miny, b.maxx, b.maxy, g_scale, snapshot) ? 1u : 0u})')
    p.write_text(s);shutil.copy2(here/'pixel-cache.hpp',out/'pixel-cache.hpp')
    p=out/'gs.wgsl';s=p.read_text()
    at=s.index('fn read_frame(');s=s[:at]+(here/'pixel-cache.wgsl').read_text()+'\n'+s[at:]
    start=s.index('fn read_frame(');end=s.index('\nstruct Attr',start)
    body=s[start:end].replace('load_at(', 'cloud_read_frame(').replace('store(', 'cloud_write_frame(')
    s=s[:start]+body+s[end:]
    old='let old = load_at(zl, k) & s.zmax;';assert s.count(old)==1
    s=s.replace(old,'let old = cloud_read_depth(zl, k) & s.zmax;')
    old='store(zl, k, z);';assert s.count(old)==1;s=s.replace(old,'cloud_write_depth(zl, k, z);')
    start=s.index('fn raster(');at=s.index('    var last_setup',start)
    s=s[:at]+'    cloud_pixel_cache = prm(7u) != 0u;\n'+s[at:]
    at=s.index('\n}\n',start);s=s[:at]+'\n    cloud_commit_pixel();'+s[at:]
    p.write_text(s)
