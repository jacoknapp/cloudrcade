// Cadence follows logical VI images; XFB fragments cannot flip a draw mid-frame.
#include "WasmFrameSkip.h"
#include <cassert>
#include <iostream>
using namespace DolphinWeb::FrameSkip;
int main()
{
  for (unsigned n = 1; n <= 4; ++n)
  {
    requested.store(n); ResetPhase();
    const auto old_frames = frames.load(), old_skipped = skipped_frames.load();
    for (unsigned i = 0; i < 240; ++i)
    {
      BeginDraw(); const bool decision = Skip();
      assert(decision == (i % n != 0));
      XfbCopied(); BeginDraw(); // Second fragment of the same displayed image.
      assert(Skip() == decision);
      XfbCopied(); EndFrame(decision);
      assert(Skip() == decision); // No change to already latched work.
    }
    assert(frames.load() - old_frames == 240);
    assert(skipped_frames.load() - old_skipped == 240 - 240 / n);
  }
  for (unsigned from = 1; from <= 4; ++from)
  for (unsigned to = 1; to <= 4; ++to)
  {
    requested.store(from); ResetPhase(); BeginDraw();
    requested.store(to); const bool decision = Skip();
    EndFrame(decision);
    assert(Skip() == decision); // VI can complete while the next GX image is in flight.
    BeginDraw(); assert(Skip() == decision);
    XfbCopied(); BeginDraw();
    if (from != to) assert(!Skip());
    const auto count = frames.load(); ResetPhase(); BeginDraw();
    assert(!Skip()); assert(frames.load() == count);
  }
  requested.store(2); ResetPhase(); BeginDraw();
  XfbCopied(); BeginDraw(); // Next image begins before the previous VI swap.
  EndFrame(false); assert(!Skip());
  XfbCopied(); BeginDraw(); assert(Skip());
  EndFrame(false); assert(Skip()); // Retained image never exposes a partly omitted draw.
  std::cout << "PASS native logical-frame cadence, multiple XFB copies, in-flight latching, Off and restore\n";
}
