# Optional raw handoff diagnostic fixtures

Run from the repository with host C++17, Node and Python:

```
python3 tests/test_webrcade_ps2_handoff.py --play /path/to/pinned/Play --output /tmp/owned-handoff-proof
```

The driver reads pristine pinned mailbox/CMake source through Git, applies the
actual product patch in owned output, and compiles only the mailbox fixture.
It performs no whole-core/SDK build, browser/device run or source-tree mutation.
Macro-off source and objects match baseline; compiled-in runtime-off reads no
clocks. Enabled/toggled traces retain the actual FIFO/function/promise behavior.
Concurrent publication, fixed-capacity drops and epoch changes exercise the
append-only recorder without resetting live writers. The JS fixture imports
actual host adapters, checks all11 operation/readback/state/ACK cases against
5833, traps disabled clock reads and verifies detached snapshots, epoch filtering
and contained diagnostic-clock failures. No results-analysis campaign is run.

The standing requirement is “Don’t remove the synchronization.” These fixtures
do not authorize or implement early ACKs, omitted/reordered fences, mailbox waits
or completion guarantees. Actual Emscripten and browser/device correctness remain
separate release qualification steps.
