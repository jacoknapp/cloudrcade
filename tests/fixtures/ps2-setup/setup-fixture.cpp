// Exact generated parser and make_setup/cache prefix are supplied by the driver.
// GPU transfer/state operations below are observers, not a software renderer.
#include "gpu.hpp"
#include <algorithm>
#include <array>
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iterator>
#include <vector>
namespace ps2::gs {
void write(std::uint32_t, std::uint64_t);
extern std::uint32_t cbp0, cbp1;
extern std::uint64_t g_primitives, g_writes[128];
}
namespace ps2::gs::gpu {
static std::uint64_t setupMisses=0, draws=0, clutLoads=0, imageBegins=0, imageData=0, copies=0;
static std::uint64_t digest=1469598103934665603ull;
static std::uint32_t g_clut_slot=0, g_texflushes=0;
static struct { bool active=false; std::vector<std::uint8_t> pending; } g_image;
static std::vector<std::uint32_t> savedVram(kMemorySize/4), savedClut(512);
static std::array<std::uint32_t,128> savedTransfer{};
void hash(std::uint64_t v) { for(int i=0;i<8;i++) {digest^=(v>>(i*8))&255;digest*=1099511628211ull;} }
void inspect_setup(const State&, const Vertex*, int, std::uint32_t, const Context&, const std::uint32_t*, std::uint32_t, const struct SetupCache&);
void flush_image() { assert(!g_image.active); }
#include "cache-actual.inc"
void inspect_setup(const State& state,const Vertex* vertices,int count,std::uint32_t prim,const Context& context,const std::uint32_t* setup,std::uint32_t flags,const SetupCache& cache) {
 std::uint64_t attr=state.prim;
 if(!(state.prmodecont&1u))attr=(state.prim&7u)|(state.prmode&~7ull);
 std::array<std::uint32_t,kSetupWords> fresh{};
 const auto freshFlags=make_setup(state,attr,fresh.data());
 assert(flags==freshFlags && std::memcmp(setup,fresh.data(),sizeof fresh)==0);
 const auto key=std::uint64_t(fresh[1])|(std::uint64_t(fresh[2])<<14)|(std::uint64_t(fresh[3])<<20)|(std::uint64_t(fresh[5])<<26)|(std::uint64_t(fresh[6])<<40);
 assert(cache.key==key && cache.attr==attr && cache.clut==g_clut_slot);
 if(flags&2u) {
  const auto tw=fresh[15]&255u,th=fresh[15]>>8;
  const auto range=region(fresh[12],fresh[13],fresh[14],0,0,std::max(1<<tw,int(fresh[18]>>16)+1)-1,std::max(1<<th,int(fresh[19]>>16)+1)-1);
  assert(cache.tex.lo==range.lo && cache.tex.hi==range.hi);
 }
 ++draws;hash(prim);hash(attr);hash(count);hash(context.xyoffset);
 for(const auto value:fresh)hash(value);
 for(int i=0;i<count;i++) {
  const auto& v=vertices[i];hash(v.x);hash(v.y);hash(v.z);hash(v.r);hash(v.g);hash(v.b);hash(v.a);hash(v.u);hash(v.v);hash(v.f);
  std::uint32_t bits[3];std::memcpy(bits,&v.q,sizeof bits);for(auto b:bits)hash(b);
 }
}
void image_begin(const State& s){++imageBegins;hash(s.trxreg);}
void image_data(const std::uint8_t* p,std::size_t n){++imageData;hash(n);for(std::size_t i=0;i<n;i++)hash(p[i]);}
void local_copy(const State& s){++copies;hash(s.trxpos);}
void load_clut(std::uint64_t tex0,std::uint64_t texclut){++clutLoads;++g_clut_slot;hash(tex0);hash(texclut);}
void texflush(){++g_texflushes;}
void reset_timestamp_collection(){}
void read_state(std::vector<std::uint32_t>& v,std::uint32_t& scale,std::vector<std::uint32_t>& c){v=savedVram;c=savedClut;scale=1;}
void write_state(const std::vector<std::uint32_t>& v,std::uint32_t scale,const std::vector<std::uint32_t>& c){assert(scale==1);savedVram=v;savedClut=c;}
void save_transfer(std::uint32_t* out){std::copy(savedTransfer.begin(),savedTransfer.end(),out);}
void load_transfer(const std::uint32_t* p){std::copy(p,p+128,savedTransfer.begin());g_setup_cache={};}
}
using namespace ps2::gs;
#define EMSCRIPTEN_KEEPALIVE
static std::vector<std::uint8_t> snapshot;
static constexpr std::uint32_t magic=0x32534757;
static constexpr std::size_t stateSize=16+sizeof(State)+kMemorySize+512*4+512;
#include "bridge-actual.inc"
static void w(std::uint32_t r,std::uint64_t v){write(r,v);}
static void xyz(unsigned n,bool drawing=true){w(drawing?0x05:0x0d,std::uint64_t(16+n*16)|(std::uint64_t(32+n*16)<<16)|(std::uint64_t(123+n)<<32));}
static void primitive(unsigned type,std::uint64_t attr=0){w(0,type|attr);const int count=type==0?1:(type==1||type==2||type==6)?2:3;for(int i=0;i<count;i++)xyz(i);}
static void hashState(){
 using ps2::gs::gpu::hash;const auto& s=g_state;
 const std::uint64_t global[]={s.prim,s.prmode,s.prmodecont,s.rgbaq,s.st,s.uv,s.fog,s.texclut,s.scanmsk,s.texa,s.fogcol,s.dimx,s.dthe,s.colclamp,s.pabe,s.bitbltbuf,s.trxpos,s.trxreg,s.trxdir};
 for(auto value:global)hash(value);
 for(const auto& c:s.ctx){const std::uint64_t context[]={c.tex0,c.clamp,c.tex1,c.tex2,c.xyoffset,c.miptbp1,c.miptbp2,c.scissor,c.alpha,c.test,c.fba,c.frame,c.zbuf};for(auto value:context)hash(value);}
 std::uint32_t q;std::memcpy(&q,&s.q,sizeof q);hash(q);hash(s.count);
 for(const auto& v:s.queue){hash(v.x);hash(v.y);hash(v.z);hash(v.r);hash(v.g);hash(v.b);hash(v.a);hash(v.u);hash(v.v);hash(v.f);std::uint32_t bits[3];std::memcpy(bits,&v.q,sizeof bits);for(auto value:bits)hash(value);}
 for(auto value:s.clut){hash(value);}
 hash(cbp0);hash(cbp1);hash(g_primitives);
 for(auto value:g_writes){hash(value);}
}
static void initialize(){
 gpu_reset();w(0x1a,1);w(1,0x3f80000080402010ull);w(2,0x3f0000003f000000ull);w(3,0x00200010);
 for(unsigned ctx=0;ctx<2;ctx++){
  w(0x4c+ctx,(std::uint64_t(10+ctx)<<16)|(std::uint64_t(ctx)<<24)|ctx);
  w(0x4e + ctx,(std::uint64_t(ctx)<<24)|(std::uint64_t(ctx)<<32)|ctx);
  w(0x40+ctx,(std::uint64_t(1000)<<16)|(std::uint64_t(800)<<48));
  w(0x06+ctx,13|(std::uint64_t(1)<<14)|(std::uint64_t(PSMT4)<<20)|(std::uint64_t(4)<<26)|(std::uint64_t(4)<<30));
  w(0x18+ctx,std::uint64_t(ctx*16)|(std::uint64_t(ctx*32)<<32));
  w(0x47+ctx,0x70003|ctx);w(0x42+ctx,0x0000008000000044ull+ctx);
 }
}
int main(){
 using namespace ps2::gs::gpu;
 initialize();primitive(0,0x110);const auto before=setupMisses;
 for(int i=0;i<100;i++)primitive(0,0x110);
 assert(setupMisses-before==(PRIM_REUSES_SETUP?0u:100u));
 // PRIM always resets a partial queue, even for identical values.
 w(0,3|0x110);xyz(0);assert(g_state.count==1);w(0,3|0x110);assert(g_state.count==0);
 const auto oldDraws=draws;xyz(1);xyz(2);assert(draws==oldDraws);xyz(3);assert(draws==oldDraws+1);
 // PRIM type, every draw attribute and CTXT still select fresh setup words.
 for(unsigned type=0;type<7;type++)for(unsigned attr=0;attr<1024;attr+=8)primitive(type,attr);
 // PRMODECONT=0 resolves context/flags through PRMODE, retaining PRIM type.
 for(unsigned mode=0;mode<2;mode++){
  w(0x1a,mode);
  for(unsigned pm=0;pm<1024;pm+=8){w(0x1b,pm);primitive(pm%7,0x310);primitive((pm+1)%7,0x10);}
 }
 // Every setup input, uncached XYOFFSET and TEXFLUSH remains active.
 const std::uint32_t regs[]={6,7,8,9,0x14,0x15,0x16,0x17,0x18,0x19,0x22,0x3b,0x3d,0x40,0x41,0x42,0x43,0x46,0x47,0x48,0x49,0x4a,0x4b,0x4c,0x4d,0x4e,0x4f,0x3f};
 for(const auto reg:regs)for(unsigned i=0;i<5;i++){w(reg,std::uint64_t(0x12345678u+i)|(std::uint64_t(0x76543210u+i)<<32));primitive(i%7,0x310);primitive(i%7,0x310);}
 // Repeated TEX0 CLD1 must perform repeated loads, even when PRIM reuses setup.
 initialize();const auto loads=clutLoads;const auto tex=g_state.ctx[0].tex0|(1ull<<61);
 w(6,tex);primitive(0,0x110);w(6,tex);primitive(0,0x110);assert(clutLoads==loads+2);
 // Conditional CLD4 uses CBP0; TEX2 must still merge and perform its CLUT check.
 w(6,(tex&~(7ull<<61))|(2ull<<61));const auto afterCb=clutLoads;
 w(6,(tex&~(7ull<<61))|(4ull<<61));assert(clutLoads==afterCb);
 w(0x16,(tex&~(7ull<<61))|(1ull<<61));primitive(0,0x110);assert(clutLoads==afterCb+1);
 // Real bridge save/load/reset bodies restore partial vertices/state and force
 // setup renewal. Device VRAM/transfer transport is observed by host stubs.
 w(0,3|0x110);xyz(0);const auto* ptr=gpu_save();std::vector<std::uint8_t> saved(ptr,ptr+stateSize);
 primitive(0,0x310);const auto gen=g_setup_generation;gpu_load(saved.data(),saved.size());assert(g_state.count==1 && g_state.prim==(3|0x110) && g_setup_generation==gen+1);xyz(1);xyz(2);
 const auto gen2=g_setup_generation;gpu_reset();assert(g_state.count==0 && g_setup_generation==gen2+1);primitive(0);
 // Deterministic mixed stream: repeated/changing PRIM interspersed with actual
 // state writes and nondrawing vertices; every generated draw checks fresh setup.
 initialize();std::uint32_t random=0x31415926;
 for(int i=0;i<10000;i++){
  random^=random<<13;random^=random>>17;random^=random<<5;
  if((random&7)==0)w(regs[(random>>3)%(sizeof regs/sizeof*regs)],std::uint64_t(random)|(std::uint64_t(random^0x76543210)<<32));
  if((random&31)==0){w(0x1a,(random>>8)&1);w(0x1b,(random>>9)&0x3f8);}
  primitive(random%7,(random>>7)&0x3f8);
  if((random&63)==0)xyz(0,false);
 }
 // Transfer/event dispatches still run exactly as on control.
 w(0x52,4|(std::uint64_t(4)<<32));w(0x53,0);w(0x54,0x0123456789abcdefull);w(0x53,2);w(0x60,0x1234);w(0x61,0x5678);w(0x62,0);
 hashState();
 std::printf("{\"digest\":\"%016llx\",\"draws\":%llu,\"setupMisses\":%llu,\"clutLoads\":%llu,\"imageBegins\":%llu,\"imageData\":%llu,\"copies\":%llu,\"texflushes\":%u}\n",(unsigned long long)digest,(unsigned long long)draws,(unsigned long long)setupMisses,(unsigned long long)clutLoads,(unsigned long long)imageBegins,(unsigned long long)imageData,(unsigned long long)copies,g_texflushes);
}
