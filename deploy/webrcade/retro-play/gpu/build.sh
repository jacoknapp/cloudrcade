#!/bin/bash
set -euo pipefail
cd /src/CloudGPU
em++ gpu.cpp state.cpp bridge.cpp gs.wgsl.cpp blit.wgsl.cpp -o Gpu.js \
 -std=c++20 -O3 -DPS2_GPU --use-port=/src/CloudGPU/dawn/emdawnwebgpu_pkg/emdawnwebgpu.port.py \
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=CloudGpu -sASYNCIFY=1 \
 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sENVIRONMENT=web \
 -sEXPORTED_FUNCTIONS=_malloc,_free,_gpu_init,_gpu_write,_gpu_image,_gpu_present,_gpu_download,_gpu_download_snapshot_range,_gpu_seed_download_snapshot,_gpu_state_size,_gpu_save,_gpu_load,_gpu_reset,_gpu_destroy,_gpu_wait,_gpu_batch,_gpu_set_timing,_gpu_has_timestamps,_gpu_compute_samples,_gpu_compute_ms \
 -sEXPORTED_RUNTIME_METHODS=ccall,HEAPU8 -fexceptions
