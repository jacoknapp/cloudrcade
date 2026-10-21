# Experimental Wii core

Wii reuses the current GameCube Dolphin improvements, all its native patches, device WebGPU
renderer, bounded disc streaming, lifecycle/audio recovery, standard pause menu
and save slots. A separate native build adds one emulated Wii Remote + Nunchuk.
The GameCube package and its save compatibility remain unchanged.
Wii retains its32768 executable-instance budget and128MiB callback arena.
It shares safe cold-function retirement at cache pressure; GameCube uses separate,
smaller budgets. Save namespaces and formats are unchanged.

Enable **Wii (experimental)** in library Settings → Core Settings. The separate
**Wii performance readout (experimental)** switch uses the same metrics and
placement as GameCube. Both default off and follow OK/Cancel. The direct lab is
`/experimental/wii/`; it accepts Wii ISO, single-file WBFS and Wii CISO files
and range-capable HTTP URLs. The scanner recognizes these containers in `Wii/`
(case insensitive) and managed platform 5 games. Dolphin reads the original
containers directly with bounded streaming, without conversion or a second copy.
WBFS must contain one game in its first slot and include all its data in one file;
split WBFS parts are rejected rather than listed as complete games. Wii CISO is
distinct from PSP CSO. RVZ, WAD, multiple Remotes and MotionPlus roll are not implemented.

The Wii native build also gives the Wasm PPC JIT and its C++ fast helpers a direct
path to MEM2 (EXRAM). Accesses through the cached `0x9xxxxxxx` window skip the MMU
helper when the live DBATs map it onto EXRAM. The JIT proves the mapped prefix when
it compiles each block; DBAT changes flush the JIT. The uncached `0xDxxxxxxx` window,
real mode and unmapped pages keep the helper. The helper stats report the window as
`mem2win`. `RunPpcWasmMem2Smoke` checks every load/store family against fake MEM1
and EXRAM. GameCube native bytes are unchanged.

Wii also shares the grouped MEM1 transfers described in the GameCube README.
MEM2 misses that shared proof and retains its existing checked direct/helper
path. Its native smoke compares grouped and individual integer/float transfers
in both banks, including raw float lanes, register caching and the untouched bank.

Wii has its own category, controller profile and independently saved layouts.
The controller drawer also offers **Frame skip**: **Off** (default), **2×**,
**3×** or **4×**, rendering every second, third or fourth native GX frame.
The shared native graphics path omits texture/pipeline/upload/draw work and bulk
vertex conversion; CPU emulation, GX state and audio continue. GPU-only EFB copies
retain their last complete image. Graphics readback dependent games may need Off. This browser stores the choice separately from GameCube.
The Remote/Nunchuk layout follows the shared screen/dock placement and editor behavior, with Wii button geometry:
A/B, 1/2, C/Z, Plus/Minus and Home. Its left stick controls the Nunchuk.
Touch the video or move the desktop mouse to point; tap/click is A and right
click is B. Position supplies tilt and quick drags supply swing/shake acceleration.
Pointer coordinates use the visible game rectangle. Touch cancellation, pause,
menus, backgrounding and exit release motion/buttons. The controller panel offers Remote + Nunchuk, upright Remote and sideways Remote. Sideways rotates D-pad and motion axes and disconnects the Nunchuk. Phone motion is opt-in: tap Enable phone motion to request accelerometer/gyroscope access, then Recenter phone to set a comfortable neutral position. Sensor axes follow portrait/landscape screen orientation; denied or unavailable sensors leave touch/mouse controls available. Dragging also supplies simulated MotionPlus pitch/yaw. Games needing richer gestures or roll need further
input work; see their requirements before assuming compatibility.

Wii saves live under a separate `wii/<game ID>/` namespace. Standard save feedback,
account-scoped local/cloud storage and state slots reuse GameCube's implementation.
Only NAND title `data/` files are synchronized, with path validation and a 64 MiB
limit. Titles/content/tickets/console keys are never included in save archives.

## Run locally

After preparing Wii, run `python3 scripts/run-wii-beta.py`. It leaves an isolated
container at `https://localhost:18573/play/` and the Wii disc launcher at
`https://localhost:18573/experimental/wii/`. Development HTTPS uses a local
certificate. Enable Wii in Settings → Core Settings, then select your Wii disc
in the launcher. State lives under ignored `release/wii-local/`; the helper
mounts its empty ROM folder read-only and disables automatic scanning and cloud accounts.
For the separate Wii library category, put games in `release/wii-local/roms/Wii/`
and run `docker exec cloudrcade-wii-beta python3 /usr/local/share/cloudrcade/service.py scan`,
then refresh the library. Your independently saved Wii touch layout follows your
account's controller sync settings when cloud storage is enabled on a normal server.

## Reproduce

Prepare the current qualified GameCube package first, then run:

```sh
python3 deploy/webrcade/retro-wii/build-native.py
python3 deploy/webrcade/retro-wii/prepare.py
```

`WII_WORK` must be a new dedicated directory; `WII_TOOLCHAIN` holds the pinned SDK
Rust compiler/cache. Use a filesystem with enough space for a Dolphin source build.
`OUT` can override each stage's new output directory. `GAMECUBE_APP` selects a
verified current GameCube package. `WII_NATIVE_CACHE` reuses only exact locked
native hashes. An intentional native change requires a fresh `--qualify` build,
review of the resulting source/artifact lock and native/browser regression checks.
The Wii savestate namespace (`stateFormatId`) is kept across native rebuilds that leave
Dolphin's serialization unchanged, so existing Wii states stay loadable. Set
`WII_STATE_FORMAT_CHANGED=1` for `--qualify` when a change alters the saved state format.

The Wii source archive contains fully patched Dolphin/source, the complete
GameCube recipe/locks, and the additional `cloudrcade-wii` patch/lock. To rebuild
that extracted archive directly, use the exact SDK image in native-build.json,
mount it at `/work`, empty compiler/cache scratch at `/toolchain`, and
`cloudrcade-native` at `/recipe`, then run `bash /recipe/build-linux.sh`.
The Wii input report probe is opt-in and accepts only stopped/paused sessions.
It calls Dolphin's actual Wii Remote report builder without per-frame overhead.

### Compiled-block chaining

Full compiled blocks run consecutively in a direct dispatch loop, including
reentry after an interpreted or partial block. Each block still commits its PC,
cycle budget, performance counters and CLOCK reference. Epoch and CPU-feature
guards precede every reuse of callback metadata; cache misses return through the
existing code-generation boundary. Partial blocks, helper halts, stepping,
debugging and profiling retain their existing handling. No cache allocation or
save format changes. This path is enabled by default; debug disable-mask bit29
selects the legacy loop. The actual-WASM fast-path regression checks cycle
budgets, register commits, stop/feature/epoch changes, helper halts and fallback
entries in Chromium and WebKit.
