GameCube GPU texture decode qualification uses the exact pinned Dolphin generic
CPU decoder as its pixel reference, including CMPR's 3/8 interpolation and
transparent average RGB. It does not substitute a second JavaScript decoder.

From the repository root, with the verified native baseline cache:

```sh
python3 tests/fixtures/gamecube-texture-decode/check.py /tmp/cloudrcade-gc-restore-native
python3 tests/fixtures/gamecube-texture-decode/generate.py /tmp/cloudrcade-gc-restore-native /tmp/vectors.json
```

`check.py` applies only the candidate patch to isolated copies, builds the actual
candidate `WebGPUTexture.cpp` against small transport/owner/configuration stubs,
and links the pinned generic CPU decoder. It checks 68 format/TLUT/mip cases:
RAM/palette snapshots, lazy shadow parity, CPU copies, pooled replacement,
configuration/feature/shape/allocation fallback. It also asserts that rectangle copies,
resolves and CPU uploads publish prior draws before their immediate transfer.
Pass `--prepared --native-only` for the October17 thirteen-patch corresponding-source tree.
Use `--packaged --native-only` for a current corresponding-source tree that
already includes the transfer fix.
The baseline code fails the first copy-order assertion.
Stubs do not validate real native
ring backpressure or graphics state. The Node test executes the actual patched
worker opcode, held-upload scanner and state-load discard branch with controlled
ownership mocks; it also checks typed bindings, per-device pipeline caching,
input snapshots, cleanup and malformed packet rejection.

For hardware validation, serve this repository and generated `/vectors.json` on
an owned HTTPS/localhost origin. Import `browser.mjs` and call
`runTextureDecodeTests(await fetch('/vectors.json').then(r => r.json()))` in an
owned browser page with real device WebGPU. It returns the adapter, reference
source hash, 170 vector results, 24,106 pixels, 170 alias copies and 85 mip cases.
Every output byte must match. Inputs are mutated immediately after encoding to
exercise snapshot ownership. Alias textures must survive later overwrites of the
original texture; readbacks check actual submitted GPU output.

No ROMs, saves, operator profiles, credentials or service changes are needed.
Device lifecycle/native cache integration, game save/load and matched performance
remain separate full-core qualification. `wgpuTextureDecode:false` in worker init
clears the negotiated renderer bit and retains the exact original conversion path.
Decoder diagnostics report counts, input/output bytes and optional host encoding
time; host encoding time is not GPU execution time or saved CPU time.
