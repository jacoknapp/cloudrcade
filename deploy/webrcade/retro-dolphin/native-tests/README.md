# Narrow FPR locals and native slice totals

These fixtures validate downstream patches `0010-fpr-locals-and-slice-totals.patch` and
`0013-snapshot-paired-scalar.patch`
without changing retained native sources or running a full native build. Native
locks and release artifacts require separate qualification and regeneration.

Use the verified deployed source tree with digest
`db78df09bb2f6620457b462439ea5a10cb79746da8f2beb0b83460d61fbbba09`.
The harness also pins the exact original emitter file checksum. It copies only
the two affected files into scratch, applies the patch there, extracts the actual
builder/cache/arithmetic/helper emission functions, and compiles small host
emitters with g++. Node executes their generated shared-memory Wasm modules.
Requires Python 3, g++ with C++20, git and Node with shared Wasm memory support.

```sh
python3 deploy/webrcade/retro-dolphin/native-tests/fpr-locals.py \
  --source /tmp/cloudrcade-gc-restore-native --output /tmp/gc-cpu-fixture

g++ -std=c++20 -O2 -pthread \
  -I/tmp/gc-cpu-fixture/candidate-source/vendor/dolphin/Source/Core/Core \
  deploy/webrcade/retro-dolphin/native-tests/slice-totals.cpp \
  -o /tmp/gc-cpu-fixture/slice-totals
/tmp/gc-cpu-fixture/slice-totals
```

`--candidate /absolute/path/CachedInterpreter.cpp` optionally tests an already
patched emitter. Use a fresh output directory for reviewable results.

The 64 sequences cover scalar/paired arithmetic, scalar lane forms, all paired
merges, fmr/frsp, destination/source aliases, short ineligible runs and fallback
boundaries. Twenty-seven edge/random bit patterns include signed zero,
subnormals, infinities and signaling/quiet NaNs. Five helper modes mutate every
FPR plus status/NPC/MSR, resume direct execution, or halt. All 2048 state bytes,
return codes and import traces must equal the pinned memory-based emitter.
Cache-disabled output must remain byte-identical to reference; short/ineligible
runs must remain byte-identical even with caching enabled. An eight-paired-add
sequence verifies actual fast-branch state accesses fall from 32 loads/16 stores
to four loads/two stores. It does not time a game.

The harness narrows the instruction dispatcher to the tested real emitters and
uses scripted imports to test the cache contract. It does **not** execute the
full Dolphin interpreter, MMU, exceptions or FPSCR implementations, nor qualify
save/load, instruction invalidation or real-game speed. The change retains the
original scalar arithmetic/rounding bytecode and ends cache runs before memory,
partial-word, FPSCR, unknown or record-bit instructions. No explicit SIMD or
PowerPCState/save ABI change is introduced.

The slice fixture validates opt-in behavior, cumulative totals below the worst
slice, nested compile/wait subsets, coherent concurrent snapshots and saturation.
`slicetotals:v=1` reports process-lifetime totals over completed profiling-enabled
slices; toggling profiling preserves them. Compare deltas over a matched window.
`advanceInclUs`/`executeInclUs` are inclusive phases, and `compileSubsetUs`,
`throttleBlockedSubsetUs`, `dvdBlockedSubsetUs` are their known subsets. Do not
sum these as exclusive CPU categories or interpret them as all blocked time.
No per-instruction clocks or new hot-path clocks are added; counters publish once
per already-profiled execution slice. Profiling-off controls remain necessary.

The separate `0013` correctness patch snapshots the scalar only when FC aliases
FD lane 0, preventing `ps_muls0`/`ps_madds0` lane 1 from consuming the just-written
lane 0. The 24 additional alias sequences × six finite inputs compare cached
and cache-disabled output with four actual, checksum-pinned extracted
`Interpreter_Paired.cpp` function bodies. Finite arithmetic shims restrict this
oracle to operand ordering; status/exception/NaN/fused-rounding fidelity remains
outside its scope. All 144 comparisons pass; the old emitter fails 41, providing
a negative control. Nonalias reference differential cases remain unchanged.

The retained direct arithmetic emitter generally checks MSR.FP, rather than
falling back on all unusual FPSCR modes or nonfinite inputs. Existing
Force25Bit/NI_madd/FPRF differences must not be mistaken for new cache behavior;
these fixtures establish equivalence to the pinned emitted arithmetic, not
complete PowerPC floating-point conformance.

The patch exports `SetSliceTimingEnabled(int)` and `GetSliceTimingTotals()` with
`EMSCRIPTEN_KEEPALIVE`, independently of the broad worker `collectMetrics` gate.
The lightweight setter leaves per-block PPC profiling disabled, preserves block
redispatch and generated-block eligibility, and coexists with explicit
`SetPpcProfileEnabled` requests. The getter returns JSON:

```json
{"v":1,"enabled":true,"epoch":1,"slices":0,"totalUs":0,"advanceInclUs":0,"executeInclUs":0,"compileSubsetUs":0,"throttleBlockedSubsetUs":0,"dvdBlockedSubsetUs":0}
```

`epoch` advances on enabled/disabled state transitions. Totals persist across
those epochs; consumers reset their measurement window on a toggle/pause/load.
The host ABI fixture compiles the actual setters/getter and checks field names,
JSON parsing, epochs, lightweight opt-in and PPC-profile coexistence.
