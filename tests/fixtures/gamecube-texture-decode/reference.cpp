#include "VideoCommon/TextureDecoder.h"
#include <cstdio>
#include <cstdlib>
#include <vector>
void TexDecoder_DecodeXFB(u8*,const u8*,u32,u32,u32) { std::abort(); }
int main(int argc, char** argv) {
 if(argc!=6) return 2;
 int f=std::atoi(argv[1]), w=std::atoi(argv[2]), h=std::atoi(argv[3]), pf=std::atoi(argv[4]), ps=std::atoi(argv[5]);
 std::vector<u8> src(w*h*4 + ps),pal(ps),dst(w*h*4);
 const size_t n=std::fread(src.data(),1,src.size(),stdin);
 if(n<static_cast<size_t>(ps)) return 3;
 if(ps) { std::copy(src.begin()+n-ps,src.begin()+n,pal.begin()); }
 _TexDecoder_DecodeImpl(reinterpret_cast<u32*>(dst.data()),src.data(),w,h,static_cast<TextureFormat>(f),pal.data(),static_cast<TLUTFormat>(pf));
 return std::fwrite(dst.data(),1,dst.size(),stdout)==dst.size()?0:4;
}
