// Native actual-method fixture. The oracle below shares no unpack/read/tick body
// with either source extraction. Source inputs remain outside the repository.
#include <algorithm>
#include <array>
#include <climits>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include "Types.h"
#include "Convertible.h"
#include "uint128.h"
#define FRAMEWORK_SAFE_BUFFERS
#include <cassert>
namespace PS2 { constexpr uint32 EE_SPR_SIZE = 16384, EE_RAM_SIZE = 65536; }
struct CProfiler { using ZoneHandle = uint32; };
#include "state.inc"
struct Vpu {
 alignas(16) std::array<uint8, 16384> bytes{};
 uint32 size = 16384;
 uint8* GetVuMemory() { return bytes.data(); }
 uint32 GetVuMemorySize() const { return size; }
};
#include "methods.inc"
static uint64 randomState = 0x87ac427cb17e5319ULL;
static uint32 random32() { randomState ^= randomState << 13; randomState ^= randomState >> 7; randomState ^= randomState << 17; return uint32(randomState); }
static uint64 cases = 0, resumes = 0, pendingTags = 0, wraps = 0, excluded = 0, payloadLimited = 0, canary = 0, lifecycle = 0, shortInputs = 0;
[[noreturn]] static void fail(const char* text) { std::cerr << "FAIL " << text << " case=" << cases << " seed=" << randomState << '\n'; std::exit(1); }
static void check(bool good, const char* text) { if(!good) fail(text); }

// A byte cursor independent of CFifoStream::Read/ReadValue/SyncBuffer. Keep its
// saved QW explicitly, so checking final buffered bytes does not use source API.
struct Cursor {
 std::array<uint8, 16> saved{};
 uint32 position, start, next, end;
 bool tag;
 uint8 *ram, *spr, *source;
 template<class Stream> explicit Cursor(const Stream& stream) : position(stream.m_bufferPosition), start(stream.m_startAddress), next(stream.m_nextAddress), end(stream.m_endAddress), tag(stream.m_tagIncluded), ram(stream.m_ram), spr(stream.m_spr), source(stream.m_source) { std::memcpy(saved.data(), &stream.m_buffer, 16); }
 void reset() { saved.fill(0); position = 16; start = next = end = 0; tag = false; source = nullptr; }
 void flush() { position = 16; }
 void loadIfEmpty() {
  if(position == 16) {
   check(next < end, "lifecycle source exhausted");
   for(unsigned i = 0; i < 16; ++i) saved[i] = source[next + i];
   next += 16; position = tag ? 8 : 0; tag = false;
  }
 }
 void dma(uint32 address, uint32 size, bool includesTag) {
  source = (address & 0x80000000) ? spr : ram;
  address &= (address & 0x80000000) ? PS2::EE_SPR_SIZE - 1 : PS2::EE_RAM_SIZE - 1;
  start = next = address; end = address + size; tag = includesTag; loadIfEmpty();
 }
 void fifo(uint8* bytes, uint32 size) { source = bytes; start = next = 0; end = size; tag = false; loadIfEmpty(); }
 uint32 available() const { return (end - next) + (16 - position); }
 uint8 take() {
  if(position == 16) {
   if(next >= end) { std::cerr << "cursor position=" << position << " next=" << next << " end=" << end << " tag=" << tag << "\n"; fail("oracle source exhausted (invalid input)"); }
   for(uint32 i = 0; i != 16; ++i) saved[i] = source[next + i];
   next += 16;
   position = tag ? 8 : 0;
   tag = false;
  }
  return saved[position++];
 }
 template<class Stream> void compare(const Stream& stream) const {
  check(position == stream.m_bufferPosition && start == stream.m_startAddress && next == stream.m_nextAddress && end == stream.m_endAddress && tag == stream.m_tagIncluded, "stream metadata");
  check(ram == stream.m_ram && spr == stream.m_spr && source == stream.m_source, "stream pointers");
  check(std::memcmp(saved.data(), &stream.m_buffer, 16) == 0, "stream saved QW");
 }
};

