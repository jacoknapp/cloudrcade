// Compile the actual snapshot implementation against an ordered queue observer.
// This is a transport/ownership fixture, not device-WebGPU qualification.
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <vector>
struct Buffer { std::vector<std::uint8_t> bytes; explicit Buffer(std::size_t n):bytes(n){} };
struct Encoder { std::vector<std::function<void()>> jobs; };
using WGPUBuffer=Buffer*;
using WGPUCommandEncoder=Encoder*;
using WGPUCommandBuffer=Encoder*;
using WGPUBufferUsage=unsigned;
constexpr unsigned WGPUBufferUsage_CopySrc=1,WGPUBufferUsage_CopyDst=2;
static std::vector<std::function<void()>> queue;
static unsigned maps=0,checks=0,copies=0;
static void require(bool b,const char*s){++checks;if(!b)throw std::runtime_error(s);}
static void drain(){for(auto&job:queue)job();queue.clear();}
static Encoder* wgpuDeviceCreateCommandEncoder(int,void*){return new Encoder;}
static void wgpuCommandEncoderCopyBufferToBuffer(Encoder*e,Buffer*s,std::uint64_t so,Buffer*d,std::uint64_t off,std::uint64_t n){
 ++copies;e->jobs.push_back([=]{require(so+n<=s->bytes.size()&&off+n<=d->bytes.size(),"GPU copy bounds");std::memcpy(d->bytes.data()+off,s->bytes.data()+so,n);});
}
static Encoder* wgpuCommandEncoderFinish(Encoder*e,void*){return new Encoder(*e);}
static void wgpuQueueSubmit(int,unsigned n,Encoder**commands){for(unsigned i=0;i<n;++i)for(auto&job:commands[i]->jobs)queue.push_back(job);}
static void wgpuCommandBufferRelease(Encoder*e){delete e;}
static void wgpuCommandEncoderRelease(Encoder*e){delete e;}
static void wgpuBufferRelease(Buffer*b){delete b;}
static void wgpuQueueWriteBuffer(int,Buffer*b,std::uint64_t off,const void*p,std::uint64_t n){
 std::vector<std::uint8_t> owned(static_cast<const std::uint8_t*>(p),static_cast<const std::uint8_t*>(p)+n);
 queue.push_back([=]{require(off+n<=b->bytes.size(),"GPU write bounds");std::memcpy(b->bytes.data()+off,owned.data(),n);});
}
namespace ps2::gs {
constexpr std::uint32_t kMemorySize=4*1024*1024;
struct State {};
State g_state{};
std::uint32_t cbp0=0,cbp1=0,g_setup_generation=0;
namespace gpu {
int g_device=1,g_queue=1;
std::uint32_t g_scale=1;
Buffer* g_vram=new Buffer(kMemorySize);
Buffer* g_scratch=new Buffer(kMemorySize);
enum {kResolve};
static Buffer* make_buffer(std::uint64_t n,unsigned){return new Buffer(n);}
static void flush_all(){}
static void submit(){}
static unsigned push_params(std::initializer_list<unsigned>){return 0;}
static void dispatch_linear(unsigned,unsigned,unsigned){throw std::runtime_error("scaled mock not supported");}
static void read_back(Buffer*source,std::uint64_t n,void*out,std::uint64_t offset){
 ++maps;drain();require(offset+n<=source->bytes.size(),"readback bounds");std::memcpy(out,source->bytes.data()+offset,n);
}
void reset_timestamp_collection(){}
void write_state(const std::vector<std::uint32_t>&v,std::uint32_t,const std::vector<std::uint32_t>&){
 drain();wgpuQueueWriteBuffer(g_queue,g_vram,0,v.data(),v.size()*4);drain();
}
void load_transfer(const std::uint32_t*){}
}
}
#include "snapshot-readback.inc"
using namespace ps2::gs;
#define EMSCRIPTEN_KEEPALIVE
#include "reset.inc"
static void full_download(std::vector<std::uint8_t>&out){drain();out=gpu::g_vram->bytes;}
int main(){try{
 std::vector<std::uint8_t>a(kMemorySize,0x12),b(kMemorySize,0x34),cpu(kMemorySize,0x56),out(kMemorySize,0x9a),full;
 gpu::download_snapshot_range(out.data(),0,8192);
 require(std::all_of(out.begin(),out.begin()+8192,[](auto v){return v==0;}),"initial snapshot must match zero native RAM");
 wgpuQueueWriteBuffer(1,gpu::g_vram,0,a.data(),a.size());
 const auto before=maps;gpu::capture_download_snapshot();
 require(maps==before,"capture must not map or copy to CPU");
 wgpuQueueWriteBuffer(1,gpu::g_vram,0,b.data(),b.size());
 gpu::download_snapshot_range(out.data(),8192,8192);
 require(std::all_of(out.begin()+8192,out.begin()+16384,[](auto v){return v==0x12;}),"post-Begin VRAM write changed latched source");
 require(out[0]==0 && out[16384]==0x9a,"range overwrote unrelated CPU memory");
 gpu::download_snapshot_range(out.data(),16384,16384);
 require(out[20000]==0x12,"repeated/mismatched continuation did not read same snapshot");
 gpu::capture_download_snapshot();full_download(full); // Exact full SyncMemoryCache order.
 require(full==b,"full sync GPU source");
 gpu::download_snapshot_range(out.data(),32768,8192);
 require(out[32768]==0x34,"mid-transfer full sync did not replace cached source");
 gpu::seed_download_snapshot(cpu.data(),cpu.size()); // Old-state native RAM can differ from GPU VRAM.
 gpu::download_snapshot_range(out.data(),40960,8192);
 require(out[40960]==0x56,"loaded native RAM was not authoritative for active reads");
 full_download(full);require(full==b,"snapshot seed changed actual GPU state");
 gpu::capture_download_snapshot();full_download(full);
 gpu::download_snapshot_range(out.data(),49152,8192);
 require(out[49152]==0x34,"save/full sync did not refresh seeded source");
 gpu_reset();gpu::download_snapshot_range(out.data(),0,kMemorySize);
 require(std::all_of(out.begin(),out.end(),[](auto v){return v==0;}),"actual reset export did not clear snapshot");
 for(auto range:std::vector<std::pair<unsigned,unsigned>>{{0,0},{1,4},{0,3},{kMemorySize,4},{kMemorySize-4,8}}){
  bool failed=false;try{gpu::download_snapshot_range(out.data(),range.first,range.second);}catch(const std::runtime_error&){failed=true;}
  require(failed,"invalid snapshot range accepted");
 }
 bool bad=false;try{gpu::seed_download_snapshot(cpu.data(),cpu.size()-4);}catch(const std::runtime_error&){bad=true;}
 require(bad,"invalid seed accepted");
 drain();gpu::release_download_snapshot();delete gpu::g_vram;delete gpu::g_scratch;
 std::cout<<"PASS actual snapshot/reset implementation: checks="<<checks<<" maps="<<maps<<" device copies="<<copies<<'\n';
}catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
