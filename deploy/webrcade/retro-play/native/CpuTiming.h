// Opt-in host wall timing. No guest state, clocks or save format are changed.
#pragma once
#include <atomic>
#include <chrono>
#include <cstdint>

namespace CloudCpuTiming {
enum Category { EE, IOP, VU, SPU, Compile, GSWait, DiscWait, GSSync, Count };
inline const char* Name(unsigned i) {
 static const char* names[] = {"EE", "IOP", "VU", "SPU", "Compile", "GSWait", "DiscWait", "GSSync"};
 return names[i];
}
// Low bit enables collection; remaining bits distinguish toggle epochs. Totals
// remain monotonic so main-thread reads never race a worker resetting counters.
inline std::atomic<uint32_t>& State() { static std::atomic<uint32_t> state{0}; return state; }
inline uint32_t SetEnabled(bool enabled) {
 auto old = State().load(std::memory_order_relaxed);
 if(bool(old & 1) != enabled) State().store(((old + 2) & ~1U) | unsigned(enabled), std::memory_order_relaxed);
 return State().load(std::memory_order_relaxed);
}
struct Counter {
 std::atomic<uint64_t> calls{0}, samples{0}, microseconds{0};
};
inline Counter* Counters() { static Counter counters[Count]; return counters; }
inline uint64_t Now() {
#ifdef CLOUD_CPU_TIMING_TEST_NOW
 return CLOUD_CPU_TIMING_TEST_NOW();
#else
 return std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
#endif
}
class Scope;
inline Scope*& Active() { static thread_local Scope* active = nullptr; return active; }
inline bool SelectSample() {
 // Different categories share a pseudorandom stream, avoiding every-64th-call
 // aliasing against a periodic guest scene. This is a sample, not CPU occupancy.
 static thread_local uint32_t random = 0x6d2b79f5;
 random ^= random << 13; random ^= random >> 17; random ^= random << 5;
 return (random & 63) == 0;
}
class Scope {
 uint32_t epoch;
 Category category;
 Scope* parent = nullptr;
 uint64_t start = 0, children = 0;
 bool sampled = false;
public:
 explicit Scope(Category value, bool every = false, bool enabled = true) : epoch(enabled ? State().load(std::memory_order_relaxed) : 0), category(value) {
  if(!(epoch & 1)) return;
  Counters()[category].calls.fetch_add(1, std::memory_order_relaxed);
  parent = Active();
  sampled = every || parent || SelectSample();
  if(sampled) { start = Now(); Active() = this; }
 }
 ~Scope() {
  if(!sampled) return;
  const auto end = Now();
  const auto elapsed = end >= start ? end - start : 0;
  Active() = parent;
  if(parent) parent->children += elapsed;
  if(State().load(std::memory_order_relaxed) != epoch) return;
  auto& counter = Counters()[category];
  counter.microseconds.fetch_add(elapsed >= children ? elapsed - children : 0, std::memory_order_relaxed);
  counter.samples.fetch_add(1, std::memory_order_relaxed);
 }
 Scope(const Scope&) = delete;
 Scope& operator=(const Scope&) = delete;
};

// Hot paths call Timed: when collection is off the body runs inline with no
// destructor in the caller's frame. Emscripten's JS exception lowering routes
// every call inside a frame holding a Scope through an invoke_* trampoline, so
// a Scope must only exist on the enabled path.
template<class F> __attribute__((noinline)) auto TimedEnabled(Category category, bool every, F&& body) -> decltype(body()) {
 Scope scope(category, every);
 return body();
}
template<class F> inline auto Timed(Category category, bool every, F&& body) -> decltype(body()) {
 if(!(State().load(std::memory_order_relaxed) & 1)) return body();
 return TimedEnabled(category, every, static_cast<F&&>(body));
}
}
