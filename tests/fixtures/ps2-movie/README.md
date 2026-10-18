# Exact movie decoder fixture

The runner compiles the untouched IEEE1180.cpp from Framework commit
`587f278917acc0026bf5fc34b39f995fc26bd015` (verified SHA256) alongside the
candidate. It needs that local Framework checkout, Docker, Node, g++ and the pinned
Emscripten 4.0.10 image already available. It never writes the source checkout.

Run from the repository:

```sh
python3 tests/test_webrcade_ps2_movie.py --framework /tmp/cloudrcade-ps2-build/Play/deps/Framework
```

Outputs and generated Wasm/disassembly live in an isolated temporary directory
reported by the runner; pass `--output` to choose it. The test checks every
coefficient, including aliased input/output, for all DC values -4096..4095,
zero, single-frequency/extreme impulses, and deterministic dense/sparse valid
and full-int16 blocks. Six alternating scalar/SIMD throughput pairs follow.
The header-only movie diagnostics also exercise disabled collection, coefficient
classification, epoch reset, in-flight toggle rejection and concurrent worker/read
access. In an isolated candidate worktree use `--cpu-timing /path/to/CpuTiming.h`
from the companion CPU timing change.

These are Node/V8 microbenchmarks, not full-core or phone speed evidence.