struct Oracle : State {
 Vpu m_vpu;
 void run(Cursor& stream, CODE command, uint32 base, int type, bool greater, bool mask, int mode, bool usn) {
  uint32 inputCycle = m_CYCLE.nCL, outputCycle = m_CYCLE.nWL;
  if(outputCycle == 0) { outputCycle = UINT_MAX; inputCycle = 0; }
  if(m_NUM == command.nNUM) m_readTick = m_writeTick = 0;
  unsigned left = m_NUM ? unsigned(m_NUM) : 256;
  const unsigned total = m_CODE.nNUM ? unsigned(m_CODE.nNUM) : 256;
  const unsigned done = total - left;
  unsigned vectorAddress = base;
  if(inputCycle > outputCycle) vectorAddress += inputCycle * (done / outputCycle) + done % outputCycle;
  else vectorAddress += done;
  uint32 address = (vectorAddress * 16) & (m_vpu.size - 1);
  unsigned operations = 0;
  while(left) {
   check(++operations <= 100000, "oracle termination");
   std::array<uint32, 4> value{};
   const bool read = greater ? m_readTick < outputCycle : m_writeTick < inputCycle;
   bool write = !greater;
   if(read) {
    const unsigned bytes = type == 0 ? 4 : type == 13 ? 8 : 16;
    if(stream.available() < bytes) break;
    if(type == 0) {
     uint32 scalar = 0;
     for(unsigned byte = 0; byte < 4; ++byte) scalar |= uint32(stream.take()) << (byte * 8);
     value.fill(scalar);
    } else {
     const unsigned width = type == 13 ? 2 : 4;
     for(unsigned lane = 0; lane < 4; ++lane) {
      uint32 scalar = 0;
      for(unsigned byte = 0; byte < width; ++byte) scalar |= uint32(stream.take()) << (byte * 8);
      if(width == 2 && !usn && (scalar & 0x8000)) scalar |= 0xffff0000;
      value[lane] = scalar;
     }
    }
    write = true;
   }
   if(write) {
    const uint32 column = m_writeTick < 4 ? m_writeTick : 3;
    for(unsigned lane = 0; lane < 4; ++lane) {
     const unsigned op = mask ? (m_MASK >> (column * 8 + lane * 2)) & 3 : 0;
     uint32 result = value[lane];
     if(op == 0) {
      if(mode == 1 || mode == 2) result += m_R[lane];
      if(mode == 2) m_R[lane] = result;
     } else if(op == 1) result = m_R[lane];
     else if(op == 2) result = m_C[column];
     else continue;
     for(unsigned byte = 0; byte < 4; ++byte) m_vpu.bytes[address + lane * 4 + byte] = uint8(result >> (byte * 8));
    }
    --left;
   }
   // Intentionally scalar saturating counters, not the candidate's modulus.
   if(m_writeTick < outputCycle) ++m_writeTick; else m_writeTick = outputCycle;
   if(m_readTick < inputCycle) ++m_readTick; else m_readTick = inputCycle;
   if(greater ? m_readTick == inputCycle : m_writeTick == outputCycle) m_readTick = m_writeTick = 0;
   address += 16;
   if(address == m_vpu.size) { address = 0; ++wraps; }
  }
  if(left) m_STAT.nVPS = 1;
  else {
   while(stream.position & 3) (void)stream.take();
   m_STAT.nVPS = 0;
  }
  m_NUM = uint8(left);
 }
};

