#!/usr/bin/env python3
"""Extract the pinned MIT PS2 GS compute renderer without its game recompilers."""
from pathlib import Path
import shutil
import sys
up, out = map(Path, sys.argv[1:])
out.mkdir(parents=True, exist_ok=True)
for name in ['gpu.cpp', 'gpu.hpp', 'gs.wgsl', 'blit.wgsl']:
    shutil.copy2(up / 'runtime/src/gs/gpu' / name, out / name)
shutil.copy2(up / 'LICENSE', out / 'LICENSE')
header = (up / 'runtime/src/gs/gs.hpp').read_text()
header = header[header.index('namespace ps2::gs {'):header.index('extern State g_state;')]
(out / 'gs.hpp').write_text('#pragma once\n#include <cstdint>\n' + header + '\nextern State g_state;\nextern std::uint32_t g_setup_generation;\n}\n')
p = out / 'gpu.hpp'
p.write_text(p.read_text().replace('"../gs.hpp"', '"gs.hpp"'))
p = out / 'gpu.cpp'
s = p.read_text().replace('#include "ps2/system.hpp"', '#include <emscripten.h>\n#include <stdexcept>\nnamespace ps2 { unsigned long long cloudGpuFrames = 0; unsigned long long frame_count() { return cloudGpuFrames; } void browser_yield() { emscripten_sleep(0); } }')
s = s.replace('    options.forceFallbackAdapter = std::getenv("PS2_GPU_FALLBACK") != nullptr;', '    options.forceFallbackAdapter = false;')
# Await the actual queue future once instead of repeatedly waking Asyncify via
# setTimeout(0). TimedWaitAny is provided by the pinned Dawn Asyncify port.
old = '    g_instance = wgpuCreateInstance(nullptr);'
assert s.count(old) == 1
s = s.replace(old, '''    WGPUInstanceDescriptor instance = WGPU_INSTANCE_DESCRIPTOR_INIT;
    const WGPUInstanceFeatureName feature = WGPUInstanceFeatureName_TimedWaitAny;
    instance.requiredFeatureCount = 1;
    instance.requiredFeatures = &feature;
    g_instance = wgpuCreateInstance(&instance);''')
old = '''    bool done = false;
    WGPUQueueWorkDoneCallbackInfo cb = WGPU_QUEUE_WORK_DONE_CALLBACK_INFO_INIT;
    cb.mode = WGPUCallbackMode_AllowProcessEvents;
    cb.callback = [](WGPUQueueWorkDoneStatus, WGPUStringView, void *flag, void *) { *static_cast<bool *>(flag) = true; };
    cb.userdata1 = &done;
    wgpuQueueOnSubmittedWorkDone(g_queue, cb);
    wait_until(done);'''
assert s.count(old) == 1
s = s.replace(old, '''    // Failure is fatal for this device. No callback points into a stack frame
    // that could unwind on timeout while the GPU future is still pending.
    static bool failed = false;
    WGPUQueueWorkDoneCallbackInfo cb = WGPU_QUEUE_WORK_DONE_CALLBACK_INFO_INIT;
    cb.mode = WGPUCallbackMode_WaitAnyOnly;
    cb.callback = [](WGPUQueueWorkDoneStatus status, WGPUStringView, void *, void *) {
        if(status != WGPUQueueWorkDoneStatus_Success) failed = true;
    };
    WGPUFutureWaitInfo info = WGPU_FUTURE_WAIT_INFO_INIT;
    info.future = wgpuQueueOnSubmittedWorkDone(g_queue, cb);
    if(wgpuInstanceWaitAny(g_instance, 1, &info, 60000000000ull) != WGPUWaitStatus_Success || !info.completed)
        throw std::runtime_error("PS2 WebGPU timed out.");
    if(failed) throw std::runtime_error("PS2 WebGPU queue completion failed.");
    wgpuInstanceProcessEvents(g_instance);''')
