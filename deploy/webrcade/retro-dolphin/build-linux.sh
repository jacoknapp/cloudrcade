#!/bin/bash
set -euo pipefail
# SDK tools run as root. Return only the isolated build mounts to the caller so
# an ordinary CI user can package and remove generated compiler/cache files.
trap 'TASK_GC_EXIT=$?; chown -hR -- "${GAMECUBE_BUILD_UID:-0}:${GAMECUBE_BUILD_GID:-0}" /work /toolchain; exit "$TASK_GC_EXIT"' EXIT
apt-get update -qq
apt-get install -y -qq ninja-build=1.11.1-2 pkg-config=1.8.1-2build1 > /tmp/build-tools.log
export RUSTUP_HOME=/toolchain/rustup CARGO_HOME=/toolchain/cargo
export PATH=/toolchain/cargo/bin:$PATH
export SOURCE_DATE_EPOCH=1789334235
if [ ! -x /toolchain/cargo/bin/rustc ]; then
  curl --fail --location --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/rust-lang/rustup/d95a37b6ab92cc1e455d1576039333c97ca3e2c5/rustup-init.sh -o /toolchain/rustup-init.sh
  printf '%s  %s\n' 7d0ea0f8eba7fa1ebfe998091cd7ec4501e33ec5ca6b884eb4d894d7da5170af /toolchain/rustup-init.sh | sha256sum --check
  RUSTUP_VERSION=1.29.1 sh /toolchain/rustup-init.sh -y --no-modify-path --profile minimal --default-toolchain nightly-2026-05-10
fi
rustup component add rust-src --toolchain nightly-2026-05-10
[ "$(rustc --version)" = 'rustc 1.97.0-nightly (82bee9650 2026-05-09)' ]
[ "$(cargo --version)" = 'cargo 1.97.0-nightly (a343accce 2026-05-08)' ]
[ "$(ninja --version)" = '1.11.1' ]
cmake --version | head -n 1 | grep -Fx 'cmake version 3.28.3'
emcc --version | head -n 1 | grep -F '5.0.7 (263db4cffa6f9fc2ec514a70abac81362ea41849)' 
rustc --version
cargo --version
emcc --version
cmake --version
ninja --version
cd /work/tools/naga-spirv-wgsl
cargo build --locked --release --target wasm32-unknown-emscripten
cd /work
flags='-O3 -pthread -msimd128 -flto -DXXH_VECTOR=0 -DDOLPHIN_WEB_HOT_COUNTERS=0 -DDOLPHIN_WEB_INLINE_FAST_BRANCH=1 -DDOLPHIN_WEB_FALLBACK_MAP_DIAGNOSTICS=0 -DDOLPHIN_WEB_FALLBACK_MAP_BITS=16 -DDOLPHIN_WEB_DIRECT_WASM_BLOCK_DISPATCH=0'
opts=()
for opt in ENABLE_QT ENABLE_NOGUI ENABLE_CLI_TOOL ENABLE_HEADLESS ENABLE_ALSA ENABLE_PULSEAUDIO ENABLE_CUBEB ENABLE_X11 ENABLE_EGL ENABLE_SDL ENABLE_VULKAN ENABLE_LLVM ENABLE_TESTS USE_UPNP USE_DISCORD_PRESENCE USE_MGBA USE_RETRO_ACHIEVEMENTS ENABLE_AUTOUPDATE ENABLE_ANALYTICS ENCODE_FRAMEDUMPS WITH_OPTIM WITH_SSE2 WITH_SSSE3 WITH_SSE41 WITH_SSE42 WITH_PCLMULQDQ WITH_AVX2 WITH_AVX512 WITH_AVX512VNNI WITH_VPCLMULQDQ; do opts+=("-D$opt=OFF"); done
emcmake cmake -S /work/vendor/dolphin -B /work/build/linux-native -GNinja -DCMAKE_BUILD_TYPE=Release -DCMAKE_TRY_COMPILE_CONFIGURATION=Debug -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DCMAKE_DISABLE_FIND_PACKAGE_Git=ON -DDOLPHIN_WC_REVISION=e22551eae1c84a7e4d0b6a5c519ef4ed4ef69df1 -DDOLPHIN_WC_DESCRIBE=e22551eae1 -DDOLPHIN_WC_BRANCH=HEAD -DUSE_SYSTEM_LIBS=OFF -DENABLE_GENERIC=ON "${opts[@]}" \
 "-DCMAKE_C_FLAGS:STRING=$flags" "-DCMAKE_CXX_FLAGS:STRING=$flags" -DCMAKE_C_FLAGS_DEBUG:STRING='-O0 -fno-lto' -DCMAKE_CXX_FLAGS_DEBUG:STRING='-O0 -fno-lto' \
 -DDOLPHIN_WASM_NAGA_WGSL_LIB=/work/tools/naga-spirv-wgsl/target/wasm32-unknown-emscripten/release/libnaga_spirv_wgsl.a \
 -DDOLPHIN_WASM_JIT_CACHE_PRE_JS=/work/tools/jit-cache-prejs.js -DDOLPHIN_WASM_MEMORY_PAGES=12288 \
 -DDOLPHIN_WASM_PROJECT_ROOT=/work -DDOLPHIN_WASM_BRIDGE_SOURCE=/work/core/upstream/dolphin_web_discio.cpp \
 -DDOLPHIN_WASM_CORE_SOURCE=/work/core/upstream/dolphin_web_core.cpp -DDOLPHIN_WASM_SHARED_SOURCE_DIR=/work/core/upstream \
 -DDOLPHIN_WASM_OUTPUT_DIR=/work/build/linux-artifacts
cmake --build /work/build/linux-native --target dolphin_web_core --parallel "${GAMECUBE_BUILD_JOBS:-8}"
