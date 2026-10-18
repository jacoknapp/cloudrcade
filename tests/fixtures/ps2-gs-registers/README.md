# Native GS register ownership fixture

Run from the repository root:

```sh
python3 tests/test_webrcade_ps2_gs_registers.py --play /path/to/pinned/Play --output /tmp/ps2-gs-registers
```

Requires Git, Python 3 and g++. It reads original files using `git show` at the
pinned Play revision, verifies the Framework submodule revision, applies the
actual `patch-gs-registers.py` helper in disposable output, and compiles baseline
and candidate host executables. No emulator/Wasm/GPU build, network, game, save,
browser or production service is used. Output contains only source and host
test artifacts. The supplied Play checkout is read only.
Pass `--sanitize` for an ASan/UBSan host run.

The real `CMailBox.cpp` and complete relevant GS method bodies compile verbatim,
including producer writes, event scanning, register submission, transfer/readback
boundaries, two-frame ownership, save/load/copy/flip/reset and worker dispatch.
The test class supplies their field/type declarations and observation backends;
archive transport stores named memory/register records without ZIP compression.
This checks native ownership and operation order, not raster pixels, ZIP I/O,
the full VM, the WebGPU state archive or browser scheduling. A full native build
and actual-core state/gameplay qualification remain separate requirements.

The baseline must reproduce missing saved/copied/forced-flip tails, stale tails
after load, and already-queued callbacks overwriting restored/reset register
state. Candidate must remove them. The blocked-worker controls wait for an
actual queued promise under the actual mailbox mutex before releasing the
worker, so sleeps do not decide their ordering. The remaining checks cover
immediate SIGNAL/FINISH/LABEL behavior, image/read ordering, idle/no-flip vblank,
buffer rotation, threshold edges and complete ordered register streams. An
actual blocked-worker queue inventory counts register jobs for 4,096 writes;
reduced job count alone is not performance evidence.

Source contracts restrict edits to five lifecycle methods and the optional
256→1,024 register threshold. Event processing, transfer/readback methods,
frame limiting, buffer rotation and the complete remainder of the pinned GS
implementation must remain byte-identical.