# Decode jobs read the same pre-raster VRAM/CLUT and write disjoint decoded
# ranges. One dispatch preserves that dependency while avoiding a barrier and
# dynamic-uniform record for each individual texture.
old = '    for (const Decode &d : g_decodes) dispatch_linear(kDecode, d.words, push_params({setup_offset + d.setup * kSetupWords, d.offset, d.words}));'
assert s.count(old) == 1
s = s.replace(old, '''    if (!g_decodes.empty()) {
        const auto count = static_cast<std::uint32_t>(g_decodes.size());
        const auto jobs = static_cast<std::uint32_t>(g_arena.size());
        auto* records = g_arena.grow(count * 4);
        std::uint32_t groups = 0;
        for (std::uint32_t j = 0; j < count; ++j) {
            const auto& d = g_decodes[j];
            records[j * 4] = setup_offset + d.setup * kSetupWords;
            records[j * 4 + 1] = d.offset;
            records[j * 4 + 2] = d.words;
            records[j * 4 + 3] = groups;
            groups += (d.words + 63u) / 64u;
        }
        dispatch_linear(kDecode, groups * 64u, push_params({jobs, count, groups}));
    }''')
s = s.replace('        wgpuAdapterInfoFreeMembers(info);', '        const bool software = info.adapterType == WGPUAdapterType_CPU;\n        wgpuAdapterInfoFreeMembers(info);\n        if(software) return false;')
s = s.replace('void wait_until(const bool &flag) {\n    while (!flag) pump();\n}', 'void wait_until(const bool &flag) {\n const auto end = emscripten_get_now() + 60000;\n while (!flag) { if(emscripten_get_now() > end) throw std::runtime_error("PS2 WebGPU timed out."); pump(); }\n}')
s = s.replace('    while (!adapter_done) pump();', '    wait_until(adapter_done);').replace('    while (!device_done) pump();', '    wait_until(device_done);')
s = s.replace('void on_error(WGPUDevice const *, WGPUErrorType type, WGPUStringView message, void *, void *) {', 'void on_error(WGPUDevice const *, WGPUErrorType type, WGPUStringView message, void *, void *) {\n    EM_ASM({Module.onGpuError?.(UTF8ToString($0, $1));}, message.data, message.length == WGPU_STRLEN ? std::strlen(message.data) : message.length);')
s = s.replace('    dd.uncapturedErrorCallbackInfo.callback = on_error;', '''    dd.uncapturedErrorCallbackInfo.callback = on_error;
    dd.deviceLostCallbackInfo.mode = WGPUCallbackMode_AllowSpontaneous;
    dd.deviceLostCallbackInfo.callback = [](WGPUDevice const *, WGPUDeviceLostReason reason, WGPUStringView msg, void *, void *) {
      EM_ASM({Module.onGpuError?.('PS2 WebGPU device lost: ' + UTF8ToString($0, $1));}, msg.data, msg.length == WGPU_STRLEN ? std::strlen(msg.data) : msg.length);
    };''')
# Failed surface acquisition is not a rendered frame.
s = s.replace('        configure_surface();\n        return true;', '        configure_surface();\n        return false;')
s = s.replace('kDecode, kPipelines', 'kDecode, kComposite, kPipelines')
s = s.replace('"snapshot", "decode"}', '"snapshot", "decode", "cloud_composite"}')
s = s.replace('std::uint32_t g_field = 0,', 'std::uint32_t cloud_layers[26]{}; bool cloud_composite = false;\nstd::uint32_t g_field = 0,')
s = s.replace('    g_commands.push_back({kDisplay, (src.width * g_scale + 7) / 8, (src.height * g_scale + 7) / 8, param});', '''    if(cloud_composite) {
      auto& record = g_param_records[param]; record = {};
      record[0]=src.width; record[1]=src.height; record[2]=current;
      std::copy(cloud_layers+2,cloud_layers+26,record.begin()+4);
    }
    g_commands.push_back({cloud_composite?kComposite:kDisplay, (src.width * g_scale + 7) / 8, (src.height * g_scale + 7) / 8, param});''', 1)
