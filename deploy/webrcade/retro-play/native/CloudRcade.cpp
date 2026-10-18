// CloudRcade browser host for Play!, under the repository's GPL-3.0 license.
#include <atomic>
#include <chrono>
#include <emscripten/bind.h>
#include "Ps2VmJs.h"
#include "CloudCpuTiming.h"
#include "CloudMovieMetrics.h"
#include "GSH_WebGPU.h"
#include "sound/SH_OpenAL/SH_OpenALProxy.h"
#include "PS2VM_Preferences.h"
#include "DefaultAppConfig.h"

static CPs2VmJs* vm = nullptr;
static std::atomic<uint32> frames{0};
std::atomic<uint32> cloudRenderedFrames{0};
static std::atomic<uint32> videoFrames{0};
static std::atomic<uint32> buttons[2];
static std::atomic<uint32> axes[2][4];
static std::future<bool> stateResult;
static CGSHandler::NewFrameEvent::Connection frameConnection;
static CPS2VM::NewFrameEvent::Connection videoConnection;

class CloudPad final : public CPadHandler
{
public:
 void Update(uint8* ram) override
 {
  for(auto* port : m_interfaces)
   for(unsigned pad = 0; pad < 2; pad++)
    for(unsigned index = 0; index < PS2::CControllerInfo::MAX_BUTTONS; index++)
    {
     auto button = static_cast<PS2::CControllerInfo::BUTTON>(index);
     if(index < 4) port->SetAxisState(pad, button, axes[pad][index].load(), ram);
     else port->SetButtonState(pad, button, (buttons[pad].load() & (1U << index)) != 0, ram);
    }
 }
};

int main() { return 0; }

void initialize()
{
 if(vm) throw std::runtime_error("PS2 core is already initialized.");
 for(auto& pad : axes) for(auto& axis : pad) axis = 128;
 vm = new CPs2VmJs();
 CAppConfig::GetInstance().RegisterPreferenceInteger(PREF_SYSTEM_LANGUAGE, 1);
 CAppConfig::GetInstance().SetPreferencePath(PREF_PS2_MC0_DIRECTORY, "/cloudrcade/cards/mc0");
 CAppConfig::GetInstance().SetPreferencePath(PREF_PS2_MC1_DIRECTORY, "/cloudrcade/cards/mc1");
 vm->Initialize();
 vm->CreateGSHandler([]() { return new CGSH_WebGPU(); });
 CGSHandler::PRESENTATION_PARAMS presentation;
 presentation.mode = CGSHandler::PRESENTATION_MODE_FIT;
 presentation.windowWidth = 640; presentation.windowHeight = 480;
 vm->GetGSHandler()->SetPresentationParams(presentation);
 vm->CreatePadHandler([]() { return new CloudPad(); });
 vm->CreateSoundHandler(CSH_OpenALProxy::GetFactoryFunction(new CSH_OpenAL()));
 frameConnection = vm->GetGSHandler()->OnNewFrame.Connect([](bool) { frames++; });
 videoConnection = vm->OnNewFrame.Connect([]() { videoFrames++; });
}

void input(unsigned pad, unsigned mask, unsigned lx, unsigned ly, unsigned rx, unsigned ry)
{
 if(pad >= 2) return;
 buttons[pad] = mask;
 unsigned values[] = {lx, ly, rx, ry};
 for(unsigned i = 0; i < 4; i++) axes[pad][i] = std::min(values[i], 255U);
}

int operationStatus()
{
 if(stateResult.valid())
 {
  if(stateResult.wait_for(std::chrono::seconds(0)) != std::future_status::ready) return 0;
  return stateResult.get() ? 1 : -1;
 }
 return vm->cloudStatus.load();
}

