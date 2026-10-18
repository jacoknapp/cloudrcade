#include "CloudInstructionPage.h"
#include "xxhash.h"
#include <algorithm>
#include <cassert>
#include <cstdio>
#include <map>
#include <memory>
#include <set>
#include <utility>
#include <vector>
using uint8 = uint8_t;
using uint32 = uint32_t;
struct uint128 {
 uint64_t low, high;
 bool operator==(const uint128& other) const { return low == other.low && high == other.high; }
};
namespace PS2 { constexpr uint32 EE_RAM_SIZE = 4 * 1024 * 1024; }
struct Block {
 uint32 start, end;
 bool IsEmpty() const { return start == UINT32_MAX; }
 uint32 GetEndAddress() const { return end; }
};
static unsigned pageHashCalls, blockHashCalls;
static XXH128_hash_t TracedHash(const void* source, size_t length) {
 if(length == 4096) ++pageHashCalls; else ++blockHashCalls;
 return XXH3_128bits(source, length);
}
class CEeExecutor {
public:
 static constexpr uint32 MAX_BLOCK_SIZE = 4096;
 std::vector<uint8> memory;
 uint8* m_ram;
 std::map<uint32, Block> blocks;
#ifdef PROTOTYPE_SPARSE
 std::map<uint32,std::set<unsigned>> coverageOracle;
#endif
 Block empty{UINT32_MAX, UINT32_MAX};
 uint32 protectedStart = UINT32_MAX;
 explicit CEeExecutor() : memory(PS2::EE_RAM_SIZE), m_ram(memory.data()) {}
 const Block* FindBlockStartingAt(uint32 start) const {
  const auto found = blocks.find(start);
  return found == blocks.end() ? &empty : &found->second;
 }
 bool HasBlockAt(uint32 start) const { return !FindBlockStartingAt(start)->IsEmpty(); }
 void BaseClear(uint32 start, uint32 end, bool executing) {
  for(auto it = blocks.begin(); it != blocks.end();) {
   if(it->first < end && it->second.end >= start && (!executing || it->first != protectedStart)) it = blocks.erase(it);
   else ++it;
  }
 }
 void Compile(uint32 start, uint32 end) {
  assert(start <= end && end < PS2::EE_RAM_SIZE && end - start < MAX_BLOCK_SIZE);
  const auto xxHash = XXH3_128bits(m_ram + start, end - start + 4);
  uint128 hash;
  memcpy(&hash, &xxHash, sizeof(xxHash));
  #include "register.inc"
  blocks[start] = {start, end};
#ifdef PROTOTYPE_SPARSE
  for(uint64_t address=start;address<uint64_t(end)+4;++address)coverageOracle[uint32_t(address)&~4095U].insert((address%4096)/64);
#endif
 }
 void ClearActiveBlocksInRange(uint32 start, uint32 end, bool executing) {
  BaseClear(start, end, executing);
  #include "clear.inc"
#ifdef PROTOTYPE_SPARSE
  for(auto it=coverageOracle.begin();it!=coverageOracle.end();)if(!m_instructionPages.count(it->first))it=coverageOracle.erase(it);else++it;
#endif
 }
 void Reset() {
  #include "reset.inc"
  blocks.clear();
#ifdef PROTOTYPE_SPARSE
  coverageOracle.clear();
#endif
 }
 void SyncInstructionCache();
 #include "members.inc"
 void CheckMetadata() const {
  unsigned snapshots = 0;
  for(const auto& pair : m_instructionPages) {
   assert(!pair.second.entries.empty());
#ifdef PROTOTYPE_SPARSE
   const auto& covered=coverageOracle.at(pair.first);uint64_t wanted=0;
   for(auto chunk:covered)wanted|=uint64_t(1)<<chunk;
   if(covered.size()>16)wanted=UINT64_MAX;
   assert(pair.second.coverage==wanted);
#endif
   if(pair.second.snapshot) ++snapshots;
   for(auto start : pair.second.entries) {
    assert(HasBlockAt(start));
    assert((start & ~4095u) <= pair.first && (blocks.at(start).end & ~4095u) >= pair.first);
   }
  }
  assert(snapshots == m_instructionSnapshotCount && snapshots <= MAX_INSTRUCTION_SNAPSHOTS);
  for(const auto& pair : blocks) {
   assert(m_instructionHashes.count(pair.first));
   for(uint32 page = pair.first & ~4095u; page <= (pair.second.end & ~4095u); page += 4096)
    assert(m_instructionPages.at(page).entries.count(pair.first));
  }
 }
};
#define XXH3_128bits TracedHash
#include "sync.inc"
#undef XXH3_128bits
static_assert(noexcept(std::declval<const CloudInstructionPage&>().Equals(nullptr)));
static unsigned tests;
static void FlushAgainstReference(CEeExecutor& e, std::map<uint32, std::vector<uint8>>& reference) {
 std::vector<std::pair<uint32, uint32>> changed;
 for(const auto& pair : e.blocks) {
  const auto& saved = reference.at(pair.first);
  if(memcmp(e.m_ram + pair.first, saved.data(), saved.size()) != 0)
   changed.emplace_back(pair.first, pair.second.end + 4);
 }
 // Match the existing inclusive range invalidation, including adjacent blocks.
 auto expected = e.blocks;
 for(const auto& range : changed) for(auto it = expected.begin(); it != expected.end();)
  if(it->first < range.second && it->second.end >= range.first) it = expected.erase(it); else ++it;
 e.SyncInstructionCache();
#ifdef COHERENCE_PENDING
 for(const auto& pair : e.m_instructionPages) assert(!pair.second.pendingValidation);
#endif
 assert(e.blocks.size() == expected.size());
 for(const auto& pair : expected) assert(e.HasBlockAt(pair.first));
 e.CheckMetadata();
 for(auto it = reference.begin(); it != reference.end();) if(!e.HasBlockAt(it->first)) it = reference.erase(it); else ++it;
 ++tests;
}
static void Compile(CEeExecutor& e, std::map<uint32, std::vector<uint8>>& reference, uint32 start, uint32 end) {
 e.Compile(start, end);
 reference[start] = std::vector<uint8>(e.m_ram + start, e.m_ram + end + 4);
 e.CheckMetadata();
 ++tests;
}
extern "C" unsigned run_fixture() {
 CEeExecutor e;
 std::map<uint32, std::vector<uint8>> reference;
 // Cross-page overlapping entry points and first/last instruction bytes.
 Compile(e, reference, 4092, 4120);
 Compile(e, reference, 4096, 4120);
 e.memory[4096] ^= 1;
 FlushAgainstReference(e, reference);
 assert(e.blocks.empty());
 Compile(e, reference, PS2::EE_RAM_SIZE - 16, PS2::EE_RAM_SIZE - 4);
 e.memory.back() ^= 128;
 FlushAgainstReference(e, reference);
 assert(e.blocks.empty());
 // Do not refresh an existing page snapshot when another block is compiled:
 // an earlier block may have been modified before that new compilation.
 Compile(e, reference, 8192, 8204);
 e.memory[8192] ^= 2;
 Compile(e, reference, 8256, 8268);
 FlushAgainstReference(e, reference);
 assert(!e.HasBlockAt(8192) && e.HasBlockAt(8256));
 // Data writes outside instructions must refresh the page, preserving blocks.
 e.memory[8300] ^= 4;
 FlushAgainstReference(e, reference);
 assert(e.HasBlockAt(8256));
 e.memory[8256] ^= 8;
 FlushAgainstReference(e, reference);
 assert(!e.HasBlockAt(8256));
 // Capped allocation, unchanged-page fallback, exact invalidation in each path.
 e.Reset(); reference.clear();
 for(unsigned page = 0; page < 700; ++page) Compile(e, reference, page * 4096, page * 4096 + 12);
 assert(e.m_instructionSnapshotCount == 512);
 pageHashCalls = blockHashCalls = 0;
 FlushAgainstReference(e, reference);
#ifdef COHERENCE_PENDING
 assert(pageHashCalls == 188 && blockHashCalls == 700);
 pageHashCalls = blockHashCalls = 0;
 FlushAgainstReference(e, reference);
#endif
 assert(pageHashCalls == 188 && blockHashCalls == 0);
 e.memory[20 * 4096 + 2] ^= 16;
 e.memory[650 * 4096 + 3] ^= 32;
 FlushAgainstReference(e, reference);
 assert(!e.HasBlockAt(20 * 4096) && !e.HasBlockAt(650 * 4096));
 assert(e.m_instructionSnapshotCount == 511);
 Compile(e, reference, 900 * 4096, 900 * 4096 + 12);
 assert(e.m_instructionSnapshotCount == 512);
 // Preserve a currently executing block during explicit invalidation.
 e.protectedStart = 900 * 4096;
 e.ClearActiveBlocksInRange(e.protectedStart, e.protectedStart + 16, true);
 assert(e.HasBlockAt(e.protectedStart)); e.CheckMetadata(); ++tests;
 e.ClearActiveBlocksInRange(e.protectedStart, e.protectedStart + 16, false);
 assert(!e.HasBlockAt(e.protectedStart)); reference.erase(e.protectedStart); e.CheckMetadata(); ++tests;
 // State load contract: invalidate all before replacing RAM, then recompile.
 e.ClearActiveBlocksInRange(0, PS2::EE_RAM_SIZE, false); reference.clear();
 assert(e.m_instructionSnapshotCount == 0 && e.m_instructionPages.empty() && e.m_instructionHashes.empty());
 std::fill(e.memory.begin(), e.memory.end(), 0x55);
 Compile(e, reference, 4092, 4120);
 FlushAgainstReference(e, reference);
 // Deterministic mixed direct stores, bulk writes, clears, compiles and resets.
 uint32 random = 0x6d2b79f5;
 auto next = [&]() { random ^= random << 13; random ^= random >> 17; random ^= random << 5; return random; };
 for(unsigned i = 0; i < 6000; ++i) {
  const uint32 start = (next() % 1024) * 64;
  switch(next() % 7) {
   case 0: case 1: if(!e.HasBlockAt(start)) Compile(e, reference, start, start + (next() % 8) * 4); break;
   case 2: e.memory[start + next() % 64] ^= static_cast<uint8>(1 + next() % 255); break;
   case 3: { const auto value = next() & 255; const auto size = 1 + next() % 64; memset(e.m_ram + start, value, size); break; }
   case 4: FlushAgainstReference(e, reference); break;
   case 5:
    e.ClearActiveBlocksInRange(start, start + 32, false);
    for(auto it = reference.begin(); it != reference.end();) if(!e.HasBlockAt(it->first)) it = reference.erase(it); else ++it;
    e.CheckMetadata(); ++tests; break;
   case 6: if(i % 97 == 0) {e.Reset(); reference.clear(); assert(e.m_instructionSnapshotCount == 0); ++tests;} break;
  }
 }
 FlushAgainstReference(e, reference);
 printf("PASS %u extracted coherence lifecycle/reference checks\n", tests);
 return tests;
}
static CloudInstructionPage saved;
extern "C" void assign_snapshot(const void* source) { saved.Assign(source); }
extern "C" bool equals_snapshot(const void* source) { return saved.Equals(source); }
extern "C" CloudInstructionPage* create_pages(const uint8* source, unsigned pages) {
 auto* copies = new CloudInstructionPage[pages];
 for(unsigned page = 0; page < pages; ++page) copies[page].Assign(source + page * 4096);
 return copies;
}
extern "C" void destroy_pages(CloudInstructionPage* copies) { delete[] copies; }
extern "C" uint32 compare_pages(const uint8* source, const CloudInstructionPage* copies, unsigned pages, unsigned loops) {
 uint32 sum = 0;
 for(unsigned loop = 0; loop < loops; ++loop) for(unsigned page = 0; page < pages; ++page)
  sum += copies[page].Equals(source + page * 4096);
 return sum;
}
extern "C" uint32 hash_pages(const uint8* source, unsigned pages, unsigned loops) {
 uint32 sum = 0;
 for(unsigned loop = 0; loop < loops; ++loop) for(unsigned page = 0; page < pages; ++page)
  sum += static_cast<uint32>(XXH3_128bits(source + page * 4096, 4096).low64);
 return sum;
}

#include "sparse-tests.inc"
#include "registration-tests.inc"

extern "C" unsigned instruction_page_bytes(){return sizeof(CEeExecutor::InstructionPage);}
