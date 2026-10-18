#include HEADER
#include <cstdint>
using Body = uint32_t (*)(uint32_t);
extern "C" uint32_t body(uint32_t input) {return (input * 1664525U + 1013904223U) ^ (input >> 7);}
extern "C" uintptr_t bodyPointer() {return reinterpret_cast<uintptr_t>(&body);}
extern "C" uint32_t runTimed(uint32_t loops, Body body) {
 uint32_t sum=0;
 for(uint32_t i=0;i<loops;++i) sum += CloudCpuTiming::Timed(CloudCpuTiming::EE,false,[&]{return body(i);});
 return sum;
}
extern "C" uint32_t runDirect(uint32_t loops, Body body) {
 uint32_t sum=0;
 for(uint32_t i=0;i<loops;++i) sum += body(i);
 return sum;
}
extern "C" unsigned enable(unsigned value) {return CloudCpuTiming::SetEnabled(value);}
extern "C" double calls() {return CloudCpuTiming::Counters()[CloudCpuTiming::EE].calls.load();}
extern "C" double samples() {return CloudCpuTiming::Counters()[CloudCpuTiming::EE].samples.load();}
