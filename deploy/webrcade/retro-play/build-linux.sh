#!/bin/bash
set -euo pipefail
cd /src
emcmake cmake --preset wasm-ninja -DBUILD_PSFPLAYER=OFF
cmake --build build_cmake/build/wasm-ninja --config Release --target Play -j "${PS2_BUILD_JOBS:-4}"
bash /gpu-build.sh
cp /src/CloudGPU/Gpu.js /src/CloudGPU/Gpu.wasm /src/build_cmake/build/wasm-ninja/Source/ui_js/Release/