EMSCRIPTEN_BINDINGS(CloudRcade)
{
 using namespace emscripten;
#ifdef CLOUD_HANDOFF_DIAGNOSTIC
 function("nativeHandoffSnapshot", optional_override([]() {
  auto out=val::object();auto events=val::array();
  const auto reserved=CloudHandoff::Reserved().load(std::memory_order_acquire);
  uint32_t pending=0;
  for(uint32_t i=0;i<reserved;++i) {
   const auto& e=CloudHandoff::Events()[i];
   if(!e.ready.load(std::memory_order_acquire)){++pending;continue;}
   auto row=val::object();row.set("seq",i);row.set("ms",e.ms);row.set("kind",e.kind);
   row.set("epoch",e.epoch);row.set("thread",e.thread);row.set("mailbox",e.mailbox);
   row.set("message",e.message);row.set("parent",e.parent);events.call<void>("push",row);
  }
  out.set("clock",std::string("performance.timeOrigin+performance.now"));
  out.set("capacity",CloudHandoff::Capacity);out.set("reserved",reserved);out.set("pending",pending);
  out.set("dropped",CloudHandoff::Dropped().load(std::memory_order_relaxed));out.set("epoch",CloudHandoff::Epoch());
  out.set("events",events);return out;
 }));
#endif
 function("setNativeTimingEnabled", &CloudCpuTiming::SetEnabled);
 function("nativeCpuTiming", optional_override([]() {
  auto snapshot = val::object();
  const auto state = CloudCpuTiming::State().load(std::memory_order_relaxed);
  snapshot.set("epoch", state); snapshot.set("enabled", bool(state & 1));
  auto categories = val::array();
  for(unsigned i = 0; i < CloudCpuTiming::Count; ++i) {
   const auto& counters = CloudCpuTiming::Counters()[i];
   auto category = val::object(); category.set("name", CloudCpuTiming::Name(i));
   category.set("calls", double(counters.calls.load(std::memory_order_relaxed)));
   category.set("samples", double(counters.samples.load(std::memory_order_relaxed)));
   category.set("microseconds", double(counters.microseconds.load(std::memory_order_relaxed)));
   categories.call<void>("push", category);
  }
  snapshot.set("categories", categories); return snapshot;
 }));
 function("nativeMovieTiming", optional_override([]() {
  const auto snapshot = CloudMovieMetrics::Read();
  auto result = val::object();
  result.set("epoch", snapshot.epoch);
  result.set("codedBlocks", snapshot.codedBlocks);
  result.set("uncodedBlocks", snapshot.uncodedBlocks);
  result.set("idctCalls", snapshot.idctCalls);
  result.set("zeroBlocks", snapshot.zeroBlocks);
  result.set("dcOnlyBlocks", snapshot.dcOnlyBlocks);
  result.set("acBlocks", snapshot.acBlocks);
  result.set("idctSamples", snapshot.idctSamples);
  result.set("idctMicroseconds", snapshot.idctMicroseconds);
  result.set("cscBlocks", snapshot.cscBlocks);
  result.set("cscSamples", snapshot.cscSamples);
  result.set("cscMicroseconds", snapshot.cscMicroseconds);
  return result;
 }));
 function("initialize", &initialize);
 function("setSystemLanguage", optional_override([](unsigned language) {
  if(!vm || language > 11) throw std::runtime_error("Invalid PS2 system language.");
  CAppConfig::GetInstance().SetPreferenceInteger(PREF_SYSTEM_LANGUAGE, language);
 }));
 function("getSystemLanguage", optional_override([]() { return CAppConfig::GetInstance().GetPreferenceInteger(PREF_SYSTEM_LANGUAGE); }));
 function("bootElf", optional_override([](std::string path) { vm->BootElf(path); }));
 function("bootDiscImage", optional_override([](std::string path) { vm->BootDiscImage(path); }));
 function("pauseVm", optional_override([]() { vm->CloudPause(); }));
 function("resumeVm", optional_override([]() { vm->CloudResume(); }));
 function("saveVm", optional_override([](std::string path) { stateResult = vm->SaveState(path); }));
 function("loadVm", optional_override([](std::string path) { stateResult = vm->LoadState(path); }));
 function("operationStatus", &operationStatus);
 function("lastError", optional_override([]() { return vm->cloudError; }));
 function("getFrames", optional_override([]() { return cloudRenderedFrames.load(); }));
 function("getNativeFrames", optional_override([]() { return frames.load(); }));
 function("getVideoFrames", optional_override([]() { return videoFrames.load(); }));
 function("getVideoRate", optional_override([]() { return vm->GetGSHandler()->GetCrtFrameRate(); }));
 function("setInput", &input);
}
