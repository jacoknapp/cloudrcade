#!/bin/bash
set -euo pipefail
cd /src
emcmake cmake --preset wasm-ninja -DBUILD_PSFPLAYER=OFF
cmake --build build_cmake/build/wasm-ninja --config Release --target Play -j "${PS2_BUILD_JOBS:-4}"
