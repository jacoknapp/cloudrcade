// A device-only snapshot preserves the original BeginTransfer read boundary.
// CPU reads may be repeated, split or differ from the programmed rectangle.
namespace ps2::gs::gpu {
namespace {
WGPUBuffer g_download_snapshot = nullptr;
void ensure_download_snapshot() {
 if(!g_download_snapshot) g_download_snapshot = make_buffer(kMemorySize,
  WGPUBufferUsage_CopySrc | WGPUBufferUsage_CopyDst);
}
}
void capture_download_snapshot() {
 ensure_download_snapshot();
 flush_all();
 if(g_scale != 1) dispatch_linear(kResolve,kMemorySize/4,push_params({0}));
 submit();
 WGPUCommandEncoder enc=wgpuDeviceCreateCommandEncoder(g_device,nullptr);
 wgpuCommandEncoderCopyBufferToBuffer(enc,g_scale==1?g_vram:g_scratch,0,g_download_snapshot,0,kMemorySize);
 WGPUCommandBuffer command=wgpuCommandEncoderFinish(enc,nullptr);
 wgpuQueueSubmit(g_queue,1,&command);
 wgpuCommandBufferRelease(command); wgpuCommandEncoderRelease(enc);
}
void seed_download_snapshot(const std::uint8_t* memory,std::uint32_t bytes) {
 if(bytes!=kMemorySize) throw std::runtime_error("Invalid GS download snapshot size.");
 ensure_download_snapshot();
 wgpuQueueWriteBuffer(g_queue,g_download_snapshot,0,memory,bytes);
}
void download_snapshot_range(std::uint8_t* memory,std::uint32_t offset,std::uint32_t bytes) {
 if(!bytes || (offset|bytes)%4 || offset>=kMemorySize || bytes>kMemorySize-offset)
  throw std::runtime_error("Invalid GS snapshot range.");
 ensure_download_snapshot();
 // Never flush current raster work here: this reads the older captured image.
 read_back(g_download_snapshot,bytes,memory+offset,offset);
}
void release_download_snapshot() {
 if(g_download_snapshot) wgpuBufferRelease(g_download_snapshot);
 g_download_snapshot=nullptr;
}
}
