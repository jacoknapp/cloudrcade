# Immutable GS readback snapshot fixtures

```sh
python3 tests/test_webrcade_ps2_readback.py --play /path/to/pinned/Play --output /tmp/ps2-readback
python3 tests/test_webrcade_ps2_readback.py --play /path/to/pinned/Play --output /tmp/ps2-readback-asan --sanitize
```

Requires Python, Git, Node and g++. It reads the pinned Play sources and verifies
the Framework submodule pin; the supplied checkout is read only. It compiles
host fixtures only, with no emulator/Wasm build, network, browser, GPU or game
data. Output contains extracted source and test binaries. ASan/UBSan is optional.

- `reader.cpp` uses the actual GS storage classes/swizzle tables and verbatim
  unpack/ReadImageDataImpl bodies. It compares every output/guard byte and
  cursor, and checks each actual source address against the planned interval.
  Cases cover CT32/Z32/CT24/Z24/CT16/Z16S/T8/T8H, odd/zero SBW, 256-byte SBP,
  page/RAM/coordinate wraps, padding, unsupported fallback and continued reads.
  NDEBUG matches the shipped reader. Synthetic nominal-size mismatches exercise
  planning from actual size/cursor rather than that field. Pinned BeginTransfer
  supports Z24; an 8×4 transfer programs 96 bytes.
- `snapshot.cpp` compiles the actual GPU snapshot implementation/reset export
  against an ordered queue observer. It checks capture A → VRAM B → ranged A,
  repeated/mismatched reads, full sync replacing the snapshot, archived CPU RAM
  differing from render VRAM, reset zero and bounds. Capture starts no CPU map.
- `native.cpp` compiles actual Copy/InitFromFrameDump/LoadState and frontend
  cache/load overrides with the real native mailbox. It checks seed-only copy
  and frame-dump restore, and load's seed → GPU load → seed ordering with
  deliberately different native RAM and GPU payloads. Archive/device transport
  is an observation stub; this does not qualify compressed files or GPU pixels.
- `bridge.cjs` imports the actual JS bridge and checks completion before native
  acknowledgement, memory growth, the already-offset output pointer, snapshot
  seeding and invalid descriptors.

The source contracts preserve the existing full `gpu_download` and serialized
GPU save/load bodies. The candidate retains the independent
register-tail correctness change at threshold 256.

## Device qualification still required

These are host correctness/ordering fixtures, not real GPU or speed evidence.
After the parent builds the exact CPU/GPU pair, run hardware snapshot A → render
VRAM B → ranged A; full SyncMemoryCache → ranged B; reset → zero; seed from
divergent archived native RAM → ranged archived bytes with unchanged render
VRAM; repeated/mismatched requests and every fallback. Compare complete VRAM,
GS/CLUT state and presentation against baseline. Then run actual-core old-state,
mid-transfer save/load, Copy/frame-dump where exposed, state/audio/input/lifecycle
and balanced varied-scene performance with diagnostics off.

The snapshot is transient and is not added to the state archive: native load
seeds it from the existing archived CPU RAM. Full sync refreshes both RAM and
snapshot. Full device copies remain 4 MiB; only CPU maps/copies become smaller.
Capture adds a device queue submission and 4 MiB device buffer. Existing display
fences do not retroactively cover later captures; range/save maps and later
queue completions retain the required ordering. No speed improvement is claimed.
