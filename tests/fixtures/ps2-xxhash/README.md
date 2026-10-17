# Pinned PS2 xxHash differential

From the repository root, run:

```
python3 tests/test_webrcade_ps2_xxhash.py --xxhash /path/to/Play/deps/Dependencies/xxHash --output /tmp/ps2-xxhash-fixture
```

Requires Docker with the pinned Emscripten4.0.10 image and Node. Inputs are the
exact xxHash0.8.3 header/C source; hashes are checked before compiling. Builds
the actual library twice, changing only the library translation unit's
`-msimd128` flag, and links each without that additional flag. The pinned
compiler selects upstream's scalar and Wasm SIMD via NEON/SIMDe backends.

The synthetic fixture compares all128 output bits across36,960 cases: every
length0–257, stripe/block/page/64KiB/1MiB boundaries,32 starting alignments,
four byte patterns, and inputs ending at the actual Wasm linear-memory end.
The last category traps an out-of-bounds vector read. Final linked Wasm must
contain ordinary SIMD load/add/extended-multiply instructions.

An eight-window balanced scalar/SIMD page-hash screen hashes262MiB per window
and reports checked checksums and times. This is a local hash benchmark, not
a game speed, browser/phone, or end-to-end performance claim. Output contains
only original synthetic data and generated fixture artifacts. This native
test is invoked explicitly and is not part of the portable overlay suite.
