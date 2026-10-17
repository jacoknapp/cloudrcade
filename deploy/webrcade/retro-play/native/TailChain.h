#pragma once
// Experimental EE-only chaining metadata: deliberately outside MIPSSTATE/save ABI.
#include <array>
#include <atomic>
#include <cstdint>
#include <vector>
#include <stdexcept>
#include <cstddef>
namespace CloudTail {
constexpr uint32_t Slots = 4096;
struct Entry { uint32_t pc = 0, function = 0; };
struct State {
 std::array<Entry, Slots> entries{};
 uint32_t addressMask = 0, budget = 0;
 void Add(uint32_t pc, uint32_t function) { entries[(pc >> 2) & (Slots - 1)] = {pc, function}; }
 void Remove(uint32_t pc) { auto& entry=entries[(pc >> 2) & (Slots - 1)]; if(entry.pc == pc) entry.function = 0; }
 void Clear() { for(auto& entry : entries) entry.function = 0; budget = 0; }
};
inline std::atomic<bool>& Enabled() { static std::atomic<bool> enabled{false}; return enabled; }
inline std::atomic<uint64_t>& Entries() { static std::atomic<uint64_t> entries{0}; return entries; }
bool Supported();
using Bytes = std::vector<uint8_t>;
inline void Uleb(Bytes& out, uint32_t n) { do { auto b=n & 127; n >>= 7; out.push_back(b | (n ? 128 : 0)); } while(n); }
inline uint32_t Read(const Bytes& in, size_t& at) {
 uint32_t n=0;
 for(unsigned shift=0; shift<35 && at<in.size(); shift+=7) { auto b=in[at++]; n |= uint32_t(b & 127) << shift; if(!(b & 128)) return n; }
 throw std::runtime_error("Invalid generated Wasm integer");
}
inline void Append(Bytes& out, const Bytes& bytes) { out.insert(out.end(),bytes.begin(),bytes.end()); }
inline void Const(Bytes& out, uint32_t n) {
 out.push_back(0x41); int32_t value=static_cast<int32_t>(n); bool more=true;
 while(more) { uint8_t b=value & 127;value >>= 7;more=!((value==0 && !(b&64)) || (value==-1 && (b&64)));out.push_back(b|(more?128:0)); }
}
inline void Load(Bytes& out, uint32_t offset) { out.insert(out.end(),{0x28,2});Uleb(out,offset); }
inline void Context(Bytes& out) { out.insert(out.end(),{0x20,0}); }
inline void ContextLoad(Bytes& out, uint32_t offset) { Context(out);Load(out,offset); }
inline void ReturnIf(Bytes& out) { out.insert(out.end(),{0x04,0x40,0x0f,0x0b}); }
inline void Section(Bytes& out,uint8_t id,const Bytes& body) { out.push_back(id);Uleb(out,body.size());Append(out,body); }
struct Layout { uint32_t pc, exception, quota, chain; };
inline Bytes Epilog(Layout layout) {
 Bytes b;
 // Original Play epilog has already committed quota/PC/delay/exception state.
 ContextLoad(b,layout.exception);ReturnIf(b);
 ContextLoad(b,layout.quota);Const(b,0);b.push_back(0x4c);ReturnIf(b);
 ContextLoad(b,layout.chain);b.push_back(0x45);ReturnIf(b);
 auto state=[&](){ContextLoad(b,layout.chain);};
 auto pc=[&](){ContextLoad(b,layout.pc);state();Load(b,offsetof(State,addressMask));b.push_back(0x71);};
 auto entry=[&](){state();pc();Const(b,2);b.push_back(0x76);Const(b,Slots-1);b.push_back(0x71);Const(b,sizeof(Entry));b.push_back(0x6c);b.push_back(0x6a);};
 state();Load(b,offsetof(State,budget));b.push_back(0x45);ReturnIf(b);
 entry();Load(b,offsetof(Entry,pc));pc();b.push_back(0x47);ReturnIf(b);
 entry();Load(b,offsetof(Entry,function));b.push_back(0x45);ReturnIf(b);
 state();state();Load(b,offsetof(State,budget));Const(b,1);b.push_back(0x6b);
 b.insert(b.end(),{0x36,2});Uleb(b,offsetof(State,budget));
 Context(b);entry();Load(b,offsetof(Entry,function));
 b.insert(b.end(),{0x13,0,1}); // return_call_indirect, type0 void(i32), guest table1
 return b;
}
inline Bytes Rewrite(const void* data, size_t size, Layout layout) {
 const auto* p=static_cast<const uint8_t*>(data);Bytes input(p,p+size),out;
 if(size<8 || input[0]!=0 || input[1]!=97 || input[2]!=115 || input[3]!=109)throw std::runtime_error("Invalid generated Wasm module");
 out.insert(out.end(),input.begin(),input.begin()+8);size_t at=8;bool imports=false,code=false;
 while(at<input.size()) {
  auto id=input[at++];auto length=Read(input,at);
  if(length>input.size()-at)throw std::runtime_error("Truncated generated Wasm section");
  Bytes body(input.begin()+at,input.begin()+at+length);at+=length;
  if(id==2) {
   size_t start=0;if(Read(body,start)!=2)throw std::runtime_error("Changed generated Wasm import ABI");
   Bytes replacement;Uleb(replacement,3);replacement.insert(replacement.end(),body.begin()+start,body.end());
   const Bytes guest={3,'e','n','v',10,'g','u','e','s','t','T','a','b','l','e',1,0x70,0,1};Append(replacement,guest);body=std::move(replacement);imports=true;
  } else if(id==10) {
   size_t start=0;if(Read(body,start)!=1)throw std::runtime_error("Changed generated Wasm function count");
   const auto bytes=Read(body,start);
   if(bytes!=body.size()-start || body.back()!=0x0b)throw std::runtime_error("Changed generated Wasm function ABI");
   Bytes function(body.begin()+start,body.end()-1);Append(function,Epilog(layout));function.push_back(0x0b);
   body.clear();Uleb(body,1);Uleb(body,function.size());Append(body,function);code=true;
  }
  Section(out,id,body);
 }
 if(!imports || !code)throw std::runtime_error("Incomplete generated Wasm module");
 return out;
}
}
