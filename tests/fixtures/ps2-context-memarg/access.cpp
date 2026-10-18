#include "MipsJitter.h"
#include "MIPS.h"
#include "ee/VUShared.h"
#include "Jitter_CodeGen_Wasm.h"
#include "MemStream.h"
#include "offsetof_def.h"
#include <memory>
static Framework::CMemStream accessStream;
extern "C" void registerObserver() { Jitter::CWasmFunctionRegistry::RegisterFunction(0x1234, "observe", "viii"); }
extern "C" unsigned accessSize() { return accessStream.GetSize(); }
extern "C" unsigned accessLayout(unsigned key) {
 const unsigned values[] = {sizeof(CMIPS), sizeof(void*), offsetof(CMIPS,m_State.nGPR[0]), offsetof(CMIPS,m_State.nCOP2[0])};
 return key < 4 ? values[key] : 0;
}
extern "C" uintptr_t generateAccess(unsigned mode, unsigned src, unsigned dst, unsigned mask, unsigned kind, unsigned bound) {
 accessStream.ResetBuffer();
 auto* backend = new Jitter::CCodeGen_Wasm();
 std::unique_ptr<Jitter::CJitter> holder(kind == 1 ? static_cast<Jitter::CJitter*>(new CMipsJitter(backend)) : new Jitter::CJitter(backend));
#ifdef KH_CONTEXT_MEMARG_FIXTURE
 if(kind == 2) backend->SetValidContextSize(bound);
 if(kind == 3) { backend->SetValidContextSize(bound); backend->SetValidContextSize(0); }
#endif
 auto& j = *holder;
 j.SetStream(&accessStream);
 // Repeated Begin must neither clear the context contract nor retain offsets.
 j.Begin(); j.PushCst(0x81234567); j.PullRel(256); j.End();
 accessStream.ResetBuffer(); j.Begin();
 bool a=mask&1,b=mask&2,c=mask&4,d=mask&8;
 switch(mode) {
 case 0: j.PushRel(src); j.PullRel(dst); break;
 case 1: j.PushRel64(src); j.PullRel64(dst); break;
 case 2: j.FP_PushRel32(src); j.FP_NegS(); j.FP_NegS(); j.FP_PullRel32(dst); break;
 case 3: j.MD_PushRel(src); j.MD_PullRel(dst); break;
 case 4: j.MD_PushRel(src); if(mask) j.MD_PullRel(dst,a,b,c,d); else j.PullTop(); break;
 case 5: j.FP_PushRel32(src); j.FP_ToSingleI32(); j.FP_PullRel32(dst); break;
 case 6: j.FP_PushRel32(src); j.FP_ToInt32TruncateS(); j.FP_PullRel32(dst); break;
 case 7:
  j.PushRel(src); j.PushRel(src+4); j.Add(); j.PullRel(dst);
  j.PushRel64(src); j.PushCst64(0x1020304050607080ULL); j.Add64(); j.PullRel64(dst+8);
  j.MD_PushRel(src); j.MD_PushRel(dst); j.MD_Xor(); j.MD_PullRel(dst+16);
  j.FP_PushRel32(src); j.FP_ToInt32TruncateS(); j.FP_PullRel32(dst+4); break;
 case 8: j.PushRelRef(src); j.LoadFromRef(); j.PullRel(dst); break;
 case 9: j.PushRelRef(dst); j.PushRel(src); j.StoreAtRef(); break;
 case 10: j.PushRelRef(src); j.PushRel(src+4); j.LoadFromRefIdx(1); j.PullRel(dst); break;
 case 11: j.PushRelRef(dst); j.PushRel(dst+4); j.PushRel(src); j.StoreAtRefIdx(1); break;
 case 12: j.PushRelRef(src); j.MD_LoadFromRef(); j.MD_PullRel(dst); break;
 case 13: j.PushRelRef(dst); j.MD_PushRel(src); j.MD_StoreAtRef(); break;
 case 14:
  j.PushRelRef(src); j.PushRel(src+4); j.MD_PushRel(dst);
  j.MD_LoadFromRefIdxMasked(a,b,c,d); j.MD_PullRel(dst); break;
 case 15:
  j.PushRelRef(dst); j.PushRel(dst+4); j.MD_PushRel(src);
  if(mask==15) j.MD_StoreAtRefIdx(1); else j.MD_StoreAtRefIdxMasked(a,b,c,d); break;
 case 16: j.PushRelAddrRef(src); j.LoadFromRef(); j.PullRel(dst); break;
 case 17:
  j.PushCst(0x12345678); j.PullRel(dst);
  j.PushCtx(); j.PushRelAddrRef(src); j.PushRel(dst); j.Call(reinterpret_cast<void*>(0x1234),3,Jitter::CJitter::RETURN_VALUE_NONE);
  j.PushRel(src); j.PullRel(dst+4); break;
 case 18: j.PushRelRef(src); j.Load8FromRef(); j.PullRel(dst); break;
 case 19: j.PushRelRef(src); j.Load16FromRef(); j.PullRel(dst); break;
 case 20: j.PushRelRef(src); j.Load64FromRef(); j.PullRel64(dst); break;
 case 21: j.PushRelRef(dst); j.PushRel(src); j.Store8AtRef(); break;
 case 22: j.PushRelRef(dst); j.PushRel(src); j.Store16AtRef(); break;
 case 23: j.PushRelRef(dst); j.PushRel64(src); j.Store64AtRef(); break;
 case 24:
  j.PushRel(offsetof(CMIPS,m_State.nGPR[0])); j.PullRel(dst);
  j.MD_PushRel(src); VUShared::PullVector(static_cast<CMipsJitter*>(&j),0,offsetof(CMIPS,m_State.nCOP2[0])); break;
 }
 j.End(); return reinterpret_cast<uintptr_t>(accessStream.GetBuffer());
}
