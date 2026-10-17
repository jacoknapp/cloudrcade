// Links the actual patched PlayCore/CodeGen, not a modeled guest translator.
#include "ee/EeExecutor.h"
#include "ee/MA_EE.h"
#include "Jitter_CodeGen_Wasm.h"
#include "MemoryUtils.h"
#include "Ps2Const.h"
#include "CloudCpuTiming.h"
#include <emscripten.h>
#include <cassert>
#include <cstring>
#include <iostream>
#include <vector>
#include <chrono>
#include <optional>
namespace CloudTail { bool fixtureSupport=true; bool Supported() { return fixtureSupport; } }
struct Machine {
 std::vector<uint8> ram;
 CMIPS cpu;
 CMA_EE architecture;
 CEeExecutor executor;
 bool trapOnRead=false, invalidateOnRead=false;
 explicit Machine(bool tail) : ram(PS2::EE_RAM_SIZE),cpu((CloudTail::Enabled().store(tail),MEMORYMAP_ENDIAN_LSBF)),executor(cpu,ram.data()) {
  cpu.m_pArch=&architecture;cpu.m_pAddrTranslator=CMIPS::TranslateAddress64;
  cpu.m_pMemoryMap->InsertInstructionMap(0,PS2::EE_RAM_SIZE-1,ram.data(),1);
  cpu.m_pMemoryMap->InsertReadMap(0,PS2::EE_RAM_SIZE-1,ram.data(),0);
  cpu.m_pMemoryMap->InsertWriteMap(0,PS2::EE_RAM_SIZE-1,ram.data(),0);
  cpu.m_pMemoryMap->InsertReadMap(0x10000000,0x10000003,[this](uint32,uint32) {
   if(trapOnRead)cpu.m_State.nHasException=MIPS_EXCEPTION_CHECKPENDINGINT;
   if(invalidateOnRead) {Word(0x2000,0x254a0009);executor.ClearActiveBlocksInRange(0x2000,0x200c,false);invalidateOnRead=false;}
   return 0x12345678U;
  },0);
  executor.Reset();Program();
 }
 void Word(uint32 at,uint32 value) { std::memcpy(ram.data()+at,&value,4); }
 static uint32 Branch(uint32 at,uint32 to) { return 0x10000000 | (uint32(int32(to-at-4)/4)&0xffff); }
 void Program(uint32 increment=2) {
  Word(0xff8,0x25080001);Word(0xffc,Branch(0xffc,0x2000));Word(0x1000,0x25290000|increment);
  Word(0x2000,0x254a0003);Word(0x2004,Branch(0x2004,0xff8));Word(0x2008,0x256b0004);
  // Conditional branch's ordinary fallthrough also leads back to B.
  Word(0x1004,Branch(0x1004,0x2000));Word(0x1008,0x258c0005);
  cpu.Reset();cpu.m_State.nPC=0xff8;
 }
 void Run(unsigned quota) { executor.Execute(quota); }
};
void Equal(const Machine& a,const Machine& b) {
 if(a.ram!=b.ram) {std::cerr<<"RAM mismatch\n";std::abort();}
 if(std::memcmp(&a.cpu.m_State,&b.cpu.m_State,sizeof(MIPSSTATE))) {
  std::cerr<<"State mismatch PC "<<a.cpu.m_State.nPC<<"/"<<b.cpu.m_State.nPC<<" quota "<<a.cpu.m_State.cycleQuota<<"/"<<b.cpu.m_State.cycleQuota<<"\n";std::abort();
 }
}
int main() {
 EM_ASM({
  Module.cloudFixtureModules = ({ordinary:0,chain:0});
  WebAssembly.Module = new Proxy(WebAssembly.Module, {construct(Target,args) {
   const result = new Target(...args);
   if(WebAssembly.Module.exports(result).some(item=>item.name==='codeGenFunc')) {
    const chained=WebAssembly.Module.imports(result).some(item=>item.name==='guestTable');
    Module.cloudFixtureModules[chained?'chain':'ordinary']++;
    if(chained) {
     const bytes=args[0];
     if(bytes[bytes.length-4]!==0x13 || bytes[bytes.length-3]!==0 || bytes[bytes.length-2]!==1 || bytes[bytes.length-1]!==0x0b) throw new Error('Missing real tail opcode');
    }
   }
   return result;
  }});
 });
 Jitter::CWasmFunctionRegistry::RegisterFunction(reinterpret_cast<uintptr_t>(&EmptyBlockHandler),"_EmptyBlockHandler","vi");
 // Register memory helpers for actual guest load/store and invalidation tests.
 Jitter::CWasmFunctionRegistry::RegisterFunction(reinterpret_cast<uintptr_t>(&MemoryUtils_GetWordProxy),"_MemoryUtils_GetWordProxy","iii");
 Jitter::CWasmFunctionRegistry::RegisterFunction(reinterpret_cast<uintptr_t>(&MemoryUtils_SetWordProxy),"_MemoryUtils_SetWordProxy","viii");
 // Each EE executor owns a 512MiB one-way block table; generated modules cap
 // memory at 2GiB, so keep at most two machines alive at once.
 std::optional<Machine> baseStorage(std::in_place,false),tailStorage(std::in_place,true);
 Machine* baseP=&*baseStorage;Machine* tailP=&*tailStorage;
#define base (*baseP)
#define tail (*tailP)
 assert(!base.cpu.m_cloudChain && tail.cpu.m_cloudChain);
 unsigned cases=0;
 for(auto quota:{1,2,3,4,5,6,63,64,65,127,128,129,1024,1000000}) {
  base.Program();tail.Program();base.Run(quota);tail.Run(quota);Equal(base,tail);++cases;
 }
 // Every selected quota lands across the same real R5900 delay slot/accounting.
 for(unsigned value=1;value<=96;++value) {
  base.Program(value);tail.Program(value);
  base.executor.SyncInstructionCache();tail.executor.SyncInstructionCache();
  base.Run(1000+value);tail.Run(1000+value);Equal(base,tail);++cases;
 }
 // Returning to old bytes exercises exact-code cached function instances.
 base.Program();tail.Program();base.executor.SyncInstructionCache();tail.executor.SyncInstructionCache();
 base.Run(999);tail.Run(999);Equal(base,tail);++cases;
 for(auto* m:{&base,&tail}) {m->Word(0x2000,0x0000000c);m->executor.SyncInstructionCache();m->cpu.Reset();m->cpu.m_State.nPC=0xff8;}
 base.Run(1000);tail.Run(1000);Equal(base,tail);assert(tail.cpu.m_State.nHasException==MIPS_EXCEPTION_SYSCALL);++cases;
 // A pending interrupt exception must return before executing any guest block.
 for(auto* m:{&base,&tail}) {m->cpu.Reset();m->cpu.m_State.nPC=0xff8;m->cpu.m_State.nHasException=MIPS_EXCEPTION_CHECKPENDINGINT;}
 base.Run(1000);tail.Run(1000);Equal(base,tail);assert(tail.cpu.m_State.nGPR[8].nV0==0);++cases;
 // Real cache reset releases table handles, forcing reuse on the next compile.
 for(unsigned repeat=0;repeat<24;++repeat) {
  base.executor.Reset();tail.executor.Reset();base.Program(3+repeat);tail.Program(3+repeat);
  base.Run(4000);tail.Run(4000);Equal(base,tail);++cases;
 }
 // Actual LW/SW helper calls, with data writes compared across full EE RAM.
 for(auto* m:{&base,&tail}) {
  m->Program();m->Word(0xff8,0x8d880000);m->Word(0x1000,0xad880004);
  m->Word(0x8000,0xabcdef98);m->cpu.m_State.nGPR[12].nV0=0x8000;m->executor.SyncInstructionCache();
 }
 base.Run(1000);tail.Run(1000);Equal(base,tail);++cases;
 // A host memory helper raising an exception must stop before the next block.
 for(auto* m:{&base,&tail}) {
  m->Program();m->Word(0xff8,0x8d880000);m->cpu.m_State.nGPR[12].nV0=0x10000000;
  m->trapOnRead=true;m->executor.SyncInstructionCache();
 }
 base.Run(1000);tail.Run(1000);Equal(base,tail);
 assert(tail.cpu.m_State.nHasException==MIPS_EXCEPTION_CHECKPENDINGINT && tail.cpu.m_State.nGPR[10].nV0==0);++cases;
 // Invalidate/recompile the successor from a real guest memory helper while A
 // is executing; a cached numeric handle must never enter the old B code.
 for(auto* m:{&base,&tail}) {
  m->trapOnRead=false;m->Program();m->executor.SyncInstructionCache();m->Run(6);
  m->cpu.Reset();m->cpu.m_State.nPC=0xff8;m->Word(0xff8,0x8d880000);
  m->cpu.m_State.nGPR[12].nV0=0x10000000;m->invalidateOnRead=true;m->executor.SyncInstructionCache();
 }
 base.Run(999);tail.Run(999);Equal(base,tail);++cases;
 for(auto* m:{&base,&tail}){m->Program();m->executor.SyncInstructionCache();m->Run(600);}
 // Save/load state shape: restore all MIPSSTATE bytes while code is recompiled.
 auto saved=base.cpu.m_State;
 base.executor.Reset();tail.executor.Reset();base.cpu.m_State=saved;tail.cpu.m_State=saved;
 base.Run(7000);tail.Run(7000);Equal(base,tail);++cases;
 // Direct-map collision: 0x6000 and 0x2000 share a slot; tag check must fallback.
 for(auto* m:{&base,&tail}) {
  m->Program();m->Word(0xffc,Machine::Branch(0xffc,0x6000));
  m->Word(0x6000,0x25ad0006);m->Word(0x6004,Machine::Branch(0x6004,0x2000));m->Word(0x6008,0);
  m->executor.SyncInstructionCache();
 }
 base.Run(9999);tail.Run(9999);Equal(base,tail);++cases;
 // Real conditional branch: both taken and untaken edges, including delay work.
 for(bool taken:{false,true}) {
  for(auto* m:{&base,&tail}) {
   m->Program();m->Word(0xffc,0x15090000 | (Machine::Branch(0xffc,0x2000)&0xffff));
   m->cpu.m_State.nGPR[9].nV0=taken?44:1;m->executor.SyncInstructionCache();
  }
  base.Run(3);tail.Run(3);Equal(base,tail);++cases;
 }
 baseStorage.reset();tailStorage.reset();
 // Unsupported capability takes the original module/lookup path.
 {
  CloudTail::fixtureSupport=false;Machine fallback(true),control(false);assert(!fallback.cpu.m_cloudChain);
  fallback.Run(12345);control.Run(12345);Equal(fallback,control);CloudTail::fixtureSupport=true;++cases;
 }
 // Full executor/CMIPS teardown and recreation with table-slot recycling.
 for(unsigned repeat=0;repeat<6;++repeat) {
  Machine recreatedBase(false),recreatedTail(true);
  recreatedBase.Run(12345);recreatedTail.Run(12345);Equal(recreatedBase,recreatedTail);++cases;
 }
 baseStorage.emplace(false);tailStorage.emplace(true);baseP=&*baseStorage;tailP=&*tailStorage;
 EM_ASM({console.log("MODULES " + JSON.stringify(Module.cloudFixtureModules));});
 std::cout<<"PASS actual Play EE whole-MIPSSTATE differential cases="<<cases<<" sizeof(MIPSSTATE)="<<sizeof(MIPSSTATE)<<"\n";
 // CPU-only mechanism screen, not a full VM/FPS result. Warm equal guest work.
 for(auto* m:{&base,&tail}) {m->executor.Reset();m->Program();m->Run(6000);}
 for(unsigned repeat=0;repeat<8;++repeat) {
  for(bool candidate:(repeat&1)?std::initializer_list<bool>{true,false}:std::initializer_list<bool>{false,true}) {
   auto& m=candidate?tail:base;const auto start=emscripten_get_now();
   for(unsigned i=0;i<20;++i)m.Run(3000000);
   const auto elapsed=emscripten_get_now()-start;
   std::cout<<"SCREEN "<<repeat<<" "<<(candidate?"chain":"baseline")<<" "<<elapsed<<" ms guest_instructions=60000000\n";
  }
 }
 CloudCpuTiming::SetEnabled(true);
 const auto before=CloudTail::Entries().load();tail.Run(3000000);
 std::cout<<"MECHANISM candidate entries="<<CloudTail::Entries().load()-before<<" for guest_instructions=3000000 blocks=1000000 max_chain=64\n";
 return 0;
}
