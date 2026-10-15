// CloudRcade GS command bridge. Original adapter: GPL-3.0.
#include "gpu.hpp"
#include <emscripten.h>
#include <cstring>
#include <vector>
#include <stdexcept>
namespace ps2::gs {
void build_tables();
void write(std::uint32_t, std::uint64_t);
extern std::uint32_t cbp0, cbp1;
}
namespace ps2::gs::gpu { void shutdown(); bool present_layers(const std::uint32_t*); void save_transfer(std::uint32_t*); void load_transfer(const std::uint32_t*); }
namespace ps2 { extern unsigned long long cloudGpuFrames; }
using namespace ps2::gs;
static std::vector<std::uint8_t> snapshot;
static constexpr std::uint32_t magic = 0x32534757;
static constexpr size_t stateSize = 16 + sizeof(State) + kMemorySize + 512 * 4 + 512;
extern "C" {
EMSCRIPTEN_KEEPALIVE void gpu_wait() { gpu::wait_idle(); }
EMSCRIPTEN_KEEPALIVE void gpu_destroy() { gpu::shutdown(); }
EMSCRIPTEN_KEEPALIVE int gpu_init() {
 build_tables();
 if(!gpu::init(gpu::Mode::primary)) return 0;
 return gpu::attach_surface({gpu::SurfaceTarget::Canvas,nullptr,0,nullptr,"#outputCanvas",640,480});
}
EMSCRIPTEN_KEEPALIVE void gpu_write(const std::uint32_t* words, unsigned count) {
 if(count % 3) throw std::runtime_error("Invalid GS register batch.");
 for(unsigned i=0;i<count;i+=3) write(words[i], words[i+1] | (std::uint64_t(words[i+2]) << 32));
}
EMSCRIPTEN_KEEPALIVE void gpu_image(const std::uint8_t* bytes, unsigned size) { gpu::image_data(bytes,size); }
EMSCRIPTEN_KEEPALIVE int gpu_present(const std::uint32_t* p) {
 const bool shown = gpu::present_layers(p);
 if(shown) ++ps2::cloudGpuFrames; return shown;
}
EMSCRIPTEN_KEEPALIVE void gpu_download(std::uint8_t* target) { gpu::download(target); }
EMSCRIPTEN_KEEPALIVE unsigned gpu_state_size() { return stateSize; }
EMSCRIPTEN_KEEPALIVE const std::uint8_t* gpu_save() {
 std::vector<std::uint32_t> vram,clut; std::uint32_t scale;
 gpu::read_state(vram,scale,clut);
 if(scale!=1 || vram.size()*4!=kMemorySize || clut.size()!=512) throw std::runtime_error("Unexpected GS state.");
 snapshot.resize(stateSize);
 const std::uint32_t header[] = {magic,1,cbp0,cbp1};
 std::memcpy(snapshot.data(),header,16);
 std::memcpy(snapshot.data()+16,&g_state,sizeof(State));
 std::memcpy(snapshot.data()+16+sizeof(State),vram.data(),kMemorySize);
 std::memcpy(snapshot.data()+16+sizeof(State)+kMemorySize,clut.data(),512*4);
 std::uint32_t transfer[128]; gpu::save_transfer(transfer);
 std::memcpy(snapshot.data()+stateSize-512,transfer,512);
 return snapshot.data();
}
EMSCRIPTEN_KEEPALIVE void gpu_load(const std::uint8_t* data, unsigned size) {
 std::uint32_t header[4];
 if(size!=stateSize) throw std::runtime_error("Invalid WebGPU state size.");
 std::memcpy(header,data,16);
 if(header[0]!=magic || header[1]!=1) throw std::runtime_error("Invalid WebGPU state version.");
 std::vector<std::uint32_t> vram(kMemorySize/4),clut(512);
 State next; std::memcpy(&next,data+16,sizeof(State));
 if(next.count<0 || next.count>3) throw std::runtime_error("Invalid GS vertex queue.");
 std::memcpy(vram.data(),data+16+sizeof(State),kMemorySize);
 std::memcpy(clut.data(),data+16+sizeof(State)+kMemorySize,512*4);
 gpu::write_state(vram,1,clut);
 std::uint32_t transfer[128]; std::memcpy(transfer,data+stateSize-512,512); gpu::load_transfer(transfer);
 g_state=next; cbp0=header[2]; cbp1=header[3]; ++g_setup_generation;
}
EMSCRIPTEN_KEEPALIVE void gpu_reset() {
 std::vector<std::uint32_t> vram(kMemorySize/4),clut(512);
 gpu::write_state(vram,1,clut);
 std::uint32_t transfer[128]{}; transfer[9]=32; gpu::load_transfer(transfer);
 g_state={}; cbp0=cbp1=~0u; ++g_setup_generation;
}
}
