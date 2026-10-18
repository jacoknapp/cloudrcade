#include "gs.hpp"
#include <algorithm>
#include <array>
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>
using namespace ps2::gs;
#include "planner-actual.inc"
static std::uint64_t cases=0;
static void reset(unsigned setups,unsigned prims,unsigned tw=5,unsigned th=4){
 g_batch={};g_decode=true;g_scale=1;g_decoded_used=0;std::fill(std::begin(g_rendered),std::end(g_rendered),false);
 g_batch.setups.resize(setups*kSetupWords);g_batch.prims.resize(prims*kPrimWords);
 for(unsigned i=0;i<setups;i++){auto*w=g_batch.setups.data()+i*kSetupWords;w[0]=2;w[12]=32;w[13]=2;w[14]=PSMCT32;w[15]=tw|(th<<8);w[24]=~0u;}
 for(unsigned p=0;p<prims;p++){auto*r=g_batch.prims.data()+p*kPrimWords;r[0]=p%setups;r[2]=0;r[3]=0;}
}
static bool same_texture(const std::uint32_t*a,const std::uint32_t*b){
 if((a[0]&32768u)!=(b[0]&32768u))return false;
 for(int k:{12,13,14,15,16,17,20,22})if(a[k]!=b[k])return false;
 return true;
}
static void run(){
 ++cases;const auto input=g_batch;const auto used=g_decoded_used;
 reference_plan(input.prims.size()/kPrimWords);const auto reference=g_batch;const auto referenceJobs=g_decodes;
 g_batch=input;g_decoded_used=used;plan_decodes(input.prims.size()/kPrimWords);
 assert(g_batch.prims==input.prims && g_batch.boxes==input.boxes);
 for(unsigned i=0;i<g_batch.setups.size();i++)if(i%kSetupWords!=24)assert(g_batch.setups[i]==input.setups[i]);
 auto end=used;
 for(const auto& d:g_decodes){
  const auto*w=g_batch.setups.data()+d.setup*kSetupWords;
  assert(w[0]&2u);assert(d.words==(1u<<((w[15]&255u)+(w[15]>>8))));
  assert(d.offset==end && d.offset+d.words<=kDecodedWords);end+=d.words;
 }
 assert(end==g_decoded_used);
 for(unsigned i=0;i<g_batch.setups.size()/kSetupWords;i++){
  const auto*w=g_batch.setups.data()+i*kSetupWords;if(w[24]==~0u)continue;
  auto found=std::find_if(g_decodes.begin(),g_decodes.end(),[&](const Decode& d){return d.offset==w[24]&&same_texture(w,g_batch.setups.data()+d.setup*kSetupWords);});assert(found!=g_decodes.end());
 }
 // A control path with decode disabled has identical state/primitive inputs;
 // candidate only selects existing direct-read versus decoded sampling offsets.
 if(!g_decode||input.prims.size()/kPrimWords<=kDecodePrims){assert(g_decodes.empty());assert(g_batch.setups==reference.setups);assert(referenceJobs.empty());}
}
int main(){
 // 512 texels versus at most260 bilinear fetches: use direct texture reads.
 reset(1,65);run();assert(g_decodes.empty()&&g_decoded_used==0);
 // Inclusive boundary:128 bounding-box pixels*4 ==512 decoded texels.
 reset(1,65);g_batch.prims[3]=63;run();assert(g_decodes.size()==1&&g_decoded_used==512);
 reset(1,65);g_batch.prims[3]=62;run();assert(g_decodes.empty());
 // Same texture under alternating unrelated drawing flags shares total use.
 reset(2,65);g_batch.setups[kSetupWords]|=8;g_batch.prims[3]=63;run();assert(g_decodes.size()==1);assert(g_batch.setups[24]==g_batch.setups[kSetupWords+24]);
 // Untextured primitives with a large box cannot justify a tiny texture draw.
 reset(2,65);g_batch.setups[kSetupWords]=0;for(unsigned p=0;p<65;p++)if(p&1)g_batch.prims[p*kPrimWords+3]=0x03ff03ff;run();assert(g_decodes.empty());
 // Each original texture identity field keeps unrelated textures distinct.
 for(unsigned key:{0u,12u,13u,14u,15u,16u,17u,20u,22u}){
  reset(2,66,3,3);g_batch.setups[kSetupWords+key]^=key==0?32768u:1u;run();assert(g_decodes.size()==2);
 }
 // Internal resolution multiplies fetch opportunities; rendered scaled sources
 // still retain the original fallback restriction.
 reset(1,65);g_scale=2;run();assert(g_decodes.size()==1);
 reset(1,65);g_scale=3;std::fill(std::begin(g_rendered),std::end(g_rendered),true);run();assert(g_decodes.empty());
 // Ineligible region clamp and disabled/small-batch cases remain direct reads.
 reset(1,65);g_batch.setups[7]=2u<<24;g_batch.setups[18]=1023;run();assert(g_decodes.empty());
 reset(1,65);g_decode=false;run();assert(g_decodes.empty());
 reset(1,64);run();assert(g_decodes.empty());
 // Skipping an unhelpful large texture preserves capacity for a later texture.
 reset(2,66,10,10);g_batch.setups[kSetupWords+15]=3|(3u<<8);g_batch.setups[kSetupWords+12]++;g_decoded_used=kDecodedWords-64;run();assert(g_decodes.size()==1&&g_decodes[0].setup==1&&g_decoded_used==kDecodedWords);
 // Deterministic scheduling differential across formats, identity, scale,
 // clipping boxes and capacity. No texture/register bytes from any game.
 std::uint32_t r=0x12345678;
 auto random=[&](){r^=r<<13;r^=r>>17;r^=r<<5;return r;};
 for(int test=0;test<2000;test++){
  const auto setups=1+random()%8,prims=65+random()%200;reset(setups,prims,2+random()%7,2+random()%7);g_scale=1+random()%3;
  for(unsigned i=0;i<setups;i++){auto*w=g_batch.setups.data()+i*kSetupWords;w[0]=(random()&1)?2:0;w[12]+=random()%4;w[22]=random()%3;w[20]=random()%2;if(random()&1)w[0]|=32768;}
  for(unsigned p=0;p<prims;p++){auto*v=g_batch.prims.data()+p*kPrimWords;v[3]=(random()%32)|((random()%32)<<16);}
  g_decoded_used=(random()%5)*(kDecodedWords/5);run();
 }
 std::printf("PASS %llu exact planner cases: bounds, shared identities, direct fallback, inclusive cost, scale, budgets and untouched inputs\n",(unsigned long long)cases);
}
