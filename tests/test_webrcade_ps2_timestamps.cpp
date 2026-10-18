// g++ -std=c++17 -Wall -Wextra -Werror tests/test_webrcade_ps2_timestamps.cpp -o /tmp/ps2-timestamps && /tmp/ps2-timestamps
#include "../deploy/webrcade/retro-play/gpu/timestamp-sampling.hpp"
#include <cassert>
#include <cstdio>
int main() {
 TimestampSampling state; int maps=0, unmaps=0, reads=0;
 auto unmap=[&] { ++unmaps; };
 auto submit=[&](bool supported=true) { if(state.can_begin(supported)) { state.begin(); ++maps; return true; } return false; };
 auto collect=[&](bool valid=true, std::uint64_t a=10, std::uint64_t b=40) {
  state.collect([&](auto& start, auto& end) { ++reads; start=a; end=b; return valid; }, unmap);
 };
 for(int i=0;i<100;++i) { assert(!submit()); }
 assert(maps==0);
 state.reset(true,unmap); assert(!submit(false)); assert(submit()); assert(!submit());
 state.reset(false,unmap); assert(state.pending); assert(unmaps==0);
 state.reset(true,unmap); assert(!submit()); // Old map still owns the only buffer.
 state.complete(true,unmap); assert(unmaps==1 && !state.pending); collect();
 assert(reads==0 && state.samples==0); // Late old-epoch success cannot pollute totals.
 assert(submit()); state.complete(true,unmap); collect();
 assert(state.samples==1 && state.ns==30 && reads==1 && unmaps==2);
 assert(submit()); state.complete(true,unmap);
 state.reset(false,unmap); assert(unmaps==3 && !state.pending); collect(); assert(reads==1);
 assert(state.samples==0 && state.ns==0);
 state.reset(true,unmap); assert(submit()); state.complete(false,unmap);
 assert(!state.pending && unmaps==3); assert(submit()); state.complete(true,unmap); collect(false);
 assert(state.samples==0 && unmaps==4);
 assert(submit()); state.complete(true,unmap); collect(true,40,10); assert(state.samples==0);
 // Same-enabled reset models state load/rewind and rejects a pending old sample.
 assert(submit()); state.reset(true,unmap); state.complete(true,unmap); assert(state.samples==0 && !state.pending);
 assert(submit()); state.reset(false,unmap); state.complete(false,unmap); assert(!state.pending);
 // Device destruction may deliver successful or failed late callbacks; neither
 // resumes collection nor leaves a successful mapping owned after shutdown.
 state.reset(true,unmap); assert(submit()); state.reset(false,unmap);
 state.complete(true,unmap); assert(!state.pending && !submit() && !state.samples);
 std::puts("PASS timestamp default-off, capability, one-map ownership, toggle/reset epochs, failed maps and shutdown callbacks");
}