# The upstream file profiler has a blocking map reachable from submit even
# when its environment variable is unset. This browser bridge has no file
# profiling API. Remove that unused suspension path; conservative EH and
# virtual-call analysis can still instrument submission. keep all real queue fences, state and VRAM readback waits.
start = s.index('void profile_submit() {')
end = s.index('// Browsers copy writes', start)
s = s[:start] + s[end:]
start = s.index('    if (g_profile_out && !present_view')
end = s.index('    ensure_capacity();', start)
s = s[:start] + s[end:]
start = s.index('    if (const char *spec = std::getenv("PS2_GPU_PROFILE"))')
end = s.index('    if (const char *scale', start)
s = s[:start] + s[end:]
# Both counters and the sole mapped buffer belong to a collection epoch.
s = s.replace('bool g_query_pending = false, g_query_ready = false;', 'TimestampSampling g_sampling;')
s = s.replace('#include <emscripten.h>', '#include <emscripten.h>\n#include "timestamp-sampling.hpp"', 1)
start = s.index('    if (g_query_ready) {')
end = s.index('    WGPUCommandEncoder enc', start)
s = s[:start] + '''    g_sampling.collect([](std::uint64_t& start, std::uint64_t& end) {
        const auto* mapped = wgpuBufferGetConstMappedRange(g_query_read, 0, 16);
        if (!mapped) return false;
        std::uint64_t t[2]; std::memcpy(t, mapped, sizeof t); start=t[0]; end=t[1]; return true;
    }, [] { wgpuBufferUnmap(g_query_read); });
    const bool measure = g_sampling.can_begin(g_timestamps);
''' + s[end:]
s = s.replace('        g_query_pending = true;', '        g_sampling.begin();')
s = s.replace('            if (status == WGPUMapAsyncStatus_Success) g_query_ready = true;\n            else g_query_pending = false;', '''            g_sampling.complete(status == WGPUMapAsyncStatus_Success,
                [] { wgpuBufferUnmap(g_query_read); });''')
shutil.copy2(Path(__file__).with_name('timestamp-sampling.hpp'), out / 'timestamp-sampling.hpp')
s += '''
namespace ps2::gs::gpu {
bool timestamp_queries() { return g_timestamps; }
void set_timestamp_collection(bool enabled) { g_sampling.reset(enabled, [] { wgpuBufferUnmap(g_query_read); }); }
void reset_timestamp_collection() { set_timestamp_collection(g_sampling.enabled); }
double compute_samples() { return static_cast<double>(g_sampling.samples); }
double compute_ms() { return static_cast<double>(g_sampling.ns) / 1e6; }
bool present_layers(const std::uint32_t* p) {
 if(!p[0]||!p[1]) { flush(); return false; }
 if(p[0]>2048||p[1]>1024||std::uint64_t(p[0])*p[1]>g_field_words) throw std::runtime_error("PS2 display exceeds renderer dimensions.");
 std::copy(p,p+26,cloud_layers); cloud_composite=true;
 const bool shown=present({0,0,0,0,0,p[0],p[1],false});
 cloud_composite=false; return shown;
}
void save_transfer(std::uint32_t* out) {
 if(g_image.pending.size()>256) throw std::runtime_error("GS transfer remainder exceeds state limit.");
 const auto& i=g_image;
 const std::uint32_t values[]={i.active?1u:0u,i.dbp,i.dbw,i.dpsm,i.dsax,i.dsay,i.rrw,i.total,i.done,i.bpp,i.lead_bits,i.id,static_cast<std::uint32_t>(i.pending.size()),g_texflushes};
 std::memset(out,0,512); std::memcpy(out,values,sizeof(values));
 std::memcpy(reinterpret_cast<std::uint8_t*>(out)+64,i.pending.data(),i.pending.size());
}
void load_transfer(const std::uint32_t* p) {
 if(p[12]>256 || p[8]>p[7] || p[10]>7 || (p[9]!=4&&p[9]!=8&&p[9]!=16&&p[9]!=24&&p[9]!=32)) throw std::runtime_error("Invalid GS transfer state.");
 g_image={}; auto& i=g_image;
 i.active=p[0]!=0; i.dbp=p[1];i.dbw=p[2];i.dpsm=p[3];i.dsax=p[4];i.dsay=p[5];i.rrw=p[6];i.total=p[7];i.done=p[8];i.bpp=p[9];i.lead_bits=p[10];i.id=p[11];
 const auto* bytes=reinterpret_cast<const std::uint8_t*>(p)+64;
 i.pending.assign(bytes,bytes+p[12]);g_texflushes=p[13];
 g_image_ids=std::max(g_image_ids,i.id);g_setup_cache={};g_have_previous=false;
}
}
'''
s += '\nnamespace ps2::gs::gpu { void shutdown() { set_timestamp_collection(false); if(g_surface) wgpuSurfaceUnconfigure(g_surface); if(g_device) wgpuDeviceDestroy(g_device); } }\n'
p.write_text(s)
p = out / 'gs.wgsl'
shader = p.read_text()
# CLUT entries selected with CPSM24 still occupy all 32 bits, including alpha.
# Match Play!'s ReadCLUT4/ReadCLUT8 PSMCT32 indexor for both CPSM32 and CPSM24.
# Ordinary 24-bit texture/framebuffer reads must keep their existing masks.
old = '        let cpsm = data[r + 3u];'
assert shader.count(old) == 1
shader = shader.replace(old, '        let cpsm = select(data[r + 3u], PSMCT32, data[r + 3u] == PSMCT24);')
start = shader.index('@compute @workgroup_size(64)\nfn decode(')
end = shader.index('\n@compute', start + 1)
shader = shader[:start] + Path(__file__).with_name('decode.wgsl').read_text() + shader[end:]
p.write_text(shader + '\n' + Path(__file__).with_name('composite.wgsl').read_text())
source = (up / 'runtime/src/gs/gs.cpp').read_text()
def between(start, end):
    assert source.count(start) == 1 and source.count(end) == 1
    return source[source.index(start):source.index(end)]