template<class Vif, int Type, bool Greater, bool Mask, int Mode>
static void signedDispatch(Vif& vif, typename Vif::StreamType& stream, State::CODE command, uint32 base, bool usn) {
 if(usn) vif.template Unpack<Type, Greater, Mask, Mode, true>(stream, command, base);
 else vif.template Unpack<Type, Greater, Mask, Mode, false>(stream, command, base);
}
template<class Vif, int Type, bool Greater, bool Mask>
static void modeDispatch(Vif& vif, typename Vif::StreamType& stream, State::CODE command, uint32 base, int mode, bool usn) {
 switch(mode) {
 case 0: signedDispatch<Vif, Type, Greater, Mask, 0>(vif, stream, command, base, usn); break;
 case 1: signedDispatch<Vif, Type, Greater, Mask, 1>(vif, stream, command, base, usn); break;
 case 2: signedDispatch<Vif, Type, Greater, Mask, 2>(vif, stream, command, base, usn); break;
 default: fail("fixture mode");
 }
}
template<class Vif, int Type>
static void cycleDispatch(Vif& vif, typename Vif::StreamType& stream, State::CODE command, uint32 base, bool greater, bool mask, int mode, bool usn) {
 if(greater) {
  if(mask) modeDispatch<Vif, Type, true, true>(vif, stream, command, base, mode, usn);
  else modeDispatch<Vif, Type, true, false>(vif, stream, command, base, mode, usn);
 } else {
  if(mask) modeDispatch<Vif, Type, false, true>(vif, stream, command, base, mode, usn);
  else modeDispatch<Vif, Type, false, false>(vif, stream, command, base, mode, usn);
 }
}
template<class Vif>
static void dispatch(Vif& vif, typename Vif::StreamType& stream, State::CODE command, uint32 base, int type, bool greater, bool mask, int mode, bool usn) {
 if(type == 12) cycleDispatch<Vif, 12>(vif, stream, command, base, greater, mask, mode, usn);
 else if(type == 13) cycleDispatch<Vif, 13>(vif, stream, command, base, greater, mask, mode, usn);
 else cycleDispatch<Vif, 0>(vif, stream, command, base, greater, mask, mode, usn);
}

template<class Vif, class Stream>
static void compare(const Vif& vif, const Stream& stream, const Oracle& oracle, const Cursor& cursor) {
 check(std::memcmp(static_cast<const State*>(&vif), static_cast<const State*>(&oracle), sizeof(State)) == 0, "all extracted VIF plain-state bytes");
 check(vif.m_vpu.size == oracle.m_vpu.size && vif.m_vpu.bytes == oracle.m_vpu.bytes, "all VU memory and canaries");
 cursor.compare(stream);
 ++canary;
}

alignas(16) static std::array<uint8, 65536> ram, spr;
static void runCase(unsigned variant, bool chain) {
 ++cases;
 Baseline::Vif baseline;
 Candidate::Vif candidate;
 Oracle oracle;
 for(size_t i = 0; i < sizeof(State); ++i) reinterpret_cast<uint8*>(static_cast<State*>(&oracle))[i] = uint8(random32());
 for(auto& byte : oracle.m_vpu.bytes) byte = uint8(random32());
 oracle.m_vpu.size = random32() & 1 ? 4096 : 16384;
 const int type = variant % 5 == 0 ? 0 : variant % 5 == 1 ? 13 : 12;
 const bool mask = variant % 7 == 0;
 const int mode = variant % 11 == 0 ? 2 : variant % 11 == 1 ? 1 : 0;
 const bool usn = variant & 1;
 unsigned cl = 1 + random32() % 255, wl = cl;
 if(variant % 13 == 0) { cl = random32() % 256; wl = random32() % 256; }
 if(variant % 101 == 0) cl = wl = 0;
 const bool greater = cl >= wl;
 oracle.m_CYCLE.nCL = cl;
 oracle.m_CYCLE.nWL = wl;
 const unsigned total = variant % 17 == 0 ? 256 : 1 + random32() % 256;
 unsigned remaining = variant % 3 == 0 ? 1 + random32() % total : total;
 if(chain) remaining = total;
 oracle.m_CODE.nNUM = total & 255;
 oracle.m_CODE.nCMD = 0x60 | type | (mask ? 0x10 : 0);
 oracle.m_NUM = remaining & 255;
 oracle.m_readTick = cl ? random32() % cl : 0;
 oracle.m_writeTick = oracle.m_readTick;
 if(variant % 23 == 0) oracle.m_writeTick = random32() % 260;
 if(variant % 29 == 0) oracle.m_readTick = random32() % 260;
 const State::CODE command = oracle.m_CODE;
 const uint32 base = random32() % (oracle.m_vpu.size / 16);
 std::memcpy(static_cast<State*>(&baseline), static_cast<State*>(&oracle), sizeof(State));
 std::memcpy(static_cast<State*>(&candidate), static_cast<State*>(&oracle), sizeof(State));
 baseline.m_vpu = candidate.m_vpu = oracle.m_vpu;
 Baseline::CFifoStream originalStream(ram.data(), spr.data());
 Candidate::CFifoStream newStream(ram.data(), spr.data());
 // Actual setup methods are exercised before varied partial-buffer/resume states.
 if(variant & 1) { originalStream.SetDmaParams((variant & 2) ? 0x80000000 : 0, 32, variant & 4); newStream.SetDmaParams((variant & 2) ? 0x80000000 : 0, 32, variant & 4); }
 else { originalStream.SetFifoParams(ram.data(), 32); newStream.SetFifoParams(ram.data(), 32); }
 uint32 position = variant % 17;
 originalStream.m_bufferPosition = newStream.m_bufferPosition = position;
 const uint32 next = 16;
 uint32 end = next + (chain ? 16 : random32() % 300 * 16);
 originalStream.m_nextAddress = newStream.m_nextAddress = next;
 originalStream.m_endAddress = newStream.m_endAddress = end;
 bool tag = variant % 4 == 0 && end - next + 16 - position >= 32;
 if(tag && position == 0 && end - next == 16) { end += 16; originalStream.m_endAddress = newStream.m_endAddress = end; }
 originalStream.m_tagIncluded = newStream.m_tagIncluded = tag;
 Cursor cursor(originalStream);
 if(tag) ++pendingTags;
 if(type != 12 || mask || mode || !greater || cl != wl || !cl) ++excluded;
 if(cursor.available() % 16) ++payloadLimited;
 for(unsigned step = 0; step < (chain ? 300u : 1u); ++step) {
  oracle.run(cursor, command, base, type, greater, mask, mode, usn);
  dispatch(baseline, originalStream, command, base, type, greater, mask, mode, usn);
  dispatch(candidate, newStream, command, base, type, greater, mask, mode, usn);
  compare(baseline, originalStream, oracle, cursor);
  compare(candidate, newStream, oracle, cursor);
  if(!oracle.m_STAT.nVPS || !chain) break;
  ++resumes;
  // Extend the existing DMA segment without dropping its unconsumed QW. This
  // models arbitrary split arrival, including fractional-vector availability.
  cursor.end += 16;
  originalStream.m_endAddress += 16;
  newStream.m_endAddress += 16;
 }
}



