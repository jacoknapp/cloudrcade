// Host-only fixture for opt-in slice totals. No emulation or native build.
#define __EMSCRIPTEN__ 1
#include "WasmTimingProfile.h"
#include <cassert>
#include <thread>
#include <iostream>
using namespace DolphinWeb::WasmTimingProfile;
int main()
{
  assert(!BeginSlice());
  FinishSlice(100, 60, 40);
  assert(CaptureSliceTotals().slices == 0);
  SetEnabled(true);
  assert(BeginSlice());
  RecordCompileUs(10);
  RecordThrottleWaitUs(20, 20, 0);
  RecordDvdWaitUs(5);
  FinishSlice(100, 60, 40);
  assert(BeginSlice());
  RecordCompileUs(3);
  FinishSlice(10, 6, 4);  // below worst, still included
  auto t = CaptureSliceTotals();
  assert(t.slices == 2 && t.total_us == 110);
  assert(t.advance_inclusive_us == 66 && t.execute_inclusive_us == 44);
  assert(t.compile_subset_us == 13);
  assert(t.throttle_blocked_subset_us == 20 && t.dvd_blocked_subset_us == 5);
  SetEnabled(false);
  assert(!BeginSlice());
  FinishSlice(1000, 600, 400);
  assert(CaptureSliceTotals().slices == 2);
  SetEnabled(true); // process totals survive toggle, avoiding cross-thread reset
  assert(CaptureSliceTotals().slices == 2);
  std::atomic<bool> done{false};
  std::thread reader([&] {
    while (!done.load()) {
      const auto n = CaptureSliceTotals();
      assert(n.total_us == 110 + (n.slices - 2) * 10);
      assert(n.advance_inclusive_us == 66 + (n.slices - 2) * 6);
      assert(n.execute_inclusive_us == 44 + (n.slices - 2) * 4);
    }
  });
  for (int i = 0; i < 10000; ++i) {
    assert(BeginSlice());
    FinishSlice(10, 6, 4);
  }
  done.store(true); reader.join();
  assert(CaptureSliceTotals().slices == 10002);
  const auto before_clamp = CaptureSliceTotals();
  CurrentSlice oversized{};
  oversized.compile_us = oversized.throttle_wait_us = oversized.dvd_wait_us = 100;
  RecordSliceTotals(10, 100, 100, oversized);
  const auto clamped = CaptureSliceTotals();
  assert(clamped.execute_inclusive_us - before_clamp.execute_inclusive_us == 10);
  assert(clamped.advance_inclusive_us - before_clamp.advance_inclusive_us == 10);
  assert(clamped.compile_subset_us - before_clamp.compile_subset_us == 10);
  assert(clamped.throttle_blocked_subset_us - before_clamp.throttle_blocked_subset_us == 10);
  assert(clamped.dvd_blocked_subset_us - before_clamp.dvd_blocked_subset_us == 10);
  std::atomic<std::uint64_t> sat{std::numeric_limits<std::uint64_t>::max()-1};
  AddSliceTotal(sat, 3);
  assert(sat.load() == std::numeric_limits<std::uint64_t>::max());
  std::cout << "slice totals: pass (disabled, cumulative, nested subsets, snapshot race, saturation)\n";
}
