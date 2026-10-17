#include <cstdint>
static thread_local uint64_t clockUs = 0;
static unsigned clockCalls = 0;
static uint64_t TestNow() { ++clockCalls; return clockUs; }
#define CLOUD_CPU_TIMING_TEST_NOW TestNow
#include "../deploy/webrcade/retro-play/native/CpuTiming.h"
#include <cassert>
#include <thread>
#include <stdexcept>
#include <iostream>
using namespace CloudCpuTiming;
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
  std::thread worker([] { clockUs=0; {Scope wait(GSWait,true);clockUs=80;} });worker.join();
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
 std::cout << "PASS exclusive nesting, disabled zero clocks, toggle epochs, exception unwinding, cross-thread separation, sparse coverage " << samples << "/64000\n";
}
