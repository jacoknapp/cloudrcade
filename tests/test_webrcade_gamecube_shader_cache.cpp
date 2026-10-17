#include "ShaderTranslationCache.h"
#include "TranslationWrapper.h"
#include <cassert>
#include <iostream>
#include <vector>

static bool fail_entry = false;
static bool fail_bytes = false;
void* operator new(std::size_t n, const std::nothrow_t&) noexcept
{
  if (fail_entry)
    return nullptr;
  return ::operator new(n);
}
extern "C" void* __real_malloc(std::size_t);
extern "C" void* __wrap_malloc(std::size_t n)
{
  return fail_bytes ? nullptr : __real_malloc(n);
}

using Cache = WebGPU::ShaderTranslationCache;

int main(int argc, char**)
{
  if (argc > 1)
  {
    using namespace WebGPU;
    // A separate process models a new module with an empty native UID cache.
    // Import a verified previous-launch result before its first source demand.
    const char source[] = "repeat", wgsl[] = "wgsl:repeat";
    assert(DolphinWeb_ImportShaderTranslation(0, 0, source, 6, wgsl, 11));
    assert(GlslToWgsl(ShaderStage::Vertex, source, ShaderTranslationVariant::Standard) == wgsl);
    assert(compiler_calls == 0);
    assert(!DolphinWeb_ImportShaderTranslation(4, 0, source, 6, wgsl, 11));
    assert(!DolphinWeb_ImportShaderTranslation(0, 2, source, 6, wgsl, 11));
    assert(!DolphinWeb_ImportShaderTranslation(0, 0, source, 6, wgsl, 0));
    assert(!DolphinWeb_ImportShaderTranslation(0, 0, nullptr, 6, wgsl, 11));
    std::cout << "restored cold demand: 0 compiler calls; invalid imports rejected\n";
    return 0;
  }
  {
    Cache cache(16, 1024);
    std::string config = "header", source = "shader", wgsl = "translated";
    cache.Store({0, 0, config, source}, wgsl);
    config[0] = source[0] = wgsl[0] = '!';
    assert(cache.Find({0, 0, "header", "shader"}) == "translated");
    assert(!cache.Find({1, 0, "header", "shader"}));
    assert(!cache.Find({0, 1, "header", "shader"}));
    assert(!cache.Find({0, 0, "Header", "shader"}));
    assert(!cache.Find({0, 0, "header", "Shader"}));
    // Equal concatenations deliberately produce the same hash; keys differ.
    cache.Store({0, 0, "ab", "c"}, "first");
    cache.Store({0, 0, "a", "bc"}, "second");
    assert(cache.Find({0, 0, "ab", "c"}) == "first");
    assert(cache.Find({0, 0, "a", "bc"}) == "second");
    cache.Store({0, 0, "", std::string_view("a\0b", 3)}, std::string_view("x\0y", 3));
    assert(cache.Find({0, 0, "", std::string_view("a\0b", 3)}) == std::string("x\0y", 3));
    assert(!cache.Find({0, 0, "", "a"}));
    cache.Store({0, 0, "", "empty-output"}, "");
    assert(!cache.Find({0, 0, "", "empty-output"}));
    const auto before = cache.GetStats();
    cache.Store({0, 0, "header", "shader"}, "duplicate");
    assert(cache.GetStats().entries == before.entries);
    assert(cache.GetStats().bytes == before.bytes);
    assert(cache.Find({0, 0, "header", "shader"}) == "translated");
    Cache restored;
    cache.Visit([&restored](const Cache::Key& key, std::string_view output) { restored.Store(key,output); });
    assert(restored.Find({0, 0, "ab", "c"}) == "first");
    assert(restored.Find({0, 0, "header", "shader"}) == "translated");
  }
  {
    Cache cache(2, 12);
    cache.Store({0, 0, "h", "a"}, "AAAA");
    cache.Store({0, 0, "h", "b"}, "BBBB");
    assert(cache.GetStats().bytes == 12);
    auto owned = cache.Find({0, 0, "h", "a"});
    cache.Store({0, 0, "h", "c"}, "CCCC");
    assert(!cache.Find({0, 0, "h", "b"}));
    assert(cache.Find({0, 0, "h", "a"}) == "AAAA");
    // Byte pressure can evict more than one record; returned bytes stay valid.
    cache.Store({0, 0, "h", "d"}, "1234567890");
    assert(cache.GetStats().entries == 1 && cache.GetStats().bytes == 12);
    assert(cache.GetStats().evictions == 3);
    assert(owned == "AAAA");
    cache.Store({0, 0, "h", "too-large"}, "1234567890123");
    assert(cache.GetStats().entries == 1 && cache.GetStats().bytes == 12);
    assert(cache.Find({0, 0, "h", "d"}) == "1234567890");
    assert(cache.GetStats().rejected == 1);
  }
  {
    Cache cache(1, 100);
    cache.Store({0, 0, "", "old"}, "retained");
    fail_entry = true;
    cache.Store({0, 0, "", "entry-fail"}, "valid");
    fail_entry = false;
    fail_bytes = true;
    cache.Store({0, 0, "", "bytes-fail"}, "valid");
    fail_bytes = false;
    assert(cache.GetStats().allocation_failures == 2);
    assert(cache.GetStats().entries == 1 && cache.GetStats().evictions == 0);
    assert(cache.Find({0, 0, "", "old"}) == "retained");
    Cache disabled(0, 100), no_bytes(10, 0);
    disabled.Store({0, 0, "", "a"}, "b");
    no_bytes.Store({0, 0, "", "a"}, "b");
    assert(disabled.GetStats().entries == 0 && no_bytes.GetStats().bytes == 0);
  }
  {
    Cache cache(256, 8 * 1024 * 1024);
    for (int i = 0; i < 10000; ++i)
    {
      const auto source = std::to_string(i);
      cache.Store({0, 0, "config", source}, std::string(65536, 'w'));
      assert(cache.GetStats().entries <= 256);
      assert(cache.GetStats().bytes <= 8 * 1024 * 1024);
    }
  }
  {
    // Exercise the exact production wrapper against a deterministic compiler.
    using namespace WebGPU;
    const auto standard = ShaderTranslationVariant::Standard;
    const auto color = ShaderTranslationVariant::DestinationAlphaColor;
    assert(GlslToWgsl(ShaderStage::Vertex, "repeat", standard) == "wgsl:repeat");
    for (int i = 0; i < 100; ++i)
      assert(GlslToWgsl(ShaderStage::Vertex, "repeat", standard) == "wgsl:repeat");
    assert(compiler_calls == 1);
    assert(GlslToWgsl(ShaderStage::Pixel, "repeat", standard));
    assert(GlslToWgsl(ShaderStage::Vertex, "repeat", color));
    assert(compiler_calls == 3);
    assert(!GlslToWgsl(ShaderStage::Vertex, "failed", standard));
    assert(!GlslToWgsl(ShaderStage::Vertex, "failed", standard));
    assert(compiler_calls == 5 && GetShaderTranslationCacheStats().failures == 2);
    // Compiler results remain usable when cache allocation fails.
    fail_bytes = true;
    assert(GlslToWgsl(ShaderStage::Vertex, "uncached", standard) == "wgsl:uncached");
    fail_bytes = false;
    assert(GlslToWgsl(ShaderStage::Vertex, "uncached", standard));
    assert(compiler_calls == 7);
    std::vector<std::thread> threads;
    for (int i = 0; i < 4; ++i)
      threads.emplace_back([standard] {
        for (int n = 0; n < 500; ++n)
          assert(GlslToWgsl(ShaderStage::Vertex, "repeat", standard) == "wgsl:repeat");
      });
    for (auto& thread : threads)
      thread.join();
    assert(compiler_calls == 7);
    assert(GetShaderTranslationCacheStats().hits == 2100);
    std::cout << "wrapper: 2100 repeat translations avoided; 2 failures retried\n";
  }
}
