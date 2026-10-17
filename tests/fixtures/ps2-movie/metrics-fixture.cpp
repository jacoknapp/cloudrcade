#include "CloudMovieMetrics.h"
#include <cassert>
#include <thread>
int main()
{
 using namespace CloudMovieMetrics;
 int16_t zero[64]{}, dc[64]{}, ac[64]{};
 dc[0] = 128; ac[63] = 1;
 for(int i = 0; i < 100; ++i) { Block(true); Scope s(zero); }
 assert(Read().codedBlocks == 0 && Read().idctCalls == 0);
 const auto firstEpoch = CloudCpuTiming::SetEnabled(true);
 for(int i = 0; i < 10000; ++i) {
  Block(true); Block(false);
  { Scope s(zero); } { Scope s(dc); } { Scope s(ac); } { Scope s(nullptr); }
 }
 auto s = Read();
 assert(s.epoch == firstEpoch);
 assert(s.codedBlocks == 10000 && s.uncodedBlocks == 10000);
 assert(s.idctCalls == 30000 && s.zeroBlocks == 10000 && s.dcOnlyBlocks == 10000 && s.acBlocks == 10000);
 assert(s.cscBlocks == 10000 && s.cscSamples > 50 && s.cscSamples < 300);
 assert(s.idctSamples > 200 && s.idctSamples < 800);
 assert(s.idctMicroseconds > 0 && s.cscMicroseconds > 0);
 // A timer spanning a toggle must not add a sample to either epoch.
 {
  Scope crossed(zero);
  CloudCpuTiming::SetEnabled(false);
  const auto disabled = Read();
  assert(disabled.idctCalls == 0 && disabled.idctSamples == 0);
  CloudCpuTiming::SetEnabled(true);
 }
 s = Read();
 assert(s.epoch != firstEpoch && s.idctCalls == 0 && s.idctSamples == 0);
 // Exercise a worker publishing counters while the main thread toggles/reads.
 std::thread worker([&] { for(int i = 0; i < 30000; ++i) { Block(true); Scope sample(ac); } });
 for(int i = 0; i < 1000; ++i) { CloudCpuTiming::SetEnabled(i & 1); (void)Read(); }
 worker.join();
 CloudCpuTiming::SetEnabled(false);
 assert(Read().codedBlocks == 0);
}
