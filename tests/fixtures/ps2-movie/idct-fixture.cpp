// Standalone differential and throughput fixture; see README.md.
#include "idct/IEEE1180.h"
#include <array>
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" void pinnedTransform(const int16*, int16*);
using Block = std::array<int16, 64>;
static uint32_t rng = 0x821f356a;
static uint32_t random32() { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return rng; }
static uint64_t checksum = 0;
static bool check(const Block& input)
{
 Block expected{}, actual{}, alias = input;
 pinnedTransform(input.data(), expected.data());
 IDCT::CIEEE1180::GetInstance()->Transform(input.data(), actual.data());
 IDCT::CIEEE1180::GetInstance()->Transform(alias.data(), alias.data());
 for(unsigned i = 0; i < 64; ++i) {
  if(actual[i] != expected[i] || alias[i] != expected[i]) {
   std::printf("FAIL coefficient=%u expected=%d actual=%d alias=%d\n", i, expected[i], actual[i], alias[i]);
   return false;
  }
  checksum = (checksum * 0x100000001b3ULL) ^ static_cast<uint16_t>(actual[i]);
 }
 return true;
}
int main()
{
 std::vector<Block> blocks;
 blocks.push_back({});
 // Each DC value, especially multiples of four, stresses x+0.5 boundaries.
 for(int dc = -4096; dc <= 4095; ++dc) { Block b{}; b[0] = dc; blocks.push_back(b); }
 for(unsigned coefficient = 0; coefficient < 64; ++coefficient)
  for(int value : {-32768, -2048, -1, 1, 2047, 32767}) { Block b{}; b[coefficient] = value; blocks.push_back(b); }
 for(unsigned n = 0; n < 100000; ++n) {
  Block b;
  for(auto& value : b) value = static_cast<int16>(random32());
  if(n % 4 != 0) for(auto& value : b) value = (static_cast<uint16_t>(value) & 4095) - 2048;
  if(n % 7 == 0) for(unsigned i = 1; i < 64; ++i) if(random32() & 3) b[i] = 0;
  blocks.push_back(b);
 }
 for(const auto& b : blocks) if(!check(b)) return 1;
 std::printf("PASS blocks=%zu coefficients=%zu alias=true checksum=%016llx\n", blocks.size(), blocks.size() * 64, static_cast<unsigned long long>(checksum));
 // Equal inputs, unchanged reference, alternating order, no per-call clocks.
 Block output{};
 volatile uint32_t sink = 0;
 auto time = [&](bool simd) {
  const auto start = std::chrono::steady_clock::now();
  for(unsigned repeat = 0; repeat < 3; ++repeat) for(const auto& b : blocks) {
   if(simd) IDCT::CIEEE1180::GetInstance()->Transform(b.data(), output.data());
   else pinnedTransform(b.data(), output.data());
   sink = sink ^ static_cast<uint16_t>(output[repeat]);
  }
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
 };
 for(unsigned pair = 0; pair < 6; ++pair) {
  double scalar, simd;
  if(pair % 2 == 0) { scalar = time(false); simd = time(true); }
  else { simd = time(true); scalar = time(false); }
  std::printf("pair=%u order=%s scalar_ms=%.3f simd_ms=%.3f ratio=%.4f\n", pair, pair % 2 ? "SIMD,scalar" : "scalar,SIMD", scalar, simd, simd/scalar);
 }
 return sink == 0x12345678 ? 1 : 0;
}
