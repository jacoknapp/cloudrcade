#include "core/arm/dyncom/wasm_translation_cache.h"
#include "video_core/renderer_opengl/wasm_prewarm_budget.h"
#include <cassert>
#include <iostream>
namespace Memory { struct PageTable {}; }
int main() {
    std::size_t top = 0;
    WasmTranslationCache cache(top, 1024);
    auto process = std::make_shared<Memory::PageTable>();
    cache.SelectPageTable(process);
    auto& core0 = cache.Blocks();
    cache.Store(0x1000, 64); top = 128;
    cache.SelectPageTable(process);
    auto& core1 = cache.Blocks();
    assert(core1.at(0x1000) == 64 && top == 128);
    cache.Store(0x1001, 128); top = 192; // Same address in Thumb mode is a different block.
    assert(core0.at(0x1000) != core0.at(0x1001));
    auto other = std::make_shared<Memory::PageTable>();
    cache.SelectPageTable(other);
    assert(core0.empty() && core1.empty() && top == 0);
    cache.Store(0x1000, 0); top = 768;
    cache.ReserveBlock(256); assert(!core0.empty() && top == 768);
    top = 769; cache.ReserveBlock(256);
    assert(core0.empty() && top == 0); // Arena reuse cannot retain stale offsets on another CPU.
    cache.Store(0x1000, 0); top = 256; cache.Reset();
    assert(core1.empty() && top == 0); // Guest code invalidation clears every CPU's view.
    std::weak_ptr<Memory::PageTable> weak = other;
    other.reset(); assert(weak.expired()); // Cache must not retain a terminated process.
    cache.Store(0x1000, 0); top = 256;
    cache.SelectPageTable(process); assert(core0.empty() && top == 0);
    for (unsigned i = 0; i < 10000; ++i) {
        cache.SelectPageTable(process); cache.ReserveBlock(256);
        cache.Store(i, top); top += 256;
        assert(top <= 1024);
        for (const auto& block : cache.Blocks()) assert(block.second < top);
    }
    std::size_t offset = 999;
    cache.Reset();
    assert(!cache.Find(0x1000, offset));
    // Also exercise a valid arena offset of zero, a different ARM block in
    // the same slot, and the Thumb translation of the original address.
    cache.Store(0x1000, 0);
    assert(cache.Find(0x1000, offset) && offset == 0);
    assert(!cache.Find(0x3000, offset));
    cache.Store(0x3000, 96);
    cache.Store(0x1001, 128);
    assert(cache.Find(0x3000, offset) && offset == 96);
    assert(cache.Find(0x1000, offset) && offset == 0);
    assert(cache.Find(0x1001, offset) && offset == 128);
    cache.Reset();
    assert(!cache.Find(0x1001, offset) && !cache.Find(0x3000, offset));
    cache.Store(0x1000, 16); cache.Store(0x1001, 32);
    assert(cache.Find(0x1000, offset) && offset == 16);
    assert(cache.Find(0x1001, offset) && offset == 32);
    cache.Store(0x1000, 48);
    assert(cache.Find(0x1000, offset) && offset == 48);
    for (unsigned i = 0; i < 30000; ++i) cache.Store(i, i * 7);
    for (unsigned i = 0; i < 30000; ++i) {
        assert(cache.Find(i, offset) && offset == i * 7);
    }
    // Decoded entries must not survive any arena/process invalidation.
    cache.Reset(); assert(!cache.Find(29999, offset));
    cache.Store(0x1000, 0); top = 769; cache.ReserveBlock(256);
    assert(!cache.Find(0x1000, offset));
    cache.Store(0x1000, 0); cache.SelectPageTable(std::make_shared<Memory::PageTable>());
    assert(!cache.Find(0x1000, offset));

    WasmPrewarmBudget<unsigned> budget;
    for (unsigned frame = 0; frame < 4; ++frame) {
        assert(budget.BeginFrame([](unsigned) { return false; }));
        for (unsigned j = 0; j < 2; ++j) {
            assert(budget.Available()); budget.Submit(frame * 2 + j);
        }
        assert(!budget.Available());
    }
    assert(budget.Pending() == 8);
    assert(budget.BeginFrame([](unsigned) { return false; }));
    assert(!budget.Available());
    assert(budget.BeginFrame([](unsigned p) { return p < 2; }));
    assert(budget.Pending() == 6 && budget.Available());
    budget.Consume(2); // Includes failed/deleted programs: never poll them again.
    assert(budget.Pending() == 5);
    budget.DemandWait();
    assert(!budget.BeginFrame([](unsigned) { return false; }));
    assert(!budget.BeginFrame([](unsigned) { return false; }));
    assert(budget.BeginFrame([](unsigned) { return true; }));
    assert(budget.Pending() == 0 && budget.Available());
    std::cout << "PASS flat cache collision/replacement/reset and bounded compiler completion/demand priority\n";
    std::cout << "PASS process reuse, shared CPU invalidation, ARM/Thumb identities, lifetime and bounded arena rollover\n";
}
