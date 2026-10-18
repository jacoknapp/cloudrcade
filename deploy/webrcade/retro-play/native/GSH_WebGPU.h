// CloudRcade Play! GS frontend; rasterization and transfers run on device WebGPU.
#pragma once
#include "gs/GSHandler.h"
#include "CloudCpuTiming.h"
#include "CloudReadbackRange.h"
#include "states/MemoryStateFile.h"
#include <emscripten.h>
#include <emscripten/threading.h>
#include <atomic>
#include <cstring>
#include <stdexcept>
extern std::atomic<uint32> cloudRenderedFrames;
class CGSH_WebGPU final : public CGSHandler {
 std::vector<uint32> writes;
 std::vector<uint8> gpuState;
 std::vector<uint32> commands;
 static constexpr uint32 batchLimit=4*1024*1024;
 int Submit() { if(commands.empty()) return 1; const int result=Call(8,commands.data(),commands.size()*4); commands.clear(); return result; }
 void Queue(uint32 op,const void* data,uint32 size) {
  const size_t words=(size_t(size)+3)/4;
  if(size>batchLimit-8) { Submit(); Call(op,data,size); return; }
  if(commands.size()+words+2>batchLimit/4) Submit();
  commands.push_back(op); commands.push_back(size);
  const auto start=commands.size(); commands.resize(start+words,0);
  if(size)std::memcpy(commands.data()+start,data,size);
 }
 // The GS worker waits; the browser main thread remains free for async WebGPU.
 int Call(int op, const void* data=nullptr, uint32 size=0, void* output=nullptr) {
  return CloudCpuTiming::Timed(CloudCpuTiming::GSWait, true, [&] { return CallUntimed(op, data, size, output); });
 }
 int CallUntimed(int op, const void* data, uint32 size, void* output) {
  std::atomic<int> done{0};
  MAIN_THREAD_EM_ASM({ Module.cloudGpu.nativeCall($0,$1,$2,$3,$4); },op,data,size,output,&done);
  const auto end=emscripten_get_now()+65000;
  while(done.load()==0) {
   if(emscripten_get_now()>end) throw std::runtime_error("PS2 graphics timed out.");
   emscripten_futex_wait(&done,0,1000);
  }
  if(done.load()<0) throw std::runtime_error("PS2 WebGPU operation failed.");
  return done.load();
 }
 void Flush() { if(!writes.empty()) { Queue(1,writes.data(),writes.size()*4); writes.clear(); } }
protected:
 void InitializeImpl() override {}
 void ReleaseImpl() override {}
 void ResetImpl() override { writes.clear(); commands.clear(); Call(6); }
 void WriteRegisterImpl(uint8 reg,uint64 value) override {
  // HWREG is forwarded by TransferWrite; forwarding it twice duplicates bytes.
  if(reg!=GS_REG_HWREG) { writes.insert(writes.end(),{reg,uint32(value),uint32(value>>32)}); }
  if(writes.size()>=49152) Flush();
  CGSHandler::WriteRegisterImpl(reg,value);
 }
 // The native frontend tracks transfer lengths and registers, without CPU pixels.
 void TransferWrite(const uint8* bytes,uint32 size) override { Flush(); Queue(2,bytes,size); }
 void SyncCLUT(const TEX0&) override {}
 void FlipImpl(const DISPLAY_INFO& info) override {
  Flush();
  uint32 p[26]={info.width,info.height};
  for(unsigned i=0;i<2;i++) {
   const auto& l=info.layers[i];
   const uint32 layer[]={l.enabled?1u:0u,l.offsetX,l.offsetY,l.width,l.height,l.bufPtr/256,l.bufWidth/64,l.psm,l.useConstantAlpha?1u:0u,l.constantAlpha,l.bufOffsetX,l.bufOffsetY};
   std::copy(layer,layer+12,p+2+i*12);
  }
  Queue(3,p,sizeof(p));
  if(Submit()==2) ++cloudRenderedFrames;
  CGSHandler::FlipImpl(info);
 }
 void SyncMemoryCache() override { Flush(); Queue(9,nullptr,0); Submit(); Call(7,nullptr,0,m_pRAM); }
 void WriteBackMemoryCache() override { Call(10,m_pRAM,4*1024*1024); }
 void ReadImageDataImpl(void* output,uint32 size) override {
  const auto buf=make_convertible<BITBLTBUF>(m_nReg[GS_REG_BITBLTBUF]);
  const auto pos=make_convertible<TRXPOS>(m_nReg[GS_REG_TRXPOS]);
  const auto reg=make_convertible<TRXREG>(m_nReg[GS_REG_TRXREG]);
  const auto range=CloudReadbackRange::Plan(buf.nSrcPsm,buf.GetSrcPtr(),buf.nSrcWidth,
   pos.nSSAX,pos.nSSAY,reg.nRRW,m_trxCtx.nRRX,m_trxCtx.nRRY,size);
  const uint32 descriptor[]={range.offset,range.bytes};
  Flush(); Submit(); Call(9,descriptor,sizeof(descriptor),m_pRAM+range.offset);
  CGSHandler::ReadImageDataImpl(output,size);
 }
public:
 void ProcessHostToLocalTransfer() override {}
 void ProcessLocalToHostTransfer() override { Flush(); Queue(9,nullptr,0); }
 void ProcessLocalToLocalTransfer() override { Flush(); }
 void ProcessClutTransfer(uint32,uint32) override {}
 void SaveState(Framework::CZipArchiveWriter& archive) override {
  CGSHandler::SaveState(archive);
  SendGSCall([&]() {
   Flush(); Submit(); gpuState.resize(8*1024*1024+4);
   const uint32 size=Call(4,nullptr,0,gpuState.data()+4)-1;
   if(size>8*1024*1024) throw std::runtime_error("Invalid PS2 GPU state size.");
   std::memcpy(gpuState.data(),&size,4); gpuState.resize(size+4);
  },true);
  archive.InsertFile(std::make_unique<CMemoryStateFile>("cloudrcade.webgpu",gpuState.data(),gpuState.size()));
 }
 void LoadState(Framework::CZipArchiveReader& archive) override {
  auto stream=archive.BeginReadFile("cloudrcade.webgpu"); uint32 size=0;
  if(stream->Read(&size,4)!=4 || size>8*1024*1024 || size<4*1024*1024) throw std::runtime_error("Invalid PS2 GPU state.");
  gpuState.resize(size);
  if(stream->Read(gpuState.data(),size)!=size) throw std::runtime_error("Truncated PS2 GPU state.");
  stream.reset();
  CGSHandler::LoadState(archive);
  SendGSCall([&]() { writes.clear(); commands.clear(); Call(5,gpuState.data(),gpuState.size()); Call(10,m_pRAM,4*1024*1024); },true);
 }
};
