# Bounded instruction-page snapshots

Run from the repository root with the pinned Play checkout available:

```sh
python3 tests/test_webrcade_ps2_page_snapshot.py --play /path/to/Play --output /tmp/ps2-page-snapshot
```

Requires Docker with the pinned Emscripten SDK image already present and Node.
No network, game, BIOS, state, browser or GPU is used. The checkout is read only:
pristine pinned source is read through `git show` into owned output scratch.

The driver installs both the original pinned baseline and the candidate's
actual guarded terminal helper, requiring exact four-source output hashes.
It freshly extracts registration, cleanup, reset and FlushCache methods after
each installation and compiles them with
the actual page helper and pinned xxHash. A small block lookup/range-clear host
stands in for the unchanged generic executor. Lifecycle outcomes are compared
to independently saved exact instruction bytes. Checks cover cross-page and
overlapping entries, modifications before another same-page compilation, data
writes, last RAM bytes, explicit protected executing blocks, all-block state-load
invalidation, capped allocation/fallback/reuse, and deterministic mixed actions.
This establishes the coherence metadata/filter behavior, not full emulator or
state-format qualification; the real-core homebrew code-cache probe remains
required before selecting a release.

The persistent regression includes13 registration/reversion sequences in both
snapshot and fallback paths. Its independent compiled-byte oracle retains the
original baseline's12 known failures and requires zero candidate failures.
Covered/uncovered chunks, intervening flushes, dense saturation, stale coverage,
overlapping live blocks and recompilation at an existing start are included.
An additional2000-cycle register/revert/clear/reset corpus requires the fixed
candidate digest3495471624. Independent byte-membership and equality oracles
check42928 coverage and506521 sparse comparison cases, preserving conservative
stale bits, sticky FULL, page-end bounds and zero-mask behavior.

The first flush after700 registrations explicitly requires188 fallback-page
hashes and700 block hashes; the second unchanged flush requires188 and zero.
These checks retain the extra pending-validation work rather than treating it
as unchanged-page fast-path work. Fixture-only COHERENCE_PENDING and
PROTOTYPE_SPARSE macros select expectations/oracles; they do not gate product
behavior or change compiler flags on existing product sources.

The JS fixture changes every byte/bit in a page, tests unaligned inputs and
actual linear-memory-end bounds, and screens warmed balanced unchanged-page
hashing versus the actual comparison helper. The latter is a synthetic host
screen, not a game or phone performance claim. The final WAT must contain
ordinary SIMD load/XOR/OR/any-true operations. Production JS-exception and
pthread flags remain enabled. The exact comparison must feed Sync’s unchanged-page branch directly
(or inline), without per-page EH flag checks; the C++
fixture also requires the helper declaration to be noexcept. Only the helper and the already
shipped xxHash object receive SIMD flags; existing EE code and link do not.

Each baseline/candidate output directory includes `page-snapshot-result.json`, compiled Wasm/WAT and generated
patched source/snippets. Product snapshots are host-only, capped at512×4KiB
(2MiB payload), and freed with compiled-page metadata; excess pages retain the
existing page-hash filter. Every FlushCache still checks every compiled page.

## Sparse integration source check

```sh
python3 tests/test_webrcade_ps2_sparse_snapshot.py --play /path/to/Play
```

This separate Python/Git check runs the complete installed patch chain from
committed upstream blobs without compiling, networking or using a GPU. It
requires the pinned Play checkout and Framework submodule locally. It checks
the four exact frozen candidate outputs, unchanged remaining installed sources,
installation order and rejection without partial writes for each missing or
altered original, repeated installation and a late missing replacement anchor.
It supplements execution proof. For source extraction checks without compiling:

```sh
python3 tests/test_webrcade_ps2_page_snapshot.py --play /path/to/Play --output /tmp/ps2-source-only --source-only
```

That mode applies the real helper, checks exact source pins and extracts actual
bodies for both variants, then stops before Docker, Node or a compiler. It
produces `installed-source.json` and grants no runtime or codegen PASS.

The draft sparse helper records conservative 64-byte coverage, saturating to
the original full-page comparison above16 chunks until page removal/reset.
Every block registration also marks its page pending validation, including
fallback pages: the next FlushCache must validate original block hashes even
when RAM equals the previous page snapshot/hash. Registration never refreshes
snapshots. This adds a mask, pending flag and possible alignment padding per
page, plus extra first-flush work. Execution proof, native artifacts and root
selection remain required; source installation success is not qualification.
