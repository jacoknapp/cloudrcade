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

Games run on the browser device using WebGL2, WASM JIT and eight preallocated
pthread workers. HTTPS/localhost, cross-origin isolation and SharedArrayBuffer
are required. The initial WASM heap is256MiB and can grow. The native renderer
commits each completed browser back buffer; WebGL palette indices select the
red/alpha channel in shaders because WebGL2 has no texture swizzle parameter.
PS2 emulation is experimental: compatibility, rendering and speed vary by
device and game. A homebrew test passing does not establish commercial-game
compatibility or physical-phone performance.

Remote ISO/CHD discs use exact2MiB HTTP206 ranges and an eight-entry16MiB LRU
cache, including discs over4GiB. ETag/Last-Modified validators detect disc
changes when supplied by the server. Full200 responses, short/oversized ranges
and unexpected Content-Range values fail before native reads continue. Local
Files are read in slices. ELF executables have a128MiB limit. Remote discs
require connectivity throughout play; partial cached bytes are not an offline
download. No ROM is copied into MEMFS for disc launches.

Keyboard, two standard gamepads and touch input support both analog sticks,
the D-pad, Sony face buttons, L1/R1/L2/R2/L3/R3, Select, Start and Menu. PS2 keeps
its own saved touch-layout key. Mobile portrait reserves the default controller
area below the picture; moved controls do not reposition it. Landscape and
controls-off use the available safe viewport. Native rendering stays640×480.

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

Beta builds publish `beta-ps2-core` for `linux/amd64` only. Main's architecture
policy remains independent. This source directory contains no games, BIOS,
keys, accounts or operator settings.
