# VU reverse flag-ring scan

Run the actual VUShared/CMipsJitter/Wasm differential:

```sh
python3 tests/test_webrcade_ps2_vu_reverse_scan.py \
  --play /path/to/installed/Play \
  --libraries-play /path/to/matching/retained/build/Play \
  --output /tmp/new-empty-vu-reverse-scan-proof
```

This is a separate one-factor candidate based on 5833a9d. It does not include
the newest-slot-prefix candidate, MakeSz changes, vector forwarding or FMAC
entry tests. The actual baseline source, CodeGen/Framework dependencies and
retained archives are checked and mounted read-only. Only a small generator
with actual VUShared/MipsJitter/FpUtils is compiled; no Play core or GPU build,
game, state archive or production setting is accessed.

The old scan visits `(index + 0) & 7` through `(index + 7) & 7` and keeps the
last mature entry. The candidate visits those slots in reverse order and
stops at the first match. Nested Jitter branches generate at most eight signed
timestamp comparisons and at most one value load/flag store. When no slot is
mature the original flag is preserved. No timestamp sorting assumption,
emulated delay, queue write, saved-state field or array layout changes.

The fixture reuses the newest-slot candidate's independent complete-state
oracle and C++ generation matrix, comparing the reverse candidate directly
against original 5833 generation. It passed 50,784 cases across 129 generated
kernel pairs: all eight ring indices, all 256 maturity masks at four signed
thresholds, arbitrary times/values, wrapped constants, MAC/sticky/CLIP,
GetStatus, repeated reads and queue/reset sequences. All 2,864 CMIPS bytes and
128 canary bytes are checked. Twenty-one queue/reset-only controls generate
byte-identical modules. There are 5,265 signed/unsigned disagreement cases.
Actual backend comparison is signed `i32.le_s` after wrapping i32 addition;
the unsigned immediate C++ helper is not used as the wraparound oracle.

Initial direct-reader code size is 722 to 959 Wasm bytes. Separate local Node
22.23.3/V8 12.4 x86 inspection shows TurboFan instruction bytes 380 to 524
(padded bodies 448 to 576) and Liftoff 712 to 1,096 (768 to 1,152 padded).
The baseline retains eight stores and 33 guest-state loads. TurboFan reverse
execution performs `3*k + 2` state loads and one store when the winner is the
kth tested slot; no match performs 24 loads and zero stores. There can be eight
conditional branches and an exit jump. These larger bodies and branch
prediction/compilation costs are material risks, especially before optimized
tiering. Reduced memory work is not a whole-game or iPhone performance result.

The output contains generated modules, exact source/dependency provenance and
the scalar result. Game eligibility and game throughput remain unmeasured.
Root owns any full core build and balanced whole-VM evaluation. The previous
newest-slot candidate and its ongoing cohort remain unchanged.
