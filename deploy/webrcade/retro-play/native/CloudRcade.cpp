// CloudRcade browser host for Play!, under the repository's GPL-3.0 license.
#include <atomic>
#include <chrono>
#include <emscripten/bind.h>
#include "Ps2VmJs.h"
#include "GSH_OpenGLJs.h"
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
 EmscriptenWebGLContextAttributes attr;
 emscripten_webgl_init_context_attributes(&attr);
 attr.majorVersion = 2; attr.minorVersion = 0; attr.alpha = false;
 attr.proxyContextToMainThread = EMSCRIPTEN_WEBGL_CONTEXT_PROXY_ALWAYS;
 attr.explicitSwapControl = true;
 auto context = emscripten_webgl_create_context("#outputCanvas", &attr);
 if(context <= 0) throw std::runtime_error("PS2 requires WebGL2.");
 vm = new CPs2VmJs();
 CAppConfig::GetInstance().SetPreferencePath(PREF_PS2_MC0_DIRECTORY, "/cloudrcade/cards/mc0");
 CAppConfig::GetInstance().SetPreferencePath(PREF_PS2_MC1_DIRECTORY, "/cloudrcade/cards/mc1");
 vm->Initialize();
 vm->CreateGSHandler(CGSH_OpenGLJs::GetFactoryFunction(context));
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
 function("initialize", &initialize);
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