tables = between('std::uint32_t g_off32', 'std::uint32_t wrap(')
swizzle = between('void swizzle_tables(', 'std::uint32_t address32(')
parser = between('void kick(bool draw)', 'void signal(std::uint32_t reg,')
parser = parser.replace('if (cpu_raster()) raster::draw(s, s.queue, needed);', '')
parser = parser.replace('else if ((value & 3u) == 1 && !cpu_raster()) download_source(s);', '')
parser = parser.replace('        g_transfer = Transfer{};\n        g_carried = 0;', '')
parser = parser.replace('        if ((value & 3u) == 0) g_transfer.active = true;\n        else if ((value & 3u) == 2) { if (cpu_raster()) local_copy(); }\n        else if ((value & 3u) == 1) g_transfer.active = true;', '')
parser = parser.replace('feed_image(reinterpret_cast<const std::uint8_t *>(&value), 8);', 'gpu::image_data(reinterpret_cast<const std::uint8_t *>(&value), 8);')
parser = parser.replace('if (!queue::active()) signal(reg, value);', '')
(out / 'state.cpp').write_text('''// Derived from the pinned MIT ps2-web-recomp GS parser; graphics execute on WebGPU.
#include "gpu.hpp"
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <iterator>
namespace ps2::gs {
State g_state{};
std::uint32_t g_setup_generation = 0, cbp0 = ~0u, cbp1 = ~0u;
std::uint64_t g_primitives = 0, g_writes[128]{};
bool gpu_on() { return true; }
bool trace_display() { return false; }
void load_clut(std::uint64_t tex0) {
 const auto cld = (tex0 >> 61) & 7u;
 const std::uint32_t cbp = (tex0 >> 37) & 0x3FFFu;
 switch(cld) {
 case 0: return; case 1: break;
 case 2: cbp0 = cbp; break; case 3: cbp1 = cbp; break;
 case 4: if(cbp0 == cbp) return; cbp0 = cbp; break;
 case 5: if(cbp1 == cbp) return; cbp1 = cbp; break;
 default: return;
 }
 gpu::load_clut(tex0, g_state.texclut);
}
''' + tables + swizzle + parser + '\n}\n')
for name, var in [('gs.wgsl', 'kGsShader'), ('blit.wgsl', 'kBlitShader')]:
    with (out / (name + '.cpp')).open('w') as f:
        f.write('extern const char ' + var + '[] = R"WGSL(\n' + (out / name).read_text() + ')WGSL";\n')
shutil.copy2(Path(__file__).with_name('bridge.cpp'), out / 'bridge.cpp')
