#pragma once
#include <vector>
#include <cstring>
#include <cassert>
#include "Common/CommonTypes.h"
namespace WebGPU {
inline std::vector<int> events;
struct WebGPUCommandStream {
 bool fail_alloc=false, fail_push=false;
 std::vector<u8> packet;
 u32 next=1,usage=0,mip=0,width=0,height=0,aligned=0;
 void EnsureRing() {}
 bool ready() const {return true;}
 u32 PushCreateTexture(u32,u32,u32,u32 flags,u32,u32) {usage=flags;return next++;}
 u32 UploadAlloc(const void* data,u32 bytes,u32) {
  events.push_back(2);if(fail_alloc)return 0;
  packet.resize(bytes);std::memcpy(packet.data(),data,bytes);return 4;
 }
 bool PushDecodeTexture(u32,u32,u32 bytes,u32 w,u32 h,u32 level,u32 aw) {
  events.push_back(3);assert(packet.size()==bytes);mip=level;width=w;height=h;aligned=aw;return !fail_push;
 }
 bool PushUploadTexture(u32,u32,u32,u32,u32,u32,u32) {events.push_back(4);return true;}
 bool PushBlitTexture(u32,u32,u32,u32,u32,u32,u32,u32,u32,u32,u32,u32,u32,u32) {events.push_back(5);return true;}
};
inline WebGPUCommandStream stream;
inline WebGPUCommandStream& GetCommandStream() {return stream;}
}
