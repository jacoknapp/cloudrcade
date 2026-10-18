# Bounded context memory-offset proof

This synthetic fixture builds the actual Emscripten `CMipsJitter` and actual Wasm
backend from the qualified 5833 source, using SDK image
`sha256:cfb9617d93d63f0eaa3ee2563df595ec98fc7456854df77e680f8b472e173fc6`.
It does not build a complete emulator, use a GPU, or include guest/ROM code.

Run from the repository:

```sh
python3 tests/test_webrcade_ps2_context_memarg.py \
  --play /tmp/kh-tree-native-readback/Play \
  --libraries-play /tmp/kh-swing-timing-native/Play \
  --output /dev/shm/kh-context-memarg-proof-fresh
```

Use a fresh owned output directory. The runner verifies retained dependency
sources and all seven original patch-input hashes, tests every source guard
against partial writes, and compiles both variants. Each variant freshly compiles
the generic CodeGen base/factory, all four Wasm emitters, and CMipsJitter. Retained
optimizer objects cannot instantiate the expanded Wasm backend and retain their
original virtual slot numbering; the new optional virtual is appended. A full
native build must rebuild header dependents rather than reuse these fixture
archives as product artifacts.

`execute-vu.cjs` reuses the independent eight-slot ring oracle for 84,576 complete
CMIPS comparisons, including canaries, all indices and eligibility masks, signed
wrap, sticky/MAC/clip state, queue/reset, and GetStatus. The old VU reader is used
in both variants: only bounded context addressing differs.

`execute-access.cjs` checks whole 256 KiB linear memory, independent raw-byte copy,
masked-lane and conversion oracles, observer arguments and effects, aliases,
repeated Begin/End, actual R0 specialization and VU destination-zero discard,
4/8/16-byte accesses, both manual FPU conversion paths, pointer-field reads,
unchanged direct/indexed referenced targets and traps, exact-end/first-outside
bounds, signed and unsigned LEB boundaries, and default/reset byte identity.
Mode 2 uses two existing FP negations, because the baseline has no FP MOV matcher.
The tests observe actual 32-bit pointer size and 2,864-byte CMIPS layout.

Generic context `0xfffffff0` plus offset 32 must still wrap to address 16. This
pointer is deliberately excluded from the opt-in whole-valid-object contract.
Some negative relative offsets already emit invalid signed-LEB i32 constants in
the original backend. Those cases check identical generic bytes and validation
failure parity; this patch does not repair or claim executable parity for them.
Accesses outside the opted-in object retain the existing explicit i32 addition.
Corrupt guest pointer *field values* remain supported differential/trap inputs,
since the surrounding CMIPS object remains valid.

The runner executes default V8, Liftoff-only and TurboFan-only tiers. Generated
Wasm byte counts describe emission size, not application performance.

For a separate browser/JSC correctness check, serve the emitted synthetic
`portable-generated-corpus.json` and this directory's `portable-check.js` in a
cross-origin-isolated page, then call:

```js
await runContextMemargCorpus(await (await fetch('portable-generated-corpus.json')).json());
```

The portable subset includes representatives by operation, contract mode and
boundary category. It uses real generated modules and compares complete memory,
traps and observer effects. It needs no Node APIs, generator, emulator, game or
GPU. Only local Node execution has been checked here; browser/JSC execution must
be reported separately.

## Frozen local proof results

Default V8, Liftoff-only and TurboFan-only each passed:

- 84,576 VU state/canary cases across 132 generated kernel pairs.
- 5,969 access executions across 2,028 generated kernel pairs.
- 2,142 independent byte/conversion oracle checks.
- 1,134 generic/default-reset byte-identical kernels.
- 830 trap-parity cases and 75 call-observation cases.
- 144 preserved baseline validation failures for existing negative encodings.

All seven source guards reject altered inputs before writes; repeated application
also rejects. The browser-compatible subset passed 189 modules locally in Node;
JSC/browser execution remains untested. Synthetic direct VU Wasm shrank 722 to
647 bytes and the mixed-width module 191 to 161 bytes. These are correctness and
emission-size results, not throughput evidence.

The seven-file installed-source diff has SHA256
`4ffad97d9a577245042d75aa24e594fe00d97172e6e75bda554bf34d6bb700cf`.
The isolated native input key is
`ca41798e34094237d624d1c69594083321973435cb9fc626cf3fdcf9cf4f2d99`.
