// Compiles the candidate's real WebGPUTexture.cpp. Only command transport,
// graphics owner and utility configuration are stubbed; format conversion uses
// the actual pinned Dolphin TextureDecoder_Generic.cpp.
#include <algorithm>
#include <array>
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <vector>
#include "VideoBackends/WebGPU/WebGPUTexture.h"
#include "VideoBackends/WebGPU/WebGPUGfx.h"
#include "VideoCommon/VideoConfig.h"
VideoConfig g_ActiveConfig;
std::unique_ptr<WebGPU::WebGPUGfx> g_gfx=std::make_unique<WebGPU::WebGPUGfx>();
static unsigned mask=2, decodes=0;
extern "C" unsigned DolphinWeb_GetRendererFeatureMask() {return mask;}
AbstractTexture::AbstractTexture(const TextureConfig& c):m_config(c){}
void AbstractTexture::FinishedRendering(){}
u32 AbstractTexture::GetTexelSizeForFormat(AbstractTextureFormat) {return 4;}
const TextureConfig& AbstractTexture::GetConfig() const {return m_config;}
size_t TextureConfig::GetMipStride(u32 level) const{return std::max(width>>level,1u)*4;}
int TexDecoder_GetBlockWidthInTexels(TextureFormat f) {
 return f==TextureFormat::I4||f==TextureFormat::I8||f==TextureFormat::IA4||f==TextureFormat::C4||f==TextureFormat::C8||f==TextureFormat::CMPR?8:4;
}
int TexDecoder_GetBlockHeightInTexels(TextureFormat f) {return f==TextureFormat::I4||f==TextureFormat::C4||f==TextureFormat::CMPR?8:4;}
int TexDecoder_GetTextureSizeInBytes(int w,int h,TextureFormat f) {return w/TexDecoder_GetBlockWidthInTexels(f)*(h/TexDecoder_GetBlockHeightInTexels(f))*(f==TextureFormat::RGBA8?64:32);}
int TexDecoder_GetPaletteSize(TextureFormat f) {return f==TextureFormat::C4?32:f==TextureFormat::C8?512:f==TextureFormat::C14X2?32768:0;}
void TexDecoder_Decode(u8* dst,const u8* src,int w,int h,TextureFormat f,const u8* pal,TLUTFormat pf){++decodes;_TexDecoder_DecodeImpl(reinterpret_cast<u32*>(dst),src,w,h,f,pal,pf);}
void TexDecoder_DecodeXFB(u8*,const u8*,u32,u32,u32){std::abort();}
int main() {
 using namespace WebGPU;
 const std::array<TextureFormat,11> formats={TextureFormat::I4,TextureFormat::I8,TextureFormat::IA4,TextureFormat::IA8,TextureFormat::RGB565,TextureFormat::RGB5A3,TextureFormat::RGBA8,TextureFormat::C4,TextureFormat::C8,TextureFormat::C14X2,TextureFormat::CMPR};
 unsigned cases=0;
 for(auto f:formats) for(unsigned pf=0;pf<(IsColorIndexed(f)?3u:1u);++pf) {
  TextureConfig config(13,9,4,1,1,AbstractTextureFormat::RGBA8,0,AbstractTextureType::Texture_2DArray);
  WebGPUTexture texture(config),copy(config);
  assert(stream.usage&8);
  for(u32 level=0;level<4;level++) {
   const u32 w=std::max(13u>>level,1u),h=std::max(9u>>level,1u);
   const u32 bw=TexDecoder_GetBlockWidthInTexels(f),bh=TexDecoder_GetBlockHeightInTexels(f);
   const u32 aw=(w+bw-1)/bw*bw,ah=(h+bh-1)/bh*bh;
   std::vector<u8> src(TexDecoder_GetTextureSizeInBytes(aw,ah,f)),pal(TexDecoder_GetPaletteSize(f)),expected(aw*ah*4);
   for(size_t i=0;i<src.size();i++)src[i]=(i*137+level*7+pf*13)&255;
   for(size_t i=0;i<pal.size();i++)pal[i]=(i*73+pf*23)&255;
   _TexDecoder_DecodeImpl(reinterpret_cast<u32*>(expected.data()),src.data(),aw,ah,f,pal.data(),static_cast<TLUTFormat>(pf));
   events.clear();unsigned before=decodes;
   assert(texture.LoadEncoded(level,w,h,aw,ah,src.data(),src.size(),f,pal.data(),static_cast<TLUTFormat>(pf)));
   assert((events==std::vector<int>{1,2,3}));
   assert(decodes==before&&stream.mip==level&&stream.width==w&&stream.height==h&&stream.aligned==aw);
   assert(stream.packet.size()==16+src.size()+pal.size());
   assert(std::equal(src.begin(),src.end(),stream.packet.begin()+16));
   assert(std::equal(pal.begin(),pal.end(),stream.packet.begin()+16+src.size()));
   // The guest may rewrite RAM/TMEM/palette immediately after cache creation.
   std::fill(src.begin(),src.end(),0);std::fill(pal.begin(),pal.end(),0);
   const auto* actual=static_cast<const WebGPUTexture&>(texture).GetData(0,level);
   assert(decodes==before+1);
   for(u32 y=0;y<h;y++)assert(std::equal(actual+y*w*4,actual+(y+1)*w*4,expected.begin()+y*aw*4));
   texture.GetData(0,level);assert(decodes==before+1);
   MathUtil::Rectangle<int> rect(0,0,w,h);
   events.clear();
   copy.CopyRectangleFromTexture(&texture,rect,0,level,rect,0,level);
   assert((events==std::vector<int>{1,5}));
   assert(std::equal(copy.GetData(0,level),copy.GetData(0,level)+w*h*4,actual));
   events.clear();
   copy.ResolveFromTexture(&texture,rect,0,level);
   assert((events==std::vector<int>{1,5}));
   // Pool reuse with a new palette/input replaces the prior deferred shadow.
   assert(texture.LoadEncoded(level,w,h,aw,ah,src.data(),src.size(),f,pal.data(),static_cast<TLUTFormat>(pf)));
   std::vector<u8> replacement(w*h*4,0x37);
   before=decodes;events.clear();texture.Load(level,w,h,w,replacement.data(),replacement.size(),0);
   assert((events==std::vector<int>{1,2,4}));
   assert(decodes==before);
   assert(std::equal(texture.GetData(0,level),texture.GetData(0,level)+replacement.size(),replacement.begin()));
   ++cases;
  }
 }
 TextureConfig c(8,8,1,1,1,AbstractTextureFormat::RGBA8,0,AbstractTextureType::Texture_2DArray);
 WebGPUTexture t(c);std::array<u8,32> src{};
 auto load=[&] {return t.LoadEncoded(0,8,8,8,8,src.data(),src.size(),TextureFormat::I4,nullptr,TLUTFormat::IA8);};
 mask=0;assert(!load());mask=2;
 g_ActiveConfig.bArbitraryMipmapDetection=true;assert(!load());g_ActiveConfig.bArbitraryMipmapDetection=false;
 g_ActiveConfig.bTexFmtOverlayEnable=true;assert(!load());g_ActiveConfig.bTexFmtOverlayEnable=false;
 g_ActiveConfig.bDumpTextures=true;assert(!load());g_ActiveConfig.bDumpTextures=false;
 stream.fail_alloc=true;assert(!load());stream.fail_alloc=false;
 stream.fail_push=true;assert(!load());stream.fail_push=false;
 assert(!t.LoadEncoded(0,7,8,8,8,src.data(),32,TextureFormat::I4,nullptr,TLUTFormat::IA8));
 assert(!t.LoadEncoded(0,8,8,16,8,src.data(),32,TextureFormat::I4,nullptr,TLUTFormat::IA8));
 assert(!t.LoadEncoded(0,8,8,8,8,src.data(),31,TextureFormat::I4,nullptr,TLUTFormat::IA8));
 assert(load());
 c.format=AbstractTextureFormat::BGRA8;WebGPUTexture bgra(c);assert(!(stream.usage&8));
 assert(!bgra.LoadEncoded(0,8,8,8,8,src.data(),32,TextureFormat::I4,nullptr,TLUTFormat::IA8));
 std::printf("PASS %u native format/TLUT/mip snapshots, lazy CPU parity, copies, replacement, feature/config/shape/allocation fallback\n",cases);
}
