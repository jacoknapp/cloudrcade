# PS2 VU sign and zero flags

`python3 tests/test_webrcade_ps2_vu_flags.py --play /path/to/retained/Play --output /tmp/owned-output`

Requires Docker with the pinned Emscripten SDK, Node, and the baseline retained
Release `libCodeGen.a`/`libFramework.a` libraries. The Play checkout is mounted
read-only; no full Play build, ROM, browser, network, or GPU is used. The test
compiles the actual pinned Wasm SIMD emitter twice, applying the production
checked patch only to the candidate copy, and links the actual CodeGen optimizer
and module builder. All other emitter source bytes must remain identical.

`generate.cpp` emits direct, computed temporary, aliased-result and unaligned
MakeSz functions through CJitter. `execute.cjs` executes both original modules,
compares all64context bytes with an independent integer sign/zero oracle, and
checks exact linear-memory-end accesses. Inputs cover all lane sign/zero
combinations, IEEE boundaries/NaNs, all65536high-half bit patterns, raw byte
patterns and100000random vectors. The patch must reject a second application.
Code inspection requires exactly one fewer i32x4.shr_s and unchanged zero
comparison/shuffle/bitmask count. A balanced warmed32-operation screen reports
synthetic timing only, with no game speed claim.

Artifacts stay in the selected owned output: compiled fixture modules,
baseline/candidate generated Wasm+WAT and aggregate `result.json`. No game bytes
or operator files are read or stored.
