# SIMD VU flag-ring lookup

Run the actual-generator differential without building a full core:

```sh
python3 tests/test_webrcade_ps2_vu_simd_ring.py \
  --play /path/to/installed/Play \
  --libraries-play /path/to/retained/build/Play \
  --output /tmp/new-empty-vu-simd-ring-proof
```

The runner mounts both source/dependency inputs read-only, checks the pinned
VU/Wasm sources and retained CodeGen/Framework headers/sources, then compiles
actual VUShared.cpp and CMipsJitter with a pinned SDK. Both variants use the
unchanged Wasm emitter. Only CheckFlagPipeline differs. No new API, host import,
MakeSignZero optimization, timing change or game-specific condition is added.
The non-Emscripten implementation is the original method body verbatim.

Two vector loads read the eight timestamps. Signed `i32x4.gt_s` against wrapped
`pipeTime + relativePipeTime` marks immature entries. The unchanged
MD_MakeSignZero low nibble marks zero (mature) lanes in reverse lane order.
Combining the nibbles and rotating left by `index & 7` puts the reversed bits
in forward ring traversal order. The lowest set bit identifies the last mature
entry, without assuming sorted timestamps. Existing Lzc returns clz(x)-1 for
nonnegative x, so subtracting 23 converts the isolated bit into logical slot
7-ctz(x). A final index mask bounds every load, including empty masks. The final
select retains the original flag when none is mature. Intermediate values stay
on the Jitter shadow stack; no guest scratch fields are used.

The independent scalar oracle uses signed comparisons after wrapped 32-bit
addition, matching the actual original generated code. The C++ immediate
reader uses unsigned comparison and is deliberately not the oracle for signed
wrap edges. The proof compares every byte of CMIPS plus 128 canary bytes for
MAC, sticky, CLIP, GetStatus, repeated reads, queue/read and reset/read.
All eight positions and all 256 eligibility patterns are exhausted at four
signed thresholds. Eleven high-index uint32 edges and random full-width indices
exercise masking on read paths. Queue paths retain valid indices because their
unchanged original implementation requires them. Seven relative constants,
unsorted timestamps, arbitrary values/initial flags and signed wrap edges are
covered. Queue/reset-only generated controls must remain byte-identical.

Initial proof: 84,576 cases, 132 generated kernel pairs, 21 byte-identical
controls, passing separately with forced Liftoff and forced TurboFan; 9,494 signed/unsigned negative controls and 580 empty-mask cases.
Artifacts and provenance: `/tmp/kh-vu-simd-ring-proof`.

Local Node 22.23.3 / V8 12.4.254.21-node.57 size comparison:

| Reader | Generated Wasm | TurboFan instructions / padded body | Liftoff instructions / padded body |
| --- | ---: | ---: | ---: |
| Original | 722 | 380 / 448 | 712 / 768 |
| Reverse scan | 959 | 524 / 576 | 1096 / 1152 |
| SIMD mask | 420 | 408 / 448 | 544 / 576 |

The SIMD direct reader uses four scalar plus two vector guest loads and one
flag store, versus 33 scalar loads/eight stores in the original TurboFan reader.
Existing MakeSignZero emits unused high-nibble work and existing Lzc retains
an unreachable signed-negative arm; these helpers are deliberately unchanged.
The generated module has no call. These are code-generation/correctness results,
not browser/iPhone/game throughput or eligibility-frequency measurements.
Whole-game selection requires balanced uninstrumented controls on current
states, with runtime settings and clocks matched.
