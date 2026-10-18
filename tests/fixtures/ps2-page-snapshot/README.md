# Bounded instruction-page snapshots

Run from the repository root with the pinned Play checkout available:

```sh
python3 tests/test_webrcade_ps2_page_snapshot.py --play /path/to/Play --output /tmp/ps2-page-snapshot
```

Requires Docker with the pinned Emscripten SDK image already present and Node.
No network, game, BIOS, state, browser or GPU is used. The checkout is read only:
pristine pinned source is read through `git show` into owned output scratch.

The driver applies the actual guarded coherence patch to pinned EE sources and
compiles its extracted registration, cleanup, reset and FlushCache methods with
the actual page helper and pinned xxHash. A small block lookup/range-clear host
stands in for the unchanged generic executor. Lifecycle outcomes are compared
to independently saved exact instruction bytes. Checks cover cross-page and
overlapping entries, modifications before another same-page compilation, data
writes, last RAM bytes, explicit protected executing blocks, all-block state-load
invalidation, capped allocation/fallback/reuse, and deterministic mixed actions.
This establishes the coherence metadata/filter behavior, not full emulator or
state-format qualification; the real-core homebrew code-cache probe remains
required before selecting a release.

The JS fixture changes every byte/bit in a page, tests unaligned inputs and
actual linear-memory-end bounds, and screens warmed balanced unchanged-page
hashing versus the actual comparison helper. The latter is a synthetic host
screen, not a game or phone performance claim. The final WAT must contain
ordinary SIMD load/XOR/OR/any-true operations. Production JS-exception and
pthread flags remain enabled. The exact comparison must feed Sync’s unchanged-page branch directly
(or inline), without per-page EH flag checks; the C++
fixture also requires the helper declaration to be noexcept. Only the helper and the already
shipped xxHash object receive SIMD flags; existing EE code and link do not.

Outputs include `page-snapshot-result.json`, compiled Wasm/WAT and generated
patched source/snippets. Product snapshots are host-only, capped at512×4KiB
(2MiB payload), and freed with compiled-page metadata; excess pages retain the
existing page-hash filter. Every FlushCache still checks every compiled page.
