// Conservative eligibility for invocation-private framebuffer/depth words.
#pragma once
#include <algorithm>
#include <cstddef>
#include <cstdint>
namespace CloudPixelCache {
constexpr std::uint64_t MemoryBytes=4u*1024u*1024u;
struct Range {
 std::uint64_t lo,hi;
 bool overlaps(const Range& other) const { return lo<other.hi && other.lo<hi; }
};
inline bool TextureRange(const std::uint32_t* w,Range& out) {
 unsigned pw=64,ph=32;
 switch(w[14]) {
 case 0:case 1:case 48:case 49:case 27:case 36:case 44:break;
 case 2:case 10:case 50:case 58:ph=64;break;
 case 19:pw=128;ph=64;break;
 case 20:pw=128;ph=128;break;
 default:return false;
 }
 const auto tw=w[15]&255u,th=w[15]>>8;
 if(tw>10||th>10||w[12]>16383||w[13]>63)return false;
 auto extent=[](unsigned size,unsigned mode,unsigned region,unsigned& end){
  const unsigned mn=region&1023u,mx=(region>>16)&1023u;
  if(mode==2&&mn>mx)return false;
  end=(1u<<size)-1;
  if(mode==2)end=std::max(end,mx);
  if(mode==3)end=std::max(end,mn|mx);
  return true;
 };
 unsigned x,y;
 if(!extent(tw,(w[7]>>24)&3u,w[18],x)||!extent(th,(w[7]>>26)&3u,w[19],y))return false;
 const auto perRow=std::max(1u,w[13]*64u/pw);
 out={std::uint64_t(w[12])*256u,std::uint64_t(w[12])*256u+(std::uint64_t(x/pw)+std::uint64_t(y/ph)*perRow+1u)*8192u};
 return out.hi<=MemoryBytes;
}
inline bool Eligible(const std::uint32_t* setups,std::size_t words,int x0,int y0,int x1,int y1,unsigned scale,unsigned snapshot) {
 if(scale!=1||snapshot||!setups||!words||words%25||x0<0||y0<0||x0>x1||y0>y1||x1>2047||y1>2047)return false;
 const auto* first=setups;
 if(first[3]!=0||(first[6]!=48&&first[6]!=49)||!first[2]||first[2]>63||x1>=int(first[2]*64)||first[1]%32||first[5]%32)return false;
 auto target=[&](unsigned bp){return Range{std::uint64_t(bp)*256u+(std::uint64_t(x0/64)+std::uint64_t(y0/32)*first[2])*8192u,std::uint64_t(bp)*256u+(std::uint64_t(x1/64)+std::uint64_t(y1/32)*first[2]+1u)*8192u};};
 const auto fb=target(first[1]),z=target(first[5]);
 if(fb.hi>MemoryBytes||z.hi>MemoryBytes||fb.overlaps(z))return false;
 for(std::size_t i=0;i<words;i+=25){const auto*w=setups+i;
  for(unsigned k:{1u,2u,3u,5u,6u})if(w[k]!=first[k])return false;
  if((w[0]&2u)&&w[24]==0xffffffffu){Range texture{};if(!TextureRange(w,texture)||texture.overlaps(fb)||texture.overlaps(z))return false;}
 }
 return true;
}
}
