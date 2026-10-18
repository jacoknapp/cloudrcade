// Optional raw handoff diagnostics. All guest work and synchronization stay intact.
#pragma once
#include "CloudCpuTiming.h"
#include <atomic>
#include <cstdint>
#include <limits>
#ifndef CLOUD_HANDOFF_TEST_CLOCK
#include <emscripten.h>
#endif

namespace CloudHandoff {
enum Kind : uint32_t { Enqueue=1, WaitBegin, WaitEnd, ExecuteBegin, ExecuteEnd,
                       BridgePost, BridgeReturn };
constexpr uint32_t Capacity=16384;
struct Event {
 std::atomic<uint32_t> ready{0};
 double ms=0;
 uint32_t kind=0,epoch=0,thread=0,mailbox=0,message=0,parent=0;
};
inline Event* Events() { static Event events[Capacity]; return events; }
inline std::atomic<uint32_t>& Reserved() { static std::atomic<uint32_t> v{0}; return v; }
inline std::atomic<uint32_t>& Dropped() { static std::atomic<uint32_t> v{0}; return v; }
inline void Increment(std::atomic<uint32_t>& value) {
 auto old=value.load(std::memory_order_relaxed);
 while(old!=std::numeric_limits<uint32_t>::max()&&!value.compare_exchange_weak(old,old+1,std::memory_order_relaxed)) {}
}
inline uint32_t Id() {
 static std::atomic<uint32_t> ids{0};auto old=ids.load(std::memory_order_relaxed);
 while(old!=std::numeric_limits<uint32_t>::max()) {
  if(ids.compare_exchange_weak(old,old+1,std::memory_order_relaxed))return old+1;
 }
 return std::numeric_limits<uint32_t>::max();
}
inline uint32_t Epoch() { return CloudCpuTiming::State().load(std::memory_order_relaxed); }
inline bool Enabled(uint32_t epoch) { return (epoch&1)&&Epoch()==epoch; }
inline uint32_t& CurrentMessage() { static thread_local uint32_t v=0; return v; }
inline uint32_t Thread() { static thread_local uint32_t v=Id(); return v; }
inline double Now() {
#ifdef CLOUD_HANDOFF_TEST_CLOCK
 return CLOUD_HANDOFF_TEST_CLOCK();
#else
 return EM_ASM_DOUBLE({return performance.timeOrigin+performance.now();});
#endif
}
// Append only for the module lifetime. No resetting/overwriting concurrent writers.
inline void Record(uint32_t epoch,Kind kind,uint32_t mailbox,uint32_t message,uint32_t parent=0) {
 if(!Enabled(epoch))return;
 auto slot=Reserved().load(std::memory_order_relaxed);
 while(slot<Capacity&&!Reserved().compare_exchange_weak(slot,slot+1,std::memory_order_relaxed)) {}
 if(slot==Capacity){Increment(Dropped());return;}
 auto& e=Events()[slot];e.ms=Now();e.kind=kind;e.epoch=epoch;e.thread=Thread();
 e.mailbox=mailbox;e.message=message;e.parent=parent;
 e.ready.store(1,std::memory_order_release);
}
struct MessageScope {
 uint32_t previous;
 explicit MessageScope(uint32_t message):previous(CurrentMessage()) {CurrentMessage()=message;}
 ~MessageScope(){CurrentMessage()=previous;}
};
// Cleanup lives only in this enabled frame. The ordinary call keeps its original
// exception lowering when diagnostic timing is off.
template<class F> __attribute__((noinline)) void Execute(uint32_t epoch,uint32_t mailbox,uint32_t message,uint32_t parent,F&& body) {
 MessageScope scope(message);Record(epoch,ExecuteBegin,mailbox,message,parent);
 body();
 // This precedes the original promise publication in CMailBox::ReceiveCall.
 Record(epoch,ExecuteEnd,mailbox,message,parent);
}
}
