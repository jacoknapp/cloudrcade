# VU computed-result forwarding

Run `python3 tests/test_webrcade_ps2_vu_forward.py --play /baseline/Play --output /tmp/owned-output`.
The retained baseline Play build supplies read-only CodeGen and Framework libraries.
Docker uses the pinned Emscripten SDK without network; Node executes generated
Wasm. Only VUShared, CMipsJitter, FpUtils, the MakeSz emitter object and a tiny
fixture compile. No full Play build, browser, game/state bytes or GPU are used.

Both variants contain the separately frozen MakeSz sign-byte optimization. The
candidate adds only the checked computed-result forwarding patch. The fixture
invokes14 actual VUShared emitters, then actual CMipsJitter and CodeGen. It covers
all16 lane masks; destination/source aliases, VF0 reads, fd0 scratch results and
same-source subtraction; clamping and skipped-MAC hints; one/three-operation
blocks and wrapping flag pipelines. Raw IEEE/NaN/random inputs compare every
byte of CMIPS plus128 surrounding canary bytes. A separate exact sign/zero
combination sweep independently checks MAC and sticky flags.

Unchanged scalar/immediate/move/dest0 paths must emit identical Wasm. Actual
full and partial MUL modules must remove two vector reloads, retain every
vector/flag store, and keep the guest vector store before flag-pipeline stores.
The patch must reject a second application. Output includes generated modules,
WAT and aggregate result.json. Timing is a synthetic tiering diagnostic, not a
game speed claim; default-tier and optimized engines can behave differently.
