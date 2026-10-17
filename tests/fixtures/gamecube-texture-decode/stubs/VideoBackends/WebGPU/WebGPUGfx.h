#pragma once
#include <memory>
#include "VideoBackends/WebGPU/WebGPUCommandStream.h"
namespace WebGPU {
struct WebGPUGfx {
 void PrepareTextureDecode() {events.push_back(1);}
 void ReleaseTextureResource(u32) {events.push_back(6);}
};
}
extern std::unique_ptr<WebGPU::WebGPUGfx> g_gfx;