static void shortInputsMatrix() {
 for(unsigned available = 0; available < 16; ++available) for(unsigned pending = 0; pending < 2; ++pending) for(unsigned num : {1u, 2u, 256u}) {
  ++shortInputs;
  Baseline::Vif baseline; Candidate::Vif candidate; Oracle oracle;
  std::memset(static_cast<void*>(static_cast<State*>(&oracle)), 0x53, sizeof(State));
  oracle.m_CYCLE.nCL = oracle.m_CYCLE.nWL = 255;
  oracle.m_CODE.nNUM = oracle.m_NUM = num & 255;
  oracle.m_CODE.nCMD = 0x6c;
  std::memcpy(static_cast<State*>(&baseline), static_cast<State*>(&oracle), sizeof(State));
  std::memcpy(static_cast<State*>(&candidate), static_cast<State*>(&oracle), sizeof(State));
  baseline.m_vpu = candidate.m_vpu = oracle.m_vpu;
  Baseline::CFifoStream oldStream(ram.data(), spr.data()); Candidate::CFifoStream newStream(ram.data(), spr.data());
  oldStream.SetFifoParams(ram.data(), 16); newStream.SetFifoParams(ram.data(), 16);
  oldStream.SetBufferPosition(16 - available); newStream.SetBufferPosition(16 - available);
  oldStream.m_tagIncluded = newStream.m_tagIncluded = pending;
  Cursor cursor(oldStream);
  const auto command = oracle.m_CODE;
  oracle.run(cursor, command, 0, 12, true, false, 0, false);
  dispatch(baseline, oldStream, command, 0, 12, true, false, 0, false);
  dispatch(candidate, newStream, command, 0, 12, true, false, 0, false);
  compare(baseline, oldStream, oracle, cursor); compare(candidate, newStream, oracle, cursor);
 }
}

