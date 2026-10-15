# Experimental PlayStation 2 core

On the PS2 beta, open **Settings → Experimental Settings**, turn on **Enable
PlayStation 2 (experimental)** and press **OK**. The separate **PS2 performance
readout** switch shows rendered FPS, emulation speed and WASM heap usage. Both
switches default off, persist per browser/storage namespace, and honor Cancel.
There is no Docker enable flag. Disabling PS2 hides its library entries and
blocks direct launches while retaining its saves and control layouts.

The scanner reads ISO, CHD v5 and homebrew ELF files recursively under `PS2/`
or `ps2/` on the ROM share, including `roms/` subdirectories. Existing game files
stay in place. Shared managed-folder ISO detection requires a PS2 `BOOT2`
entry in SYSTEM.CNF; ambiguous CHDs require explicit platform metadata. BIOS
files are excluded. Play! uses its built-in HLE BIOS and does not load external
console BIOS dumps. Game and save identities are separate from PSX and PSP.

Games run on the browser device using WebGPU compute shaders, Play!'s WASM JIT
and eight preallocated workers. The pinned MIT ps2-web-recomp GS renderer handles
rasterization, textures, depth, blending, swizzled VRAM and presentation; its
game-specific CPU recompilers are not used. The separate graphics module uses
pinned Dawn WebGPU bindings and has no WebGL or software-adapter fallback.
Save states include GS registers, VRAM, the palette and partial image transfers.
HTTPS/localhost, cross-origin isolation and SharedArrayBuffer are required.
The CPU module initially reserves256MiB and graphics module64MiB; both can grow.
Compatibility, rendering and speed remain experimental. Homebrew tests do not
establish commercial compatibility or physical-phone performance.

Remote ISO/CHD discs use exact2MiB HTTP206 ranges and an eight-entry16MiB LRU
cache, including discs over4GiB. ETag/Last-Modified validators detect disc
changes when supplied by the server. Full200 responses, short/oversized ranges
and unexpected Content-Range values fail before native reads continue. Local
Files are read in slices. ELF executables have a128MiB limit. Remote discs
require connectivity throughout play; partial cached bytes are not an offline
download. No ROM is copied into MEMFS for disc launches.

Consecutive sector reads start two chunks of read-ahead, overlapping downloads
with emulation instead of waiting at every2MiB boundary. Pending buffers share
the same16MiB cache budget; demand joins a pending download. Seeks cancel
unrelated speculation, isolated metadata reads do not trigger it, and failed
read-ahead is retried on demand with the same strict response validation.
Transient transport failures retry once within the original request timeout;
cancelled requests and invalid or changed disc responses still fail closed.

Keyboard, two standard gamepads and touch input support both analog sticks,
the D-pad, Sony face buttons, L1/R1/L2/R2/L3/R3, Select, Start and Menu. PS2 keeps
its own saved touch-layout key. Mobile portrait reserves the default controller
area below the picture; moved controls do not reposition it. Landscape and
controls-off use the available safe viewport. Native rendering stays640×480.

GPU acknowledgments reuse their shared heap view and refresh it after memory
growth. Cached disc sectors copy directly into the current native heap;
unchanged controller values and viewport geometry skip repeated native calls
and layout measurements. These savings preserve guest timing, rendering cadence
and resolution; they do not guarantee full speed.

Menu and Escape open CloudRcade's shared native pause/save-slot screen. Memory
cards sync on Menu, background and exit, with local recovery, account/provider
isolation, change detection and retry after a failed cloud upload. There is no
periodic card upload during play. Eight save-state slots use a versioned format
namespace, local backup and the existing cloud bridge. Save/load operations
wait for native acknowledgments and keep the native menu open on failure.
Background return resumes only a session paused by that transition. Exit
acknowledges pause and saves before terminating workers, disc reads and audio.

## Build and verification

```sh
python3 deploy/webrcade/retro-play/prepare.py
node tests/test_webrcade_ps2.cjs
node tests/test_webrcade_ps2_stream.cjs
python3 tests/fixtures/ps2_homebrew.py /tmp/ps2-homebrew
```

The builder requires Docker, Git, Node22+, npm and Python3.10+. `WORK` is owned
disposable scratch; `OUT` must be a new directory (default `release/ps2`).
`PS2_BUILD_JOBS` defaults to4. Pinned Play!/submodule revisions, Emscripten SDK
digest, CMake/Ninja versions and save SDK are recorded in the recipe and
`core.json`. Exact patched sources and build instructions ship as
`/licenses/sources/ps2-source.tar.gz`; `core-info.json` records source and native
artifact SHA256 hashes. `native-build.json` separately locks both native
artifacts and their exact native inputs. An independent CI source build must
reproduce those bytes; a mismatch stops packaging. When changing native inputs,
review the builder's reported new hashes and native qualification before updating
that lock. WORK is locked against concurrent builders. The qualified whole-core cache is verified byte for
byte. `FORCE_CORE_REBUILD=true` bypasses native/package reuse.

`tests/browser_webrcade_ps2_settings.cjs` verifies the actual native Settings
tab and library gates in Chromium/WebKit. `tests/browser_webrcade_ps2.cjs`
requires `PS2_TEST_ROM` on a disposable test instance; generated original
homebrew ELF/ISO fixtures exercise actual rendering and lifecycle without
copyrighted games or BIOS. Use persistent isolated WebKit profiles for its
Blob-backed IndexedDB saves. No operator accounts or saves are needed.
`tests/browser_webrcade_ps2_launch.cjs` follows the actual library, details,
Play and return flow, including portrait/landscape frames extending60px beyond
the visible parent window. PS2 picture sizing intersects that visible window;
the default portrait controller reservation stays independent of moved controls.

Beta builds publish `beta-ps2-core` for `linux/amd64` only. Main's architecture
policy remains independent. This source directory contains no games, BIOS,
keys, accounts or operator settings.

The GS worker batches ordered register and image commands into bounded 4MiB
packets, with each display last. Capacity pressure, VRAM readback and state saves
drain pending commands; reset/load discard them before restoring graphics. Large
individual transfers retain the direct protocol. GPU completion is still awaited
for every display, and the worker uses shared-memory notification while waiting.
Guest timing, rendering resolution, WebGPU compute and state format are preserved.

When the experimental performance readout is enabled, its overlay shows last,
average and p95 presentation intervals, GPU command submission CPU time, GPU
completion/readback wait, disc service time, input/layout work and bridge queue
delay/call rate. Stage values are one-second averages per completed rendered
frame and can overlap across threads; they are not additive or a measurement of
native emulation CPU/device GPU execution time. The pause menu's performance
details explain the counters. Timing clocks are inactive with the readout off;
pause/resume/state changes discard old samples and bounded interval storage
avoids growing memory during play. Native binaries and guest timing are unchanged.
