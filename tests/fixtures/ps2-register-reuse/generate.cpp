#include "MipsJitter.h"
#include "MIPS.h"
#include "ee/VUShared.h"
#include "Jitter_CodeGen_Wasm.h"
#include "MemStream.h"
#include "offsetof_def.h"
#include <memory>
static_assert(sizeof(((MIPSSTATE*)nullptr)->nGPR[0])==16);
static_assert(sizeof(((MIPSSTATE*)nullptr)->nCOP2[0])==16);
static Framework::CMemStream stream, disabledStream;
extern "C" unsigned disabledSize(){return disabledStream.GetSize();}
extern "C" uintptr_t disabledPtr(){return reinterpret_cast<uintptr_t>(disabledStream.GetBuffer());}
extern "C" unsigned size() { return stream.GetSize(); }
extern "C" unsigned layout(unsigned key) {
 const unsigned values[]={sizeof(CMIPS),sizeof(void*),offsetof(CMIPS,m_State.nGPR[0]),offsetof(CMIPS,m_State.nCOP2[0]),offsetof(CMIPS,m_State.nCOP2A),offsetof(CMIPS,m_State.nCOP2SF),offsetof(CMIPS,m_State.savedIntReg),offsetof(CMIPS,m_State),offsetof(MIPSSTATE,nGPR),offsetof(MIPSSTATE,nCOP2),sizeof(uint128),sizeof(MIPSSTATE)};
 return key<12?values[key]:0;
}
static void read(Jitter::CJitter& j,unsigned type,unsigned src,bool last=false){
 switch(type){case 0:j.PushRel(src);break;case 1:j.PushRel64(src);break;case 2:j.FP_PushRel32(src);if(last)j.FP_AbsS();else j.FP_NegS();break;default:j.MD_PushRel(src);break;}
}
static void store(Jitter::CJitter& j,unsigned type,unsigned dst){
 switch(type){case 0:j.PullRel(dst);break;case 1:j.PullRel64(dst);break;case 2:j.FP_PullRel32(dst);break;default:j.MD_PullRel(dst);break;}
}
extern "C" void registerObserver(){Jitter::CWasmFunctionRegistry::RegisterFunction(0x1234,"observe","viii");}
extern "C" uintptr_t generate(unsigned mode,unsigned type,unsigned src,unsigned arg,unsigned kind){
 stream.ResetBuffer();
 auto* backend=new Jitter::CCodeGen_Wasm();
 std::unique_ptr<Jitter::CJitter> holder(kind?static_cast<Jitter::CJitter*>(new CMipsJitter(backend)):new Jitter::CJitter(backend));
 auto& j=*holder;
#ifdef KH_REGISTER_REUSE_FIXTURE
 if(kind==2)j.SetRelativeReadReuseRegions({});
#endif
 j.SetStream(&stream);
 const unsigned out=offsetof(CMIPS,m_State.nGPR[16]);
 auto warmup=[&](){j.Begin();read(j,type,src);store(j,type,out);read(j,type,src,true);store(j,type,out+16);j.End();};
 disabledStream.ResetBuffer();
 warmup();
 if(kind==3){
#ifdef KH_REGISTER_REUSE_FIXTURE
  j.SetRelativeReadReuseRegions({});
#endif
  stream.ResetBuffer();warmup();
  disabledStream.Write(stream.GetBuffer(),stream.GetSize());
#ifdef KH_REGISTER_REUSE_FIXTURE
  Jitter::CCodeGen::RelativeReadReuseRegions regions;
  for(unsigned i=1;i<32;i++){
   regions.emplace_back(offsetof(CMIPS,m_State)+offsetof(MIPSSTATE,nGPR)+i*sizeof(uint128),sizeof(uint128));
   regions.emplace_back(offsetof(CMIPS,m_State)+offsetof(MIPSSTATE,nCOP2)+i*sizeof(uint128),sizeof(uint128));
  }
  j.SetRelativeReadReuseRegions(regions);
#endif
 }
 stream.ResetBuffer();j.Begin();
 const unsigned second=offsetof(CMIPS,m_State.nGPR[2]);
 const unsigned ctl=offsetof(CMIPS,m_State.savedIntReg);
 if(mode!=12&&mode!=18){read(j,type,src);store(j,type,out);}
 switch(mode){
 case 0: break;
 case 1: j.PushCst(0xa8123456);j.PullRel(src+arg);break;
 case 2: j.PushCst(0xa8123456);j.PullRel(second);break;
 case 3: j.MD_PushRel(second);j.MD_PullRel(src,arg&1,arg&2,arg&4,arg&8);break;
 case 4:
  j.PushCtx();j.PushCst(src);j.PushCst(out);j.Call(reinterpret_cast<void*>(0x1234),3,Jitter::CJitter::RETURN_VALUE_NONE);break;
 case 5:
  j.PushRelAddrRef(src);j.PushCst(0);j.AddRef();
  if(arg==8){j.PushRel64(second);j.Store64AtRef();}
  else if(arg==16){j.MD_PushRel(second);j.MD_StoreAtRef();}
  else if(arg>=32){j.PushCst(0);j.MD_PushRel(second);if((arg&15)==15)j.MD_StoreAtRefIdx(1);else j.MD_StoreAtRefIdxMasked(arg&1,arg&2,arg&4,arg&8);}
  else {j.PushRel(second);if(arg==1)j.Store8AtRef();else if(arg==2)j.Store16AtRef();else j.StoreAtRef();}
  break;
 case 6:
  j.PushRel(ctl);j.PushCst(0);j.BeginIf(Jitter::CONDITION_NE);
  j.PushCst(0x89345678);j.PullRel(src);j.Else();
  j.PushCst(0x98456789);j.PullRel(src);j.EndIf();break;
 case 7:{
  auto loop=j.CreateLabel();j.MarkLabel(loop);
  read(j,type,src);store(j,type,out+32);
  j.PushRel(ctl);j.PushCst(1);j.Sub();j.PullRel(ctl);
  j.PushRel(ctl);j.PushCst(0);j.BeginIf(Jitter::CONDITION_NE);j.Goto(loop);j.EndIf();break;}
 case 8:
  // Source is explicitly supplied from R0/VF0/scratch/ACC/flags in the driver.
  break;
 case 9:
  j.MD_PushRel(src);j.MD_PushRel(second);j.MD_AddS();j.MD_PushRel(second);j.MD_Xor();j.PushTop();
  j.MD_MakeSignZero();j.PullRel(ctl);j.MD_PullRel(out+32);break;
 case 10:
  // Source emitter order for SELECT is src2, src3, src1.
  j.PushRel(src);j.PushRel(src);j.PushRel(second);j.Select();j.PullRel(out+32);break;
 case 11:
  if(type==0){j.PushRel(src);j.PushCst(1);j.Add();}
  else if(type==1){j.PushRel64(src);j.PushCst64(1);j.Add64();}
  else if(type==2){j.FP_PushRel32(src);j.FP_NegS();}
  else {j.MD_PushRel(src);j.MD_Not();}
  store(j,type,src);break;
 case 12:
  // A trapping earlier operand must occur before any capture of src.
  j.PushRel(arg);j.PushRel(src);j.Add();j.PullRel(out+32);break;
 case 13:
  for(unsigned k=0;k<arg;k++){j.PushRel(second);j.PushCst(k+1);j.Add();j.PullRel(out+32+k*4);}
  break;
 case 14:
  // Actual frontend VF0 discard contract remains a separate emitter rule.
  j.MD_PushRel(src);VUShared::PullVector(static_cast<CMipsJitter*>(&j),0,offsetof(CMIPS,m_State.nCOP2[0]));break;
 case 15:
  for(unsigned k=0;k<4;k++){read(j,k,src);store(j,k,out+32+k*16);}
  for(unsigned k=0;k<4;k++){read(j,k,src,true);store(j,k,out+96+k*16);}
  break;
 case 18: j.PushCst(0xdedcab89);j.PullRel(src);break;
 case 17:
  // Known baseline frontend bug negative, deliberately preserved: all-true
  // MD_StoreAtRefIdxMasked calls the load frontend and leaves no actual store.
  j.PushRelAddrRef(src);j.PushCst(0);j.AddRef();j.PushCst(0);j.MD_PushRel(second);
  j.MD_StoreAtRefIdxMasked(true,true,true,true);break;
 case 16:
  for(unsigned k=0;k<9;k++){read(j,type,src+k*16);store(j,type,out+32+k*16);}
  for(unsigned k=0;k<9;k++){read(j,type,src+k*16,true);store(j,type,out+192+k*16);}
  break;
 }
 if(mode!=18){read(j,type,src,true);store(j,type,out+16);}
 j.End();return reinterpret_cast<uintptr_t>(stream.GetBuffer());
}
