// Exact base Copy/InitFromFrameDump plus actual frontend cache overrides and
// real CMailBox. Only the device transport is an observed in-memory endpoint.
#include <algorithm>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>
#include "Types.h"
#include "Source/MailBox.h"
#include "state-names.inc"
class Stream {
public:
 std::vector<uint8> bytes;
 std::size_t position=0;
 std::size_t Read(void*p,std::size_t n){const auto count=std::min(n,bytes.size()-position);std::memcpy(p,bytes.data()+position,count);position+=count;return count;}
};
namespace Framework {
class CZipArchiveReader {
public:
 std::shared_ptr<Stream> BeginReadFile(const char* name){
  auto s=std::make_shared<Stream>();
  if(std::string(name)==STATE_RAM)s->bytes.assign(4*1024*1024,0x12);
  else if(std::string(name)==STATE_REGS)s->bytes.assign(128*8,0);
  else if(std::string(name)==STATE_TRXCTX)s->bytes.assign(4,0);
  else if(std::string(name)=="cloudrcade.webgpu"){
   const uint32 n=4*1024*1024;s->bytes.assign(n+4,0x34);std::memcpy(s->bytes.data(),&n,4);
  }
  return s;
 }
};
}
class CRegisterStateFile {
public:
 explicit CRegisterStateFile(Stream&){}
 uint64 GetRegister64(const char*){return 0;}
 uint32 GetRegister32(const char*){return 0;}
};
class CFrameDump {
public:
 std::vector<uint8> ram=std::vector<uint8>(4*1024*1024,0x78);
 uint64 regs[128]{};
 uint8* GetInitialGsRam(){return ram.data();}
 uint64* GetInitialGsRegisters(){return regs;}
 uint64 GetInitialSMODE2(){return 0x1234;}
};
class CGSHandler {
public:
 static constexpr uint32 RAMSIZE=4*1024*1024,REGISTER_MAX=128;
 explicit CGSHandler():ram(RAMSIZE),gpu(RAMSIZE),snapshot(RAMSIZE),m_pRAM(ram.data()) {
  m_thread=std::thread([this]{ThreadProc();});
 }
 virtual ~CGSHandler(){SendGSCall([this]{m_threadDone=true;});m_thread.join();}
 virtual void SyncMemoryCache(){}
 virtual void WriteBackMemoryCache(){}
 virtual void LoadState(Framework::CZipArchiveReader&);
 void SubmitWriteBuffer(){} // No register tail in this ownership test (covered by the separate fixture).
 void Copy(CGSHandler*);
 void InitFromFrameDump(CFrameDump*);
 void ThreadProc();
 void SendGSCall(const CMailBox::FunctionType&,bool=false,bool=false);
 void SendGSCall(CMailBox::FunctionType&&);
 void Drain(){SendGSCall([]{},true,true);}
 uint8* GetRam(){return m_pRAM;}
 uint64* GetRegisters(){return m_nReg;}
 void SetSMODE2(uint64 value){m_nSMODE2=value;}
 std::vector<uint8> ram,gpu,snapshot;
 uint8* m_pRAM;
 uint64 m_nReg[REGISTER_MAX]{};
 struct TRXCONTEXT {uint32 x=0;};
 TRXCONTEXT m_trxCtx;
 using CRT_MODE=uint32;
 struct Delayed {uint64 heldValue=0;struct {uint64 q=0;}value;};
 uint64 m_nPMODE=0,m_nSMODE2=0,m_nCSR=0,m_nIMR=0,m_nBUSDIR=0,m_nSIGLBLID=0;
 Delayed m_nDISPFB1,m_nDISPLAY1,m_nDISPFB2,m_nDISPLAY2;
 uint32 m_crtMode=0,m_nCBP0=0,m_nCBP1=0;
 CMailBox m_mailBox;
 std::thread m_thread;
 bool m_threadDone=false,m_gsThreaded=true;
 uint32 m_writeBufferSize=0,m_writeBufferProcessIndex=0,m_writeBufferSubmitIndex=0;
};
#include "native-methods.inc"
class Frontend final:public CGSHandler {
public:
 std::vector<uint8> gpuState;
 std::vector<uint32> writes,commands,operations;
#include "cache-overrides.inc"
 void Flush(){}
 bool queued=false;
 void Queue(uint32 op,const void*,uint32 bytes){if(op!=9||bytes)throw std::runtime_error("wrong capture queue");queued=true;}
 void Submit(){if(queued){snapshot=gpu;queued=false;}}
 void Call(uint32 op,const void* data,uint32 bytes,void* output=nullptr){
  operations.push_back(op);
  if(op==7){if(data||bytes||output!=m_pRAM)throw std::runtime_error("wrong full sync");std::memcpy(output,gpu.data(),RAMSIZE);}
  else if(op==10){if(data!=m_pRAM||bytes!=RAMSIZE)throw std::runtime_error("wrong seed ownership");std::memcpy(snapshot.data(),data,bytes);}
  else if(op==5){if(bytes!=RAMSIZE)throw std::runtime_error("wrong GPU state size");std::memcpy(gpu.data(),data,bytes);}
  else throw std::runtime_error("unexpected native op");
 }
};
int main(){try{
 Frontend source,target;
 std::fill(source.ram.begin(),source.ram.end(),0x12);
 std::fill(source.gpu.begin(),source.gpu.end(),0x34);
 std::fill(target.gpu.begin(),target.gpu.end(),0x56);
 target.Copy(&source);target.Drain();
 if(target.ram!=source.gpu||target.snapshot!=target.ram||target.gpu[0]!=0x56)throw std::runtime_error("actual Copy did not seed native cache independently of render VRAM");
 CFrameDump dump;dump.regs[0]=0x5678;
 target.InitFromFrameDump(&dump);target.Drain();
 if(target.snapshot!=dump.ram||target.m_nReg[0]!=0x5678||target.m_nSMODE2!=0x1234||target.gpu[0]!=0x56)throw std::runtime_error("actual frame dump did not seed native cache");
 std::fill(target.gpu.begin(),target.gpu.end(),0x9a);
 target.SendGSCall([&]{target.SyncMemoryCache();},true);
 if(target.ram!=target.gpu||target.snapshot!=target.gpu)throw std::runtime_error("full sync did not replace copied cache");
 target.operations.clear();Framework::CZipArchiveReader archive;target.LoadState(archive);target.Drain();
 if(target.operations!=std::vector<uint32>{10,5,10}||target.snapshot!=target.ram||target.ram[0]!=0x12||target.gpu[0]!=0x34)
  throw std::runtime_error("actual load seed/GPU/seed ordering or divergent native cache changed");
 std::cout<<"PASS actual Copy/frame-dump/load methods + frontend cache overrides + real mailbox: native snapshot seeded, divergent render VRAM preserved\n";
}catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
