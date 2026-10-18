// Optional timestamp collection, independent of adapter capability. One map
// owns the read buffer until its callback completes, even across toggle epochs.
#pragma once
#include <cstdint>
struct TimestampSampling {
 bool enabled = false, pending = false, ready = false;
 std::uint64_t epoch = 0, pending_epoch = 0, samples = 0, ns = 0;
 template<class Unmap> void reset(bool active, Unmap unmap) {
  enabled = active; ++epoch; samples = ns = 0;
  if (ready) { unmap(); ready = pending = false; }
 }
 bool can_begin(bool supported) const { return supported && enabled && !pending; }
 void begin() { pending = true; pending_epoch = epoch; }
 template<class Unmap> void complete(bool success, Unmap unmap) {
  if (!success) { pending = ready = false; return; }
  if (!enabled || pending_epoch != epoch) { unmap(); pending = ready = false; }
  else ready = true;
 }
 template<class Read, class Unmap> void collect(Read read, Unmap unmap) {
  if (!ready) return;
  std::uint64_t start = 0, end = 0;
  if (enabled && pending_epoch == epoch && read(start, end) && end > start) { ns += end - start; ++samples; }
  unmap(); ready = pending = false;
 }
};
