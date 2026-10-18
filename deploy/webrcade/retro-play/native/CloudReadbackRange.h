// Conservative source pages consumed by Play!'s actual local-to-host reader.
#pragma once
#include <algorithm>
#include <cstdint>

namespace CloudReadbackRange {
struct Range { std::uint32_t offset, bytes; };
inline constexpr std::uint32_t MemorySize = 4u * 1024 * 1024;
inline Range Plan(std::uint32_t psm, std::uint32_t pointer, std::uint32_t width,
                  std::uint32_t ssax, std::uint32_t ssay, std::uint32_t rrw,
                  std::uint32_t rrx, std::uint32_t rry, std::uint32_t bytes) {
 const Range full{0, MemorySize};
 std::uint64_t pixels = 0, pw = 64, ph = 32;
 switch(psm) {
 case 0x00: case 0x30: pixels = bytes / 4; break; // CT32/Z32
 case 0x01: case 0x31: pixels = (std::uint64_t(bytes) + 2) / 3; break; // CT24/Z24
 case 0x02: case 0x3a: pixels = bytes / 2; ph = 64; break; // CT16/Z16S
 case 0x13: pixels = bytes; pw = 128; ph = 64; break; // T8
 case 0x1b: pixels = bytes; break; // T8H reads CT32 storage
 default: return full;
 }
 if(!pixels || !rrw || rrx >= rrw || pointer >= MemorySize || pointer % 256) return full;
 const std::uint64_t last = std::uint64_t(rrx) + pixels - 1;
 const std::uint64_t x0 = std::uint64_t(ssax) + (last >= rrw ? 0 : rrx);
 const std::uint64_t x1 = std::uint64_t(ssax) + (last >= rrw ? rrw - 1 : last);
 const std::uint64_t y0 = std::uint64_t(ssay) + rry;
 const std::uint64_t y1 = y0 + last / rrw;
 if(x1 >= 2048 || y1 >= 2048) return full;
 // Preserve CPixelIndexor's multiplication/division order for odd/zero SBW.
 const auto row = [&](std::uint64_t y) { return (y / ph) * (std::uint64_t(width) * 64) / pw; };
 const auto first = x0 / pw + row(y0), final = x1 / pw + row(y1);
 const auto lo = pointer + first * 8192, hi = pointer + (final + 1) * 8192;
 if(lo >= hi || hi > MemorySize) return full;
 return {std::uint32_t(lo), std::uint32_t(hi - lo)};
}
}
