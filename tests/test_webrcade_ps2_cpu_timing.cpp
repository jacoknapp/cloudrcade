#include <cstdint>
static thread_local uint64_t clockUs = 0;
static unsigned clockCalls = 0;
static uint64_t TestNow() { ++clockCalls; return clockUs; }
#define CLOUD_CPU_TIMING_TEST_NOW TestNow
#include "../deploy/webrcade/retro-play/native/CpuTiming.h"
#include <cassert>
#include <thread>
#include <stdexcept>
#include <type_traits>
#include <iostream>
using namespace CloudCpuTiming;
static_assert(std::is_trivially_destructible<Decision>::value, "Timing decisions must not introduce an EH cleanup frame");
int main() {
 { Scope off(EE,true); clockUs=10; }
 assert(clockCalls==0 && Counters()[EE].calls==0);
 SetEnabled(true);
 { Scope outer(EE,true); clockUs=20;
  { Scope compile(Compile,true); clockUs=50; }
  clockUs=70;
  { Scope wait(DiscWait,true); clockUs=90; }
  clockUs=110;
 }
 assert(Counters()[EE].microseconds==50 && Counters()[Compile].microseconds==30 && Counters()[DiscWait].microseconds==20);
 assert(Counters()[EE].samples==1 && Counters()[EE].calls==1);
 const auto old=State().load();
 { Scope stale(VU,true); clockUs=120; SetEnabled(false); SetEnabled(true); clockUs=150; }
 assert(State().load()!=old && Counters()[VU].samples==0);
 try { Scope unwind(Compile,true); clockUs=170; throw std::runtime_error("fixture"); } catch(const std::runtime_error&) {}
 assert(!Active() && Counters()[Compile].microseconds==50);
 // Other-thread blocked time must not be subtracted from this thread's EE.
 { Scope outer(EE,true);
  std::thread worker([] { clockUs=0; Timed(GSWait,true,[] {clockUs=80;}); });worker.join();
  clockUs=180;
 }
 assert(Counters()[EE].microseconds==60 && Counters()[GSWait].microseconds==80);
 auto clocks=clockCalls;
 SetEnabled(false);
 for(unsigned i=0;i<10000;++i){Scope off(IOP);}
 assert(clockCalls==clocks && Counters()[IOP].calls==0);
 SetEnabled(true);
 for(unsigned i=0;i<64000;++i){Scope sparse(IOP);clockUs++;}
 auto samples=Counters()[IOP].samples.load();
 assert(samples>800 && samples<1200 && Counters()[IOP].calls==64000);
 {Scope skipped(GSSync,true,false);clockUs+=100;}
 assert(Counters()[GSSync].calls==0);
 // Timed must make exactly the same sparse decisions as direct Scope, without
 // entering a cleanup frame on the unsampled path or double-counting calls.
 uint32_t random = 0x6d2b79f5;
 auto nextSample = [&] {
  random ^= random << 13; random ^= random >> 17; random ^= random << 5;
  return (random & 63) == 0;
 };
 for(unsigned i=0;i<64000;++i) nextSample();
 const auto beforeCalls = Counters()[IOP].calls.load();
 const auto beforeSamples = Counters()[IOP].samples.load();
 const auto beforeUs = Counters()[IOP].microseconds.load();
 const auto beforeClocks = clockCalls;
 unsigned expectedSamples = 0;
 for(unsigned i=0;i<4096;++i) {
  const bool expected = nextSample(); expectedSamples += expected;
  const auto result = Timed(IOP, false, [&] {
   assert(bool(Active()) == expected);
   clockUs += 3;
   return i + 7;
  });
  assert(result == i + 7 && !Active());
 }
 assert(Counters()[IOP].calls == beforeCalls + 4096);
 assert(Counters()[IOP].samples == beforeSamples + expectedSamples);
 assert(Counters()[IOP].microseconds == beforeUs + 3 * expectedSamples);
 assert(clockCalls == beforeClocks + 2 * expectedSamples);
 // An active sampled parent forces sparse children without consuming RNG.
 const auto eeUs = Counters()[EE].microseconds.load();
 const auto vuUs = Counters()[VU].microseconds.load();
 const auto vuCalls = Counters()[VU].calls.load();
 Timed(EE, true, [&] {
  auto* outer = Active(); assert(outer); clockUs += 1;
  Timed(VU, false, [&] {assert(Active() && Active()!=outer); clockUs += 7;});
  assert(Active() == outer); clockUs += 2;
 });
 assert(!Active() && Counters()[EE].microseconds == eeUs + 3);
 assert(Counters()[VU].microseconds == vuUs + 7 && Counters()[VU].calls == vuCalls + 1);
 const bool expectedAfterForced = nextSample();
 Timed(IOP, false, [&] {assert(bool(Active()) == expectedAfterForced);clockUs++;});
 // Every-call boundaries still time exceptions and discard stale epochs.
 const auto compileUs = Counters()[Compile].microseconds.load();
 try {Timed(Compile,true,[&]() -> int {clockUs+=5;throw std::runtime_error("timed fixture");});}
 catch(const std::runtime_error&) {}
 assert(!Active() && Counters()[Compile].microseconds == compileUs + 5);
 const auto staleSamples = Counters()[GSSync].samples.load();
 Timed(GSSync,true,[&] {clockUs+=11;SetEnabled(false);SetEnabled(true);clockUs+=13;});
 assert(!Active() && Counters()[GSSync].calls == 1 && Counters()[GSSync].samples == staleSamples);
 const auto disabledCalls = Counters()[IOP].calls.load();
 const auto disabledClocks = clockCalls;
 SetEnabled(false);
 for(unsigned i=0;i<10000;++i) assert(Timed(IOP,false,[&] {clockUs++;return 17;}) == 17);
 assert(Counters()[IOP].calls == disabledCalls && clockCalls == disabledClocks && !Active());
 std::cout << "PASS exclusive nesting, disabled zero clocks, toggle epochs, exception unwinding, cross-thread separation, sparse coverage " << samples << "/64000\n";
 std::cout << "PASS Timed decisions/return values/exclusive forced children/RNG sequence, " << expectedSamples << "/4096 sparse cleanup frames\n";
}
