// Compile the actual shipped helper and cache wrapper, without a native/GPU build.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const patch = fs.readFileSync(path.join(__dirname,
  '../deploy/webrcade/retro-dolphin/native-patches/0011-cache-shader-translations.patch'), 'utf8');
function additions(file) {
  const section = patch.split('+++ b/Source/Core/VideoBackends/WebGPU/' + file + '\n')[1]?.split('\ndiff --git ')[0];
  assert.ok(section, 'Missing patched ' + file);
  return section.split('\n').filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n') + '\n';
}
const header = additions('ShaderTranslationCache.h');
const translator = additions('WebGPUShaderTranslator.cpp');
const wrapper = translator.match(/std::optional<std::string> GlslToWgsl\([\s\S]*?\n}\n/)[0];
const stats = translator.match(/ShaderTranslationCache::Stats GetShaderTranslationCacheStats\([\s\S]*?\n}\n/)[0];
const nativeImport = translator.match(/extern "C" EMSCRIPTEN_KEEPALIVE bool DolphinWeb_ImportShaderTranslation\([\s\S]*?\n}\n/)[0];
assert.match(additions('WebGPUGfx.cpp'), /ShaderTranslationVariant::DestinationAlphaColor/);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamecube-shader-cache-'));
try {
  fs.writeFileSync(path.join(dir, 'ShaderTranslationCache.h'), header);
  fs.writeFileSync(path.join(dir, 'TranslationWrapper.h'), `
#include <chrono>
#include <mutex>
#include <atomic>
#include <thread>
namespace WebGPU {
#define EMSCRIPTEN_KEEPALIVE
using u32 = std::uint32_t;
enum class ShaderStage : u32 { Vertex, Geometry, Pixel, Compute };
enum class ShaderTranslationVariant : u32 { Standard, DestinationAlphaColor };
static ShaderTranslationCache s_translation_cache;
static std::mutex s_translation_cache_mutex;
static constexpr std::string_view kShaderHeader = "fixture-header-spv1.0";
static std::atomic<int> compiler_calls = 0;
// Deterministic compiler fixture: only the uncached translator is replaced.
static std::optional<std::string> TranslateGlslToWgsl(ShaderStage, std::string_view source) {
  ++compiler_calls;
  if (source == "failed") return std::nullopt;
  return std::string("wgsl:") + std::string(source);
}
${wrapper}
${stats}
${nativeImport}
}
`);
  const binary = path.join(dir, 'test');
  const args = ['-std=c++20', '-fno-exceptions', '-pthread', '-Wall', '-Wextra', '-Werror',
    '-I' + dir, path.join(__dirname, 'test_webrcade_gamecube_shader_cache.cpp'),
    '-Wl,--wrap=malloc', '-o', binary];
  if (process.env.SHADER_CACHE_SANITIZE === '1') args.unshift('-fsanitize=address,undefined', '-fno-omit-frame-pointer');
  execFileSync(process.env.CXX || 'c++', args, {stdio: 'inherit'});
  execFileSync(binary, [], {stdio: 'inherit'});
  execFileSync(binary, ['restored-launch'], {stdio: 'inherit'});
  if (process.env.SHADER_CACHE_SDK_IMAGE) {
    const extra = ['DolphinWeb_ShaderTranslationRevision','DolphinWeb_GetShaderTranslationStats','DolphinWeb_ExportShaderTranslations']
      .map(name => translator.match(new RegExp('extern "C" EMSCRIPTEN_KEEPALIVE [^\\n]+ ' + name + '\\([\\s\\S]*?\\n}\\n'))[0]).join('\n');
    const integration = fs.readFileSync(path.join(dir,'TranslationWrapper.h'),'utf8')
      .replace('#define EMSCRIPTEN_KEEPALIVE','').replace(/\n}\s*$/, '\n' + extra + '\n}\n');
    fs.writeFileSync(path.join(dir,'SdkWrapper.h'),integration);
    fs.writeFileSync(path.join(dir,'sdk.cpp'), `
#include <emscripten/emscripten.h>
#include "ShaderTranslationCache.h"
#include "SdkWrapper.h"
#include <cassert>
int main() {
  using namespace WebGPU;
  assert(GlslToWgsl(ShaderStage::Vertex,"repeat",ShaderTranslationVariant::Standard));
  assert(GlslToWgsl(ShaderStage::Vertex,"repeat",ShaderTranslationVariant::Standard));
  assert(compiler_calls == 1);
  DolphinWeb_ExportShaderTranslations();
  assert(EM_ASM_INT({ return Module._cloudrcadeShaderSnapshot.length === 1 &&
    Module._cloudrcadeShaderSnapshot[0].source === "repeat" &&
    Module._cloudrcadeShaderSnapshot[0].wgsl === "wgsl:repeat"; }));
  DolphinWeb_GetShaderTranslationStats();
  assert(EM_ASM_INT({ return Module._cloudrcadeShaderCacheStats.hits === 1 &&
    Module._cloudrcadeShaderCacheStats.translations === 1; }));
}
`);
    fs.writeFileSync(path.join(dir,'run-sdk.sh'), `set -eu\ncd /fixture\nem++ -std=c++20 -fno-exceptions -pthread -Wall -Wextra -Werror sdk.cpp -sENVIRONMENT=node -sWASM_ASYNC_COMPILATION=0 -o sdk.js\nnode sdk.js\n`);
    execFileSync('docker',['run','--rm','--network','none','-v',dir+':/fixture',
      process.env.SHADER_CACHE_SDK_IMAGE,'bash','/fixture/run-sdk.sh'],{stdio:'inherit'});
    console.log('PASS pinned Emscripten native shader snapshot/stat EM_ASM APIs');
  }
  console.log('PASS native GameCube shader cache identity, ownership, bounded LRU, failures and concurrent wrapper reuse');
} finally {
  fs.rmSync(dir, {recursive: true, force: true});
}