static void lifecycleTransitions() {
 Baseline::Vif baseline;
 Candidate::Vif candidate;
 Oracle oracle;
 Baseline::CFifoStream originalStream(ram.data(), spr.data());
 Candidate::CFifoStream newStream(ram.data(), spr.data());
 originalStream.Reset(); newStream.Reset();
 Cursor cursor(originalStream);
 cursor.reset(); cursor.compare(originalStream); cursor.compare(newStream);
 for(unsigned i = 0; i < 4096; ++i) {
  ++lifecycle;
  switch(i % 4) {
  case 0: originalStream.Reset(); newStream.Reset(); cursor.reset(); break;
  case 1: originalStream.Flush(); newStream.Flush(); cursor.flush(); break;
  case 2: {
   // Saved-state stream fields restore an earlier buffered QW/position. These
   // are the actual Get/Set calls used by SaveState/LoadState, with all other
   // stream metadata kept unchanged as in that path.
   const auto buffer = originalStream.GetBuffer();
   const auto position = originalStream.GetBufferPosition();
   uint128 changed = buffer; changed.nD0 ^= 0x98bca0526e991733ULL;
   originalStream.SetBuffer(changed); newStream.SetBuffer(changed);
   originalStream.SetBufferPosition(16); newStream.SetBufferPosition(16);
   originalStream.SetBuffer(buffer); newStream.SetBuffer(buffer);
   originalStream.SetBufferPosition(position); newStream.SetBufferPosition(position);
   break;
  }
  default: break;
  }
  cursor.compare(originalStream); cursor.compare(newStream);
  const uint32 address = (i & 8 ? 0x80000000 : 0) | ((i * 32) % 8192);
  if(i % 3) {
   const bool tag = i & 4;
   originalStream.SetDmaParams(address, 96, tag);
   newStream.SetDmaParams(address, 96, tag);
   cursor.dma(address, 96, tag);
  } else {
   originalStream.SetFifoParams(ram.data(), 96); newStream.SetFifoParams(ram.data(), 96);
   cursor.fifo(ram.data(), 96);
  }
  cursor.compare(originalStream); cursor.compare(newStream);
  std::memset(static_cast<void*>(static_cast<State*>(&oracle)), 0x3d, sizeof(State));
  oracle.m_CYCLE.nCL = oracle.m_CYCLE.nWL = 1 + i % 255;
  oracle.m_CODE.nNUM = oracle.m_NUM = 1 + i % 4;
  oracle.m_CODE.nCMD = 0x6c;
  const auto command = oracle.m_CODE;
  const uint32 base = (i * 13) % (oracle.m_vpu.size / 16);
  std::memcpy(static_cast<State*>(&baseline), static_cast<State*>(&oracle), sizeof(State));
  std::memcpy(static_cast<State*>(&candidate), static_cast<State*>(&oracle), sizeof(State));
  baseline.m_vpu = candidate.m_vpu = oracle.m_vpu;
  oracle.run(cursor, command, base, 12, true, false, 0, i & 1);
  dispatch(baseline, originalStream, command, base, 12, true, false, 0, i & 1);
  dispatch(candidate, newStream, command, base, 12, true, false, 0, i & 1);
  compare(baseline, originalStream, oracle, cursor); compare(candidate, newStream, oracle, cursor);
 }
}

