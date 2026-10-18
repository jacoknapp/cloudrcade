#include "CloudInstructionPage.h"

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

bool CloudInstructionPage::Equals(const void* source) const noexcept
{
#ifdef __wasm_simd128__
 const auto* actual = static_cast<const uint8_t*>(source);
 const auto* saved = m_bytes.data();
 v128_t diff0 = wasm_i32x4_splat(0);
 v128_t diff1 = diff0, diff2 = diff0, diff3 = diff0;
 // Four independent reductions avoid a single long dependency chain. Every
 // load stays inside the 4KiB page, including a page at linear-memory end.
 for(unsigned offset = 0; offset < SIZE; offset += 64)
 {
  diff0 = wasm_v128_or(diff0, wasm_v128_xor(wasm_v128_load(actual + offset), wasm_v128_load(saved + offset)));
  diff1 = wasm_v128_or(diff1, wasm_v128_xor(wasm_v128_load(actual + offset + 16), wasm_v128_load(saved + offset + 16)));
  diff2 = wasm_v128_or(diff2, wasm_v128_xor(wasm_v128_load(actual + offset + 32), wasm_v128_load(saved + offset + 32)));
  diff3 = wasm_v128_or(diff3, wasm_v128_xor(wasm_v128_load(actual + offset + 48), wasm_v128_load(saved + offset + 48)));
 }
 return !wasm_v128_any_true(wasm_v128_or(wasm_v128_or(diff0, diff1), wasm_v128_or(diff2, diff3)));
#else
 return std::memcmp(m_bytes.data(), source, SIZE) == 0;
#endif
}
