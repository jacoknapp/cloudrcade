#include "core/arm/dyncom/wasm_translation_cache.h"
#include <cassert>
#include <iostream>
namespace Memory { struct PageTable {}; }
int main() {
    std::size_t top = 0;
    WasmTranslationCache cache(top, 1024);
    auto process = std::make_shared<Memory::PageTable>();
    cache.SelectPageTable(process);
    auto& core0 = cache.Blocks();
    core0[0x1000] = 64; top = 128;
    cache.SelectPageTable(process);
    auto& core1 = cache.Blocks();
    assert(core1.at(0x1000) == 64 && top == 128);
    core1[0x1001] = 128; top = 192; // Same address in Thumb mode is a different block.
    assert(core0.at(0x1000) != core0.at(0x1001));
    auto other = std::make_shared<Memory::PageTable>();
    cache.SelectPageTable(other);
    assert(core0.empty() && core1.empty() && top == 0);
    core1[0x1000] = 0; top = 768;
    cache.ReserveBlock(256); assert(!core0.empty() && top == 768);
    top = 769; cache.ReserveBlock(256);
    assert(core0.empty() && top == 0); // Arena reuse cannot retain stale offsets on another CPU.
    core0[0x1000] = 0; top = 256; cache.Reset();
    assert(core1.empty() && top == 0); // Guest code invalidation clears every CPU's view.
    std::weak_ptr<Memory::PageTable> weak = other;
    other.reset(); assert(weak.expired()); // Cache must not retain a terminated process.
    core0[0x1000] = 0; top = 256;
    cache.SelectPageTable(process); assert(core0.empty() && top == 0);
    for (unsigned i = 0; i < 10000; ++i) {
        cache.SelectPageTable(process); cache.ReserveBlock(256);
        cache.Blocks()[i] = top; top += 256;
        assert(top <= 1024);
        for (const auto& block : cache.Blocks()) assert(block.second < top);
    }
    std::cout << "PASS process reuse, shared CPU invalidation, ARM/Thumb identities, lifetime and bounded arena rollover\n";
}