static void retainedControls() {
 // Two available QWs include eight bytes of a still-pending tag. The ordinary
 // baseline reads one V4-32 then correctly stops with eight payload bytes left.
 Baseline::CFifoStream stream(ram.data(), spr.data());
 stream.m_source = ram.data(); stream.m_startAddress = stream.m_nextAddress = 0;
 stream.m_endAddress = 32; stream.m_bufferPosition = 16; stream.m_tagIncluded = true;
 uint128 value;
 check(stream.GetAvailableReadBytes() / 16 == 2, "pending-tag negative control raw count");
 stream.ReadValue<16>(&value);
 check(stream.GetAvailableReadBytes() == 8 && stream.m_nextAddress == 32 && stream.m_bufferPosition == 8, "pending-tag baseline counterexample");
 Candidate::CFifoStream candidate(ram.data(), spr.data());
 candidate.m_source = ram.data(); candidate.m_startAddress = candidate.m_nextAddress = 0;
 candidate.m_endAddress = 32; candidate.m_bufferPosition = 16; candidate.m_tagIncluded = true;
 check(candidate.GetAvailablePayloadBytes() / 16 == 1, "tag-aware bound");
 // Retain the exact existing native NDEBUG edge: a full old buffered QW plus
 // only one new tagged QW reports enough bytes for two vectors, then reads
 // beyond its logical DMA end. The candidate deliberately retains the legacy
 // fallback on this edge. All actual loads stay in our allocated RAM array.
 Baseline::Vif edgeBase; Candidate::Vif edgeCandidate;
 std::memset(static_cast<void*>(static_cast<State*>(&edgeBase)), 0, sizeof(State));
 std::memset(static_cast<void*>(static_cast<State*>(&edgeCandidate)), 0, sizeof(State));
 edgeBase.m_CYCLE.nCL = edgeBase.m_CYCLE.nWL = edgeCandidate.m_CYCLE.nCL = edgeCandidate.m_CYCLE.nWL = 1;
 edgeBase.m_NUM = edgeCandidate.m_NUM = edgeBase.m_CODE.nNUM = edgeCandidate.m_CODE.nNUM = 2;
 edgeBase.m_CODE.nCMD = edgeCandidate.m_CODE.nCMD = 0x6c;
 Baseline::CFifoStream oldEdge(ram.data(), spr.data()); Candidate::CFifoStream newEdge(ram.data(), spr.data());
 oldEdge.SetFifoParams(ram.data(), 32); newEdge.SetFifoParams(ram.data(), 32);
 oldEdge.m_tagIncluded = newEdge.m_tagIncluded = true;
 dispatch(edgeBase, oldEdge, edgeBase.m_CODE, 0, 12, true, false, 0, false);
 dispatch(edgeCandidate, newEdge, edgeCandidate.m_CODE, 0, 12, true, false, 0, false);
 check(oldEdge.m_nextAddress == 48 && oldEdge.m_endAddress == 32 && oldEdge.m_bufferPosition == 8, "retained native legacy logical overread");
 Cursor edgeCursor(oldEdge); edgeCursor.compare(newEdge);
 check(edgeBase.m_vpu.bytes == edgeCandidate.m_vpu.bytes && std::memcmp(static_cast<State*>(&edgeBase), static_cast<State*>(&edgeCandidate), sizeof(State)) == 0, "retained native edge matches candidate");
 for(unsigned i = 0; i < 16; ++i) check(edgeBase.m_vpu.bytes[i] == ram[i] && edgeBase.m_vpu.bytes[16 + i] == ram[24 + i], "retained native edge byte oracle");
 // Existing Advance skips QWs without materializing the final saved buffer.
 // Its byte state differs from a real read even when position==16 in both.
 Baseline::CFifoStream read(ram.data(), spr.data()), advanced(ram.data(), spr.data());
 read.SetFifoParams(ram.data(), 64); advanced.SetFifoParams(ram.data(), 64);
 alignas(16) std::array<uint8, 48> data{};
 read.Read(data.data(), 48); advanced.Advance(48);
 check(read.m_bufferPosition == advanced.m_bufferPosition && read.m_nextAddress == advanced.m_nextAddress, "Advance control cursor");
 check(std::memcmp(&read.m_buffer, &advanced.m_buffer, 16) != 0, "Advance stale buffer negative control");
}

int main() {
 for(auto& byte : ram) byte = uint8(random32());
 for(auto& byte : spr) byte = uint8(random32());
 retainedControls();
 lifecycleTransitions();
 shortInputsMatrix();
 for(unsigned i = 0; i < 24000; ++i) runCase(i, i % 6 == 0);
 std::cout << "{\"pass\":true,\"cases\":" << cases << ",\"shortInputCases\":" << shortInputs << ",\"lifecycleTransitions\":" << lifecycle << ",\"resumeCalls\":" << resumes << ",\"pendingTagCases\":" << pendingTags << ",\"wrapsObserved\":" << wraps << ",\"exclusionCases\":" << excluded << ",\"fractionalVectorCases\":" << payloadLimited << ",\"stateAndMemoryComparisons\":" << canary << ",\"retainedNegativeControls\":[\"pending-tag-naive-count-overread\",\"Advance-final-buffer-stale\",\"baseline-pending-tag-logical-overread-retained\"]}\n";
}
