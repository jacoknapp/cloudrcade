# Dedicated Wasm bitmask VU reader

This independently selectable source factor starts from baseline 5833a9d. The
native recipe calls only `patch-vu-bitmask.py`; it has no SIMD precursor patch.
Seven exact installed-source SHA256 guards are validated before any write.
`OP_MD_BITMASK_W` is appended so all existing opcode numbers remain unchanged.
Its Emscripten-only API creates a scalar result from a vector source. The Wasm
backend reuses its existing generic unary emitter for `i32x4.bitmask` (0xA4).
No other backend emits the new operation. The non-Emscripten VU reader remains
the original method body verbatim, and the existing MakeSz implementation is
unchanged. No state layout, pipeline timing, host import, or game selector changes.

Signed timestamp comparisons produce future bits in normal physical lane order.
`future ^ 255` gives the eight maturity bits. Rotating right by `index & 7`
converts these to forward logical ring order; the highest set bit identifies
the last eligible entry, without assuming sorted timestamps. Existing Lzc is
leading-sign count, so `30 - Lzc(mask)` identifies that bit. Empty masks produce
-1 before the final index mask, keeping the speculative value load bounded;
the final select retains the original flag. Time addition still wraps at 32
bits and timestamp comparison remains signed.

Run the actual-generator differential without a full core build:

```sh
python3 tests/test_webrcade_ps2_vu_bitmask.py \
  --play /path/to/installed/Play \
  --libraries-play /path/to/retained/build/Play \
  --output /dev/shm/new-empty-vu-bitmask-proof
node --liftoff-only /dev/shm/new-empty-vu-bitmask-proof/execute.cjs
node --no-liftoff /dev/shm/new-empty-vu-bitmask-proof/execute.cjs
```

The runner pins SDK image
`sha256:cfb9617d93d63f0eaa3ee2563df595ec98fc7456854df77e680f8b472e173fc6`.
It checks all retained CodeGen/Framework source/header inputs against installed
baseline before reusing their archives read-only. Candidate generation compiles
the actual changed Jitter.cpp, Jitter_CodeGen_Wasm_Md.cpp and
Jitter_Statement.cpp, linking those objects before the retained archive to
replace their original translation units. It also compiles actual VUShared,
CMipsJitter and FpUtils. The baseline retains all original CodeGen objects.
This is generated-code execution, not a model-only proof or Wasm byte rewrite.

Initial result: 84,576 complete CMIPS plus 128-canary comparisons, 132 generated
kernel pairs and 21 byte-identical queue/reset controls, passing independently
under default V8, forced Liftoff and forced TurboFan. Coverage includes all 256
eligibility patterns, all eight indices, eleven additional uint32 index edges,
random full-width indices, seven relative-time constants, signed-wrap edges,
nonsorted ring times, arbitrary values, initial flags, MAC/sticky/CLIP,
GetStatus, repeated reads, queue and reset. There are 9,494 signed/unsigned
negative controls and 580 empty-mask cases.

The dedicated API additionally passes 27,648 cases per tier, covering all 16
lane-sign masks; arbitrary low 31 bits; explicit uniform zero, all-one and
signed-boundary values; direct relative, XOR-temporary and indirect-reference
operands; aligned/unaligned offsets; source/output aliasing; and vector reads
ending exactly at linear-memory end. All result bits above bit 3 must be zero.
Eight original MakeSz generated controls remain byte-identical. Seven separate
corrupted-input tests verify each patch guard rejects before any partial write.

Local Node 22.23.3 / V8 12.4.254.21-node.57 x64 generated sizes:

| Reader | Wasm bytes | TurboFan instruction / padded body bytes | Liftoff instruction / padded body bytes |
| --- | ---: | ---: | ---: |
| Original | 722 | 380 / 448 | 712 / 768 |
| Frozen existing-API SIMD (133b87c) | 420 | 408 / 448 | 544 / 576 |
| Dedicated bitmask | 310 | 216 / 256 | 348 / 384 |

The dedicated direct reader has four scalar plus two vector loads and one flag
store. Local TurboFan lowers the two comparisons to `vpcmpgtd` and the masks to
two `vmovmskps`. Existing Lzc remains unchanged. These are code-generation and
correctness results, not throughput or iPhone/JSC measurements. Full native
build and balanced whole-VM measurement remain separate, gated work.

Local artifacts and receipts: `/dev/shm/kh-vu-bitmask-proof`. No game-derived
code, ROM or save is needed for this fixture.
