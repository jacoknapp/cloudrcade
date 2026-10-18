#pragma once
// Opt-in VM-thread movie diagnostics. Counters are not part of guest save state.
#include "CloudCpuTiming.h"
#include <atomic>
#include <chrono>
#include <cstdint>

namespace CloudMovieMetrics
{
struct Counters
{
 std::atomic<uint32_t> token{0};
 std::atomic<uint32_t> codedBlocks{0}, uncodedBlocks{0};
 std::atomic<uint32_t> idctCalls{0}, zeroBlocks{0}, dcOnlyBlocks{0}, acBlocks{0};
 std::atomic<uint32_t> idctSamples{0}, cscBlocks{0}, cscSamples{0};
 std::atomic<uint64_t> idctNanoseconds{0}, cscNanoseconds{0};
};
inline Counters& Data() { static Counters data; return data; }
// All writers run on the VM worker. Publish the epoch only after its reset.
inline uint32_t Begin()
{
 const auto token = CloudCpuTiming::State().load(std::memory_order_relaxed);
 if(!(token & 1)) return 0;
 auto& d = Data();
 if(d.token.load(std::memory_order_relaxed) != token)
 {
  d.token.store(0, std::memory_order_release);
  d.codedBlocks = 0; d.uncodedBlocks = 0; d.idctCalls = 0;
  d.zeroBlocks = 0; d.dcOnlyBlocks = 0; d.acBlocks = 0;
  d.idctSamples = 0; d.idctNanoseconds = 0;
  d.cscBlocks = 0; d.cscSamples = 0; d.cscNanoseconds = 0;
  d.token.store(token, std::memory_order_release);
 }
 return token;
}
inline void Block(bool coded)
{
 if(Begin()) (coded ? Data().codedBlocks : Data().uncodedBlocks).fetch_add(1, std::memory_order_relaxed);
}
class Scope
{
public:
 explicit Scope(const int16_t* block) : m_idct(block != nullptr), m_token(Begin())
 {
  if(!m_token) return;
  auto& d = Data();
  (m_idct ? d.idctCalls : d.cscBlocks).fetch_add(1, std::memory_order_relaxed);
  if(m_idct)
  {
   bool ac = false;
   for(unsigned i = 1; i < 64; ++i) ac |= block[i] != 0;
   (ac ? d.acBlocks : block[0] ? d.dcOnlyBlocks : d.zeroBlocks).fetch_add(1, std::memory_order_relaxed);
  }
  m_sample = CloudCpuTiming::SelectSample();
  if(m_sample) m_start = std::chrono::steady_clock::now();
 }
 ~Scope()
 {
  if(!m_sample || CloudCpuTiming::State().load(std::memory_order_relaxed) != m_token) return;
  const auto elapsed = std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - m_start).count();
  auto& d = Data();
  (m_idct ? d.idctNanoseconds : d.cscNanoseconds).fetch_add(elapsed, std::memory_order_relaxed);
  (m_idct ? d.idctSamples : d.cscSamples).fetch_add(1, std::memory_order_relaxed);
 }
 Scope(const Scope&) = delete;
 Scope& operator=(const Scope&) = delete;
private:
 bool m_idct, m_sample = false;
 uint32_t m_token;
 std::chrono::steady_clock::time_point m_start;
};
struct Snapshot
{
 uint32_t epoch = 0;
 uint32_t codedBlocks = 0, uncodedBlocks = 0;
 uint32_t idctCalls = 0, zeroBlocks = 0, dcOnlyBlocks = 0, acBlocks = 0;
 uint32_t idctSamples = 0, cscBlocks = 0, cscSamples = 0;
 double idctMicroseconds = 0, cscMicroseconds = 0;
};
inline Snapshot Read()
{
 const auto token = CloudCpuTiming::State().load(std::memory_order_relaxed);
 Snapshot s; s.epoch = token;
 auto& d = Data();
 if(!(token & 1) || d.token.load(std::memory_order_acquire) != token) return s;
#define CLOUD_MOVIE_READ(name) s.name = d.name.load(std::memory_order_relaxed)
 CLOUD_MOVIE_READ(codedBlocks); CLOUD_MOVIE_READ(uncodedBlocks);
 CLOUD_MOVIE_READ(idctCalls); CLOUD_MOVIE_READ(zeroBlocks); CLOUD_MOVIE_READ(dcOnlyBlocks); CLOUD_MOVIE_READ(acBlocks);
 CLOUD_MOVIE_READ(idctSamples);
 s.idctMicroseconds = d.idctNanoseconds.load(std::memory_order_relaxed) / 1000.0;
 CLOUD_MOVIE_READ(cscBlocks); CLOUD_MOVIE_READ(cscSamples);
 s.cscMicroseconds = d.cscNanoseconds.load(std::memory_order_relaxed) / 1000.0;
#undef CLOUD_MOVIE_READ
 if(d.token.load(std::memory_order_acquire) != token || CloudCpuTiming::State().load(std::memory_order_relaxed) != token) {
  s = {}; s.epoch = CloudCpuTiming::State().load(std::memory_order_relaxed);
 }
 return s;
}
}
