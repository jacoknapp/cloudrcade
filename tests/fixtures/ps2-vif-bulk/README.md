# Contiguous VIF V4-32 unpack

From the repository root, with the pinned Play source available read-only:

```sh
python3 tests/test_webrcade_ps2_vif_bulk.py --play /path/to/Play --output /tmp/ps2-vif-bulk --check-mutations
python3 tests/test_webrcade_ps2_vif_bulk.py --play /path/to/Play --output /tmp/ps2-vif-bulk-sanitized --sanitize
```

Requires Python3 and a native C++17 `g++` compiler; `--compiler` selects another
compiler. No SDK, network, Docker, full core build, browser, game, save or GPU is
used. Source is copied to owned output scratch and checked against pinned Git
bytes. The driver extracts the actual CFifoStream class, out-of-line methods,
Unpack/read methods and state fields from Play d44bfa1814b729d4a3ed3c6c3a945432d5ee5bbe.
The guarded product helper supplies the candidate. Exact Vif.h/Vif.cpp hashes,
source context, fixture/helper hashes, compiler and flags are recorded in
`receipt.json`; generated source and binary stay in the output directory.

The candidate batches at least two vectors only for V4-32, CL>=WL, no mask,
mode0, nonzero CL==WL and equal in-range read/write ticks. The bound includes
remaining NUM, available payload excluding a pending DMA tag, and the end of
VU memory. Existing `Read` still refills each QW and retains its final saved
buffer. Every other path, the completion Align32, NUM0=256 and tick resets use
the original implementation. No synchronization, state layout, quality, timing
or WebGPU behavior changes.

An independent byte cursor/decoder with scalar saturating cycle counters checks
both original and candidate. Coverage includes deterministic randomized partial
streams and resumes, VU0/VU1 wrap and canaries, signed/unsigned inputs, full/partial
NUM and NUM0=256, CL/WL zero and unequal cycles, inconsistent saved ticks,
mask/mode exclusions and S32/V4-16 exclusions. Explicit actual Reset, Flush,
DMA/FIFO setup and saved-QW/position restore transitions supplement the random
split arrivals; every availability from0 through15bytes is checked with and
without pending tags and NUM1/2/256. All extracted mutable plain VIF fields
(number, FIFO bytes/index, registers, ticks, profiler zone), the entire VU
allocation and every stream member including its saved QW are checked. VPU/INTC
references and object identity are unchanged by source inspection. This is not
a whole-CVif ABI, archive-format, Wasm or full-emulator qualification.

Retained negatives reject naive pending-tag bulk counts and `Advance`, which can
leave a stale saved QW. A separate exact native NDEBUG control retains the
existing logical-DMA-end overread with a full old buffer and only one incoming
tagged QW: position0,next16,end32,tagtrue,NUM2. Both original and candidate read
RAM bytes0–15 and24–39 and finish at next48,position8. The independent oracle
keeps strict bounds for its valid-input matrix; this baseline edge is isolated
and explicitly checked without changing existing fallback semantics. All actual
reads remain inside the fixture allocation. Source guard/reversal controls reject
changed headers/stream methods, double application and damaged insertions.
Semantic mutations of ticks, tag bounds, mask and mode exclusions must also fail.

Direct destination reads require disjoint source/VU storage. In the actual core,
Ee_SubSystem.cpp30–36 creates separate live RAM, SPR and VU0/VU1 allocations;
61–62 passes VU storage through VPUINIT and RAM/SPR separately. Vpu.cpp21–25
constructs VIF from RAM/SPR and stores VPUINIT's VU pointer;171–178 returns it.
Vif.cpp979–1006 selects RAM/SPR for DMA, and the sole FIFO setup caller399 passes
CVif's inline FIFO buffer. Reset/load refill existing storage rather than rebind
these allocations (Ee_SubSystem.cpp198–204,402–406). The driver freezes these
source files in its private output for independent review.

The fixture establishes bounded native semantics only. It makes no copy-count,
whole-game performance or phone-speed claim. Native artifact locking and actual
Wasm/core startup/runtime checks remain separate release requirements.
