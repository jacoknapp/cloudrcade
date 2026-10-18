# PS2 sparse timing cleanup paths

Run from the repository root:

```
python3 tests/test_webrcade_ps2_timing_codegen.py --output /tmp/ps2-timing-codegen
```

Requires Docker with pinned Emscripten4.0.10 and Node. This explicit native test
runs the shared host semantic fixture under Wasm `-pthread -fexceptions`, then
compiles a synthetic indirect-call loop with the same exception mode. It checks
return/checksum equality, disabled counters, enabled call counts and final Wasm
direct-call paths. Artifacts and disassembly are kept in the selected directory.

Optional `--baseline-header /path/to/prior/CpuTiming.h` also runs eight balanced
warm baseline/candidate windows for OFF and ON collection and compares exact
sample counts. A six-million-call microbenchmark isolates the timing mechanism;
it does not predict game speed or physical-device performance. A fresh output
directory avoids accidentally including old baseline files. No game/state/GPU
or full-core build is involved.
