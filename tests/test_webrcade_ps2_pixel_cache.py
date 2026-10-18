#!/usr/bin/env python3
"""CPU-only exact-helper/address proof; device shader/VRAM gates remain separate.
Usage: python3 tests/test_webrcade_ps2_pixel_cache.py --source GENERATED_CLOUDGPU --output SCRATCH
"""
from pathlib import Path
import argparse,re,subprocess,json,hashlib
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
root=Path(__file__).resolve().parents[1];gpu=root/'deploy/webrcade/retro-play/gpu'
# The tested cache-helper statements are the actual WGSL source with mechanical
# scalar syntax translation, not an independently rewritten cache algorithm.
s=(gpu/'pixel-cache.wgsl').read_text()
s=re.sub(r'var<private> (\w+): (\w+)([^;]*);',lambda m:m[2]+' '+m[1]+m[3]+';',s)
def function(m):
 args=', '.join(t.strip().split(': ')[1]+' '+t.strip().split(': ')[0] for t in m[2].split(',') if t.strip())
 return (m[3] or 'void')+' '+m[1]+'('+args+') {'
s=re.sub(r'fn (\w+)\(([^)]*)\)(?: -> (\w+))? \{',function,s)
# Mechanically translate actual format/address helpers as well; read packed tables
# from the actual generated CPU implementation.
shader=(a.source/'gs.wgsl').read_text()
address=shader[shader.index('fn fmt_of('):shader.index('fn load_at(')]
address=re.sub(r'fn (\w+)\(([^)]*)\)(?: -> (\w+))? \{',function,address)
address=re.sub(r'\bvar (\w+) =',r'auto \1 =',address)
address=re.sub(r'\blet (\w+) =',r'const auto \1 =',address)
address=address.replace('switch psm {','switch(psm) {')
address=re.sub(r'case (\w+) \{',r'case \1: {',address).replace('default {','default: {')
address=address.replace('\n        }','\n            break;\n        }')
address=address.replace('max(1u,','std::max(1u,')
constants=shader[shader.index('const T_OFF32'):shader.index('const CLUT_ENTRIES')]
constants=re.sub(r'const (\w+): u32',r'const u32 \1',constants)
s=constants+'\nstruct Fmt {u32 base,per_row,table,bits,mask;};\nstd::vector<u32> tables;\n'+address+'\n'+s
prefix=r'''
#include "pixel-cache.hpp"
#include <array>
#include <vector>
#include <set>
#include <cassert>
#include <iostream>
using u32=std::uint32_t;
struct Loc {u32 word,shift,mask;};
std::array<u32,8> vram{};
u32 atomicLoad(u32*p){return *p;} void atomicStore(u32*p,u32 v){*p=v;}
u32 load_at(Loc l,u32){return (vram[l.word]>>l.shift)&l.mask;}
void store(Loc l,u32,u32 v){vram[l.word]=(vram[l.word]&~(l.mask<<l.shift))|((v&l.mask)<<l.shift);}
namespace ps2::gs {void build_tables();void swizzle_tables(std::vector<u32>&);extern u32 g_off32[32][64],g_offz32[32][64];}
'''
tests=r'''
std::uint64_t checks=0;
void check(bool v){++checks;assert(v);}
u32 random_word(){static u32 x=0x34a82f19;x^=x<<13;x^=x>>17;x^=x<<5;return x;}
void reset_cache(){cloud_pixel_cache=true;cloud_fb_valid=cloud_z_valid=cloud_fb_dirty=cloud_z_dirty=false;cloud_fb_value=cloud_z_value=0;}
int main(){
 using namespace CloudPixelCache;std::array<u32,50>w{};w[2]=8;w[5]=8192;w[6]=49;w[24]=0xffffffffu;
 auto eligible=[&](){return Eligible(w.data(),25,0,0,511,255,1,0);};check(eligible());
 w[3]=1;check(!eligible());w[3]=0;w[6]=50;check(!eligible());w[6]=49;
 check(!Eligible(w.data(),25,0,0,512,255,1,0));check(!Eligible(w.data(),25,0,0,511,255,2,0));check(!Eligible(w.data(),25,0,0,511,255,1,1));
 w[5]=0;check(!eligible());w[5]=8192;w[1]=16352;check(!eligible());w[1]=0;w[5]=8193;check(!eligible());w[5]=8192;
 w[0]=2;w[12]=4096;w[13]=8;w[14]=0;w[15]=4|(4u<<8);check(eligible());
 w[12]=0;check(!eligible());w[24]=0;check(eligible());w[24]=0xffffffffu;w[12]=4096;
 w[14]=63;check(!eligible());w[14]=0;w[12]=16383;w[15]=10|(10u<<8);check(!eligible());w[12]=4096;w[15]=4|(4u<<8);
 w[7]=2u<<24;w[18]=100u|(20u<<16);check(!eligible());w[7]=3u<<24;w[18]=512u|(256u<<16);Range r{};check(TextureRange(w.data(),r));check(r.hi>=u32(4096)*256u+(768u/64u+1u)*8192u);
 std::copy(w.begin(),w.begin()+25,w.begin()+25);check(Eligible(w.data(),50,0,0,511,255,1,0));w[25+2]=9;check(!Eligible(w.data(),50,0,0,511,255,1,0));
 // Actual swizzle tables prove target word ownership and raw address containment.
 ps2::gs::build_tables();
 for(unsigned bw:{1u,3u,8u,31u})for(unsigned bp:{0u,32u,8192u}){
  const unsigned width=std::min(bw*64u,2048u),height=64;
  std::set<u32> f,z;
  const u32 lo=bp*256u,hi=lo+(bw+((width-1)/64)+1)*8192u;
  for(unsigned y=0;y<height;y++)for(unsigned x=0;x<width;x++){
   const u32 base=lo+(x/64+(y/32)*bw)*8192;
   const auto fa=base+ps2::gs::g_off32[y%32][x%64],za=base+ps2::gs::g_offz32[y%32][x%64];
   check(fa>=lo&&fa+4<=hi&&za>=lo&&za+4<=hi);check(f.insert(fa/4).second);check(z.insert(za/4).second);
  }
 }
 // All supported texture formats: actual shader addressing remains contained
 // in conservative host intervals, including non-page-aligned base pointers.
 ps2::gs::swizzle_tables(tables);
 for(unsigned psm:{0u,1u,2u,10u,19u,20u,27u,36u,44u,48u,49u,50u,58u})for(unsigned bw:{0u,1u,3u,8u})for(unsigned bp:{0u,1u,4095u}){
  std::array<u32,25> tex{};tex[12]=bp;tex[13]=bw;tex[14]=psm;tex[15]=8u|(8u<<8);Range bound{};check(TextureRange(tex.data(),bound));const auto fmt=fmt_of(psm,bp,bw);
  for(unsigned y=0;y<256;y++)for(unsigned x=0;x<256;x++){const auto l=addr(fmt,x,y);check(std::uint64_t(l.word)*4>=bound.lo&&std::uint64_t(l.word)*4+4<=bound.hi);}
  tex[7]=(3u<<24)|(3u<<26);tex[18]=512u|(256u<<16);tex[19]=512u|(128u<<16);check(TextureRange(tex.data(),bound));
  for(unsigned y=0;y<1024;y+=7)for(unsigned x=0;x<1024;x+=7){const auto l=addr(fmt,(x&512u)|256u,(y&512u)|128u);check(std::uint64_t(l.word)*4>=bound.lo&&std::uint64_t(l.word)*4+4<=bound.hi);}
 }
 // Execute actual translated WGSL helpers through many ordered masked-color,
 // destination-alpha, depth-test and Z24/Z32 updates, including rejected writes.
 for(unsigned mode=0;mode<2;mode++)for(unsigned n=0;n<20000;n++){
  const u32 initialF=random_word(),initialZ=random_word(),zm=mode?0xffffffffu:0xffffffu;
  vram.fill(0x5a5a5a5a);vram[2]=initialF;vram[5]=initialZ;u32 expectedF=initialF,expectedZ=initialZ;reset_cache();
  for(unsigned step=0;step<8;step++){
   const u32 color=random_word(),depth=random_word()&zm,mask=random_word();
   check(cloud_read_frame({2,0,0xffffffffu},0)==expectedF);
   check(cloud_read_depth({5,0,zm},0)==(expectedZ&zm));
   const bool date=((expectedF>>31)==(color>>31)),zpass=depth>=(expectedZ&zm);
   const unsigned afail=(color>>8)&3u;const bool alpha=(color>>24)>127;
   if(date&&zpass){
    if(alpha||afail==1||afail==3){const auto m=mask|((!alpha&&afail==3)?0xff000000u:0u);const auto value=(color&~m)|(expectedF&m);cloud_write_frame({2,0,0xffffffffu},0,value);expectedF=value;}
    if(alpha||afail==2){cloud_write_depth({5,0,zm},0,depth);expectedZ=(expectedZ&~zm)|(depth&zm);}
   }
  }
  cloud_commit_pixel();check(vram[2]==expectedF);check(vram[5]==expectedZ);if(!mode)check((vram[5]&0xff000000u)==(initialZ&0xff000000u));check(vram[0]==0x5a5a5a5a&&vram[7]==0x5a5a5a5a);
 }
 // Write-before-read and disabled fallback, including packed neighboring words.
 reset_cache();vram[5]=0xaabbccdd;cloud_write_depth({5,0,0xffffff},0,0x123456);check(cloud_read_depth({5,0,0xffffff},0)==0x123456);cloud_commit_pixel();check(vram[5]==0xaa123456);
 cloud_pixel_cache=false;vram[2]=0xaabbccdd;cloud_write_frame({2,16,0xffff},0,0x1234);check(vram[2]==0x1234ccdd);check(cloud_read_frame({2,16,0xffff},0)==0x1234);
 std::cout<<"{\"checks\":"<<checks<<",\"gpuExecuted\":false}"<<std::endl;
}
'''
source=a.output/'fixture.cpp';source.write_text(prefix+s+tests)
cmd=['g++','-std=c++20','-O2','-ffunction-sections','-fdata-sections','-Wl,--gc-sections','-I'+str(gpu),str(source),str(a.source/'state.cpp'),'-o',str(a.output/'fixture')]
subprocess.run(cmd,check=True);r=subprocess.run([str(a.output/'fixture')],check=True,text=True,capture_output=True);print(r.stdout.strip())
(a.output/'result.json').write_text(json.dumps({'result':json.loads(r.stdout),'pins':{str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in [gpu/'pixel-cache.hpp',gpu/'pixel-cache.wgsl',source,a.source/'state.cpp']},'limit':'Mechanical scalar WGSL helper translation and actual CPU swizzle tables; no shader compiler/device proof.'},indent=2))
