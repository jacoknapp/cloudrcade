#include <array>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <vector>
#include "GsPixelFormats.h"
#include "CloudReadbackRange.h"
#include "maybe_unused.h"

static unsigned checks=0, cases=0, partial=0;
static void require(bool b,const char* text) { ++checks; if(!b)throw std::runtime_error(text); }
class Reader {
public:
 using BITBLTBUF=CGSHandler::BITBLTBUF;
 using TRXPOS=CGSHandler::TRXPOS;
 using TRXREG=CGSHandler::TRXREG;
 uint64 m_nReg[128]{};
 struct { uint32 nSize=0,nRRX=0,nRRY=0; } m_trxCtx;
 uint8* memory=nullptr;
 using Handler=void(Reader::*)(void*,uint32);
 Handler m_transferReadHandlers[64]{};
 uint8* GetRam() { return memory; }
 template<typename Storage> void TransferReadHandlerGeneric(void*,uint32);
 template<typename Storage> void TransferReadHandler24(void*,uint32);
 void TransferReadHandlerPSMT8H(void*,uint32);
 void ReadImageDataImpl(void*,uint32);
};
#include "readers.inc"
static std::vector<uint8> vram(CloudReadbackRange::MemorySize),shadow(vram.size());

template<typename Storage>
static void check(uint32 psm,uint32 bp,uint32 bw,uint32 x,uint32 y,uint32 width,
                  uint32 rx,uint32 ry,uint32 bytes,bool packed24=false,bool high=false) {
 const auto range=CloudReadbackRange::Plan(psm,bp,bw,x,y,width,rx,ry,bytes);
 require(range.bytes && range.offset%4==0 && range.bytes%4==0 && range.offset+range.bytes<=vram.size(),"bounded aligned range");
 ++cases; if(range.bytes<vram.size())++partial;
 std::fill(shadow.begin(),shadow.end(),0xa5);
 std::memcpy(shadow.data()+range.offset,vram.data()+range.offset,range.bytes);
 Reader full,part;
 for(auto* r:{&full,&part}) {
  r->m_nReg[GS_REG_BITBLTBUF]=(bp/256)|(uint64(bw)<<16)|(uint64(psm)<<24);
  r->m_nReg[GS_REG_TRXPOS]=x|(uint64(y)<<16);
  r->m_nReg[GS_REG_TRXREG]=width;
  r->m_trxCtx.nRRX=rx; r->m_trxCtx.nRRY=ry;
  r->m_trxCtx.nSize=0; // Synthetic nominal-size mismatch; actual DMA size drives the reader.
  r->m_transferReadHandlers[psm]=high?&Reader::TransferReadHandlerPSMT8H:
   packed24?&Reader::TransferReadHandler24<Storage>:&Reader::TransferReadHandlerGeneric<Storage>;
 }
 full.memory=vram.data();part.memory=shadow.data();
 std::vector<uint8> a(bytes+16,0x37),b=a;
 full.ReadImageDataImpl(a.data(),bytes);part.ReadImageDataImpl(b.data(),bytes);
 require(a==b,"verbatim reader output/guard mismatch");
 require(full.m_trxCtx.nRRX==part.m_trxCtx.nRRX && full.m_trxCtx.nRRY==part.m_trxCtx.nRRY,"reader cursor mismatch");
 const uint64 pixels=high?bytes:packed24?(uint64(bytes)+2)/3:bytes/sizeof(typename Storage::Unit);
 CGsPixelFormats::CPixelIndexor<Storage> indexor(vram.data(),bp,bw);
 for(uint64 i=0;i<pixels;++i) {
  auto* address=reinterpret_cast<uint8*>(indexor.GetPixelAddress((rx+x)%2048,(ry+y)%2048));
  const auto offset=std::size_t(address-vram.data());
  require(offset>=range.offset && offset+sizeof(typename Storage::Unit)<=range.offset+range.bytes,"actual swizzle escapes range");
  ++rx;if(rx==width){rx=0;++ry;}
 }
}
static void run(uint32 psm,uint32 bp,uint32 bw,uint32 x,uint32 y,uint32 w,uint32 rx,uint32 ry,uint32 bytes) {
 switch(psm) {
 case 0x00:check<CGsPixelFormats::STORAGEPSMCT32>(psm,bp,bw,x,y,w,rx,ry,bytes);break;
 case 0x30:check<CGsPixelFormats::STORAGEPSMZ32>(psm,bp,bw,x,y,w,rx,ry,bytes);break;
 case 0x01:check<CGsPixelFormats::STORAGEPSMCT32>(psm,bp,bw,x,y,w,rx,ry,bytes,true);break;
 case 0x31:check<CGsPixelFormats::STORAGEPSMZ32>(psm,bp,bw,x,y,w,rx,ry,bytes,true);break;
 case 0x02:check<CGsPixelFormats::STORAGEPSMCT16>(psm,bp,bw,x,y,w,rx,ry,bytes);break;
 case 0x3a:check<CGsPixelFormats::STORAGEPSMZ16S>(psm,bp,bw,x,y,w,rx,ry,bytes);break;
 case 0x13:check<CGsPixelFormats::STORAGEPSMT8>(psm,bp,bw,x,y,w,rx,ry,bytes);break;
 case 0x1b:check<CGsPixelFormats::STORAGEPSMCT32>(psm,bp,bw,x,y,w,rx,ry,bytes,false,true);break;
 }
}
int main(){try{
 for(std::size_t i=0;i<vram.size();++i)vram[i]=uint8((i*0x45d9f3bu)^(i>>7));
 const auto kh=CloudReadbackRange::Plan(0x31,3584*256,8,494,273,8,0,0,96);
 require(kh.bytes==8192 && kh.offset==0x16e000,"measured Z24 pages");
 for(uint32 psm:{0x00u,0x30u,0x01u,0x31u,0x02u,0x3au,0x13u,0x1bu}) {
  for(uint32 bw:{0u,1u,2u,7u,8u,63u})for(uint32 xy:{0u,31u,63u,64u,127u,2047u}) {
   run(psm,256,bw,xy,xy,8,0,0,16);
   run(psm,0xe0000,bw,xy,xy,8,7,0,96); // Repeated/mismatched-size continuation.
   run(psm,0x3fff00,bw,xy,xy,8,0,0,17); // RAM wrap/24-bit padding.
  }
 }
 uint32 random=0x193a35;
 const auto next=[&](){random^=random<<13;random^=random>>17;random^=random<<5;return random;};
 const uint32 psms[]={0,0x30,1,0x31,2,0x3a,0x13,0x1b};
 for(unsigned i=0;i<700;++i){
  const auto p=psms[next()%8],bp=(next()%16384)*256,bw=next()%64,x=next()%2048,y=next()%2048,w=1+next()%3000;
  const auto rx=next()%w,ry=next()%30,bytes=next()%2049;
  run(p,bp,bw,x,y,w,rx,ry,bytes);
 }
 for(uint32 p:{3u,0x14u,0x24u,0x2cu,0x32u,0xffu})require(CloudReadbackRange::Plan(p,0,1,0,0,8,0,0,16).bytes==vram.size(),"unsupported full fallback");
 require(CloudReadbackRange::Plan(0,0,1,0,0,0,0,0,16).bytes==vram.size(),"zero width fallback");
 require(partial>100,"missing meaningful partial coverage");
 std::cout<<"PASS actual GS indexor/reader cases="<<cases<<" partial="<<partial<<" byte/address/cursor checks="<<checks<<'\n';
}catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
