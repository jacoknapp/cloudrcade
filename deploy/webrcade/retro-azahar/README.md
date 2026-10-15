# Nintendo 3DS app (retro-azahar)

A webЯcade app for the Nintendo 3DS, built locally because the pinned webЯcade image has none.
It appears in the library as type `3ds` (alias of `retro-azahar`).

**Streamed 3DS ROMs require a connection to the ROM server during play.** ROMs
larger than 512 MiB stream on demand; a partially streamed file is not a complete
offline game. Runtime decryption keys are fetched separately and never cached.

**Shaders are cached as they are created.** The first encounter with a shader,
or many new shaders at once, can cause hitching, especially on mobile devices.
The cache reduces repeated work; first-time shader compilation can still pause.

## Pieces

- `patches/azahar-core.patch` — changes to the Azahar libretro core (EmulatorJS fork):
  boots `.cia` files in place, and decrypts encrypted games and encrypted CIA contents while
  reading them. Decryption keys must come from the operator BIOS mount at runtime;
  `patches/operator-keys.py` removes the upstream preset header and fallback before
  compilation and verifies that its blob is absent from the archive and WASM.
  It does not load `boot9.bin` console backups. Titles that use a seed still need
  `seeddb.bin`, which is not provided.
- `patches/app-common-3ds-type.patch` — registers the type in the app's copy of `app-common`
  and handles a denied audio-resume request without an unhandled rejection. Its local
  storage codec avoids WebKit Blob write failures (details below).
- `patches/azahar-mobile.patch` — limits the WebAssembly framebuffer reservation to native
  layouts/current geometry and prevents a mixed-LTO signature mismatch in save-directory calls.
- `patches/retroarch-mobile.patch` — bounds startup memory, stack and worker count, exports
  cleanup/audio interfaces, handles gesture-gated audio resumes and uses minimal Asyncify
  with audio blocking at the frontend loop instead of inside the core callbacks.
- `patches/retroarch-package.patch` — propagates archive failures instead of
  accepting a stale core package. Builds also remove prior archive/extraction output.
- `patches/azahar-performance.patch` — reuses decoded CPU blocks for the active process
  across scheduler/core switches. Code invalidation, process changes and a full arena
  reset the shared cache; ARM and Thumb blocks have distinct keys.
- `app/` — the app sources. `Emulator` adapts the EmulatorJS RetroArch build to webЯcade's
  `RetroAppWrapper` (module loading, input, pause, saves, save states); `lazyrom.js` streams
  games larger than 512 MiB with HTTP range requests instead of downloading them.
- `app/public/images/` — library tile and background art, drawn from the SVG sources in `art/`.
- `build.sh` — pinned-source build of core and app into `dist/` (ignored by git).

## Integration with the rest of this directory

- `../patch-player.py` adds the type to the pinned library bundle.
- `../prepare-touch.py` overlays the app's entry point (touch controller, Nextcloud saves) from
  `/opt/webrcade/touch/apps/retro-azahar/index.html`.
- `../rom-library.conf` serves the build output at `/play/app/retro-azahar/` and gives 3DS files a
  Content-Type (required by the library and by streaming).
- `../refresh-feed.py` lists bootable games from `${WEBRCADE_ROM_ROOT}/3DS` in a Nintendo 3DS category.
- `../touch/assets/controller.*` has the `3ds` touch layout.

## Runtime decryption keys

Encrypted games require an operator-provided `aes_keys.txt`, following
[Citra's external sysdata key-file convention](https://docs.libretro.com/library/citra/).
Decrypted games do not require this file. The mathematical AES key-scrambler
constant remains emulation code, as in Citra; no preset key slots are compiled in. The root CloudRcade release image includes the key-free 3DS core and app.
Custom standalone source deployments can build this app separately; neither
installation bundles runtime keys.

Use the root Compose two-mount layout (see [`.env.example`](../../../.env.example)):
put your file at `./roms/3DS/bios/aes_keys.txt` under `WEBRCADE_ROM_PATH`, then
keep these environment settings:

```dotenv
WEBRCADE_ENABLE_3DS=true
WEBRCADE_3DS_KEYS_FILE=/run/cloudrcade/3ds/aes_keys.txt
```

The ROM mount is read-only at `/roms`; startup aliases `/run/cloudrcade/3ds` to
`/roms/3DS/bios`. No separate BIOS bind mount is needed. Keep the file outside
tracked source. The path variable selects one file inside the container; no file
path is accepted from browser requests.
Missing/unreadable files disable key loading, without selecting bundled keys.
Use your own compatible file; this project does not download or distribute keys.

The same-origin `/cloud-saves/3ds-keys.php` endpoint sends the mounted file with
`no-store` headers through the existing application gateway. The emulator fetches
it before boot and places it in the browser's in-memory `Azahar/sysdata/keys.txt`,
adding the AES section marker for Citra-format files. It is not added to ROM/offline
caches or the ordinary battery-save ZIP (which includes only `sdmc`, `nand` and
`shaders`). Azahar-format `keys.txt` section headers are also accepted. Mounts,
Git ignores and Docker context exclusions keep operator files out of release
source and images. Direct static access to key filenames in the ROM share is
denied, including when this BIOS folder sits alongside the other console BIOS. Do not expose the application without your intended access
control; browser emulation needs the runtime key bytes just as it needs BIOS data.

Runtime regression checks from the repository root:

```sh
node tests/test_webrcade_3ds_systemkeys.cjs
WEBRCADE_TEST_ORIGIN=https://localhost:8443 node tests/browser_webrcade_3ds_systemkeys.cjs "Mario Kart 7"
WEBRCADE_TEST_ORIGIN=https://localhost:8443 WEBRCADE_TEST_NO_KEYS=1 node tests/browser_webrcade_3ds_systemkeys.cjs "Animal Crossing"
WEBRCADE_TEST_ORIGIN=https://localhost:8443 WEBRCADE_TEST_NO_KEYS=1 WEBRCADE_TEST_EXPECT_FAILURE=1 node tests/browser_webrcade_3ds_systemkeys.cjs "Dragon Quest VIII"
```

The browser tests require Playwright Chromium and these titles in the test feed.
They use fresh profiles, rewrite test content URLs to the selected test origin,
and disable real cloud-account interaction. They check runtime memory/files,
ordinary save ZIP exclusion and encrypted-content key errors.

## Build and deployment

The root release image already includes this app. Deploy that image with the
root [`compose.yaml`](../../../compose.yaml); the app container runs the feed
scanner and reads its configuration at runtime. The repository's
[Docker workflow](../../../.github/workflows/docker.yml) builds and verifies
images, then publishes to GHCR. It does not SSH to a deployment host.

From the repository root, prepare the app and corresponding source package with:

```sh
python3 scripts/core-cache.py prepare 3ds
# Force a source build instead of reusing a verified package:
FORCE_CORE_REBUILD=true python3 scripts/core-cache.py prepare 3ds
```

The cache wrapper checks exact source inputs and every packaged file hash before
reuse. On a cache miss it calls `scripts/prepare-core.py`, which downloads the
checksum-pinned key-free package in `core-release.json` only when its source hash
matches. Changed inputs or `FORCE_CORE_REBUILD=true` invoke `build.sh`, then
package exact patched sources and submodules. Output is `release/3ds/app/` and
`release/3ds/sources/3ds-source.tar.gz`; the root Docker build consumes both.
Set `CLOUDRCADE_CORE_WORK` to choose the disposable source-build workspace
(default `/tmp/cloudrcade-core-build`). Preparing a package replaces the existing
`release/3ds` output when reuse is unavailable or bypassed.

A source build requires Docker, Git, Python, rsync and network access. Use
Python 3.12+ for release preparation, which uses safe archive extraction with
the `tarfile` data filter (also available in patched older Python releases).
Node/npm, Emscripten and the native compiler run in build containers. Source
revisions are pinned in `build.sh`; some tool and npm dependencies resolve during
the build, so byte-for-byte reproducibility is not asserted for 3DS. For a raw app
build without the release/source package, run:

```sh
WORK=/tmp/retro-azahar-build OUT=/tmp/retro-azahar-app bash deploy/webrcade/retro-azahar/build.sh
```

Both builders own their scratch directories and reset upstream checkouts there.
The raw builder defaults to `deploy/webrcade/retro-azahar/dist/`. The loader keeps
core JS/WASM under `js/<CORE_REVISION>/`; update `CORE_REVISION` when changing the
native core. The release image packages generated controller/cloud entry points;
configuration changes require container recreation, while source/overlay changes
require a new image. Ordinary Compose deployment uses neither source bind mounts
nor `/opt/webrcade/.3ds-deploy/` host state. The older `deploy.py` remains a helper
for the former host-overlay layout; it is not called by the release workflow.

## Notes

- webЯcade only launches multi-threaded apps from `https` or `localhost` origins.
- Saves are the emulated SD card and NAND trees, stored per game through webЯcade's save manager.
- Controls follow the other Nintendo apps: the bottom face button is B, the right one is A.

Save-state thumbnails are captured on demand after a core frame and limited to
320 pixels on their longest side. The 3DS loop briefly runs for capture, restores
the menu's pause state, then serializes the state and passes the PNG to the existing
save manager. This avoids reading a discarded paused WebGL buffer and performs no
continuous screenshot readback. Existing states with missing thumbnails need to
be saved again to acquire one. Capture has a 15-second timeout so image failure
does not prevent saving progress.

Check `node tests/test_webrcade_3ds_thumbnail.cjs`; set
`WEBRCADE_TEST_THUMBNAIL=1` for the real-core browser shader-failure test to verify
decoded game pixels, persisted metadata, and pause restoration. Package-failure
injection against the actual patched upstream script is
`python3 tests/test_webrcade_3ds_package.py <WORK>/RetroArch/emulatorjs/build-emulatorjs.sh`.

## iPhone resource profile

The web core starts with 256 MiB of shared WASM memory, an 8 MiB main/default thread
stack and four preloaded workers, and allows memory growth up to 1 GiB. The native
layout reservation avoids the unused desktop 10x maximum, which otherwise made
RetroArch allocate two 256 MiB readback buffers and an 8192x8192 GPU framebuffer.
Streamed games retain at most 16 MiB of ROM chunks. Games and save identifiers are
unchanged. The loader keeps JS/worker/WASM files under `js/<CORE_REVISION>/`; bump
that value when deploying another core update. Retain older version directories
and the pre-v2 unversioned core files during production syncs so older open sessions
can still fetch their matching assets.

The touch layout has an independent left Circle Pad, right C-stick, D-pad and ZL/ZR.
The C-stick uses the second analog input and does not move the touchscreen pointer.
Touch, keyboard and controller-menu gestures resume the core's actual audio context.
After saving on exit, the app stops the core, terminates its workers and releases its
ROM cache and audio context. The library has no touch-controller pullout; gameplay
and layout editing do, while loading and native pause menus hide it.

Run `node tests/test_webrcade_lazyrom.cjs` from the CloudRcade repository root. With
Playwright Chromium and WebKit installed, run
`node tests/browser_webrcade_controller_visibility.cjs` (optional `CHROME` executable).
The latter uses disposable browser contexts and a controller lifecycle harness.
Run `node tests/browser_webrcade_3ds.cjs webkit "Ultra Moon"` against a staged
server (`WEBRCADE_TEST_ORIGIN`, default localhost:18082) for actual library launch,
audio/input, save/reload and runtime cleanup. Use `chromium` for the other engine.
`browser_webrcade_3ds_storage.cjs` checks legacy Blob reads and the byte-backed
record API; set `WEBRCADE_BUILD_ROOT` to the build script's WORK directory.
Linux WebKit engine tests do not establish physical iPhone/iOS compatibility or
full-speed emulation; validate the deployed build on the target phone.

Local ZIPs are stored as tagged byte-array records in the 3DS app's IndexedDB backend
and reconstructed as Blobs on read. Older Blob records remain readable; game/save
keys and uploaded Nextcloud ZIPs are unchanged. This avoids WebKit's “Error preparing
Blob/File data” write failure. When rolling back the core, retain this app-common
storage codec so the app can read saves written after this update; reverting the
entire old app can leave those records unreadable until the updated app is restored.

## 3DS performance and pacing

The WASM core has no Dynarmic CPU recompiler. Native 1x resolution and the original
3DS model remain the defaults; game CPU timing is unchanged at 100%. The interpreter
now retains decoded blocks across thread switches within the same process, sharing
the existing bounded 125 MiB translation arena across emulated CPU cores. It clears
all block offsets together on code invalidation, process changes or arena rollover.
This relies on the core's single-threaded CPU scheduler; filesystem workers do not
execute guest CPU instructions.

Minimal Asyncify keeps yielding in the RetroArch frontend/audio loop and avoids
instrumenting the interpreter's indirect calls. Once audio is running, the frontend
uses audio pacing instead of waiting for a second browser animation frame after
each slow emulation frame. Suspended audio restores animation-frame pacing so a
locked audio context cannot cause the game to run unthrottled. Exit removes the
audio timing listener before closing the context.

Run `WEBRCADE_BUILD_ROOT=<WORK> node tests/test_webrcade_3ds_cache.cjs` to test the
actual cache header (requires `c++`). The native lifecycle test checks audio
suspend/resume pacing, ordinary saves and worker cleanup. Its optional diagnostic
`WEBRCADE_TEST_SAVE_STATES=1` exercises save-state restore. The historical Ultra
Moon state-creation failure is covered by the v18 ownership/memory fixes and the
real-core shader-failure test's compressed-state creation and reload checks.
Regular in-game saves and their local ZIP persistence are checked separately.

For a repeatable measurement using fresh browser contexts:

```sh
WEBRCADE_TEST_OUTPUT=/tmp/3ds-perf node tests/benchmark_webrcade_3ds.cjs webkit sample 30
```

Set `WEBRCADE_TEST_ORIGIN` for the server and `WEBRCADE_TEST_TITLE` for another title.
Chromium accepts `CHROME` and `WEBRCADE_CPU_PROFILE=1` to write a CPU profile.
`WEBRCADE_NO_VSYNC=1` is a diagnostic override for comparing older cores. Results
report frontend loop rate, synchronous ROM-read time, memory and audio state; a
game's actual render FPS can differ. Compare the same scene/engine/hardware with
audio running, and avoid competing builds during measurement. Headless software
GL and Linux WebKit results do not establish playable speed on a physical iPhone.

## Text entry and current phone limitations

The Azahar frontend requires synchronous text input with minimal Asyncify. The
3DS app uses a native browser prompt, which opens the phone keyboard, and enforces
the game's UTF-16 length limit. The RetroArch bridge returns synchronous strings
or cancellation without unwinding the CPU/HLE callbacks; other frontends can still
use its existing Promise path. The prior always-null app callback prevented usable
text entry and could take that unsupported asynchronous path.

`WEBRCADE_BUILD_ROOT=<WORK> node tests/test_webrcade_3ds_keyboard.cjs` tests the
actual bridge and app prompt contracts. `node tests/browser_webrcade_3ds_keyboard.cjs
webkit` tests the compiled WASM import, real browser dialog, returned text/cancel
and continued frames in a disposable profile; Chromium is also supported.

## Offline shader inventory

`shader-inventory.py` regenerates a JSON list from an existing `programs.bin`, or
scans native shader definitions in Ultra Moon's Pokémon model archive. It uses
Python 3's standard library and reads the input without modifying it:

```sh
python3 shader-inventory.py --cache /private/programs.bin --output /private/cache-list.json
python3 shader-inventory.py --cia /private/UltraMoon.cia --output /private/model-shaders.json
```

`--cia` also accepts a URL whose server supports HTTP byte ranges. This mode
requires decrypted NCCH content. Its defaults select `/a/0/9/4` members
`1 + 9*n`; these are Ultra Moon model packages, not a general all-game scanner.
`--archive`, `--first`, and `--stride` make the selected scope explicit. The
scanner validates each selected model, hashes native shader command streams,
lists empty model placeholders, reports unsupported entries/errors, and exits
with status 2 for incomplete scans. It handles UTF-8 and Japanese CP932 names;
`--workers` controls parallel decompression processes (default 4, maximum 16).
No shader code, ROM contents, saves, or credentials are written into the report.

The ROM report is a discovery inventory, **not a loadable WebGL cache**. Native
command streams include uniforms and other state, so their distinct hashes are
not a count of unique generated GLSL programs. Runtime PICA state, material and
lighting settings, and the renderer capability profile are also needed to
generate the port's exact shaders. Cache mode lists already observed program
pairings and checks that their sources exist; it cannot discover unseen draws.

Existing cloud shader sync is per account/game/graphics-driver tag. Sharing a
source cache across different driver tags needs compatibility validation or a
portable capture of raw PICA shader/configuration inputs. The current WRCP1 cache
stores generated GLSL and pairings, not those raw inputs or compiled GPU binaries.

Format references: [SPICA shader reader](https://github.com/gdkchan/SPICA/blob/master/SPICA/Formats/GFL2/Shader/GFShader.cs),
[SPICA model packages](https://github.com/gdkchan/SPICA/blob/master/SPICA.WinForms/Formats/GFPkmnModel.cs),
and [pk3DS GARC reader](https://github.com/kwsch/pk3DS/blob/master/pk3DS.Core/CTR/GARC.cs).

## GPU vertex shaders

`patches/azahar-native-vertex.patch` enables Azahar's generated vertex shaders in
the browser build. `patches/azahar-webgl-lit-gpu.patch` also keeps lit draws on
the GPU by adjusting the lighting path for WebGL2. Draws requiring a PICA
geometry shader stay on the CPU; failed GPU programs can fall back as described
below. **Settings → Core Settings → 3DS lighting on CPU (slower)** restores CPU
processing for lit draws for device comparisons. Indices are rebased because
WebGL2 has no base-vertex draws. `Module.nativeVertexStats` counts draws by path
(`gpu`, `lit`, `geometry`, `failed`).

`patches/azahar-webgl-formats.patch` reinterprets D24S8 as RGBA8 and RGBA4 as RGB5A1 with
WebGL2-compatible passes (`webgl_formats.h`; WebGL2 cannot sample stencil), checked by
`tests/browser_webrcade_webgl_formats.cjs` through the exported `_wrc_webgl_formats_test`.
An optional WebGPU vertex-compute variant existed until 2026-10-07; it was removed after
phone measurements showed vertex work was never the limit (history: docker-ext 26adb84..f0c6170).

## Library entry

`../patch-player.py` registers the `3ds` type in the pinned library like any other system.
It was opt-in behind an Experimental Settings switch until 2026-10-07, while it ran at a few
frames per second on phones (see WebGL stream buffers below).

## WebGL stream buffers (`patches/azahar-webgl-stream.patch`)

Measured on an iPhone with the readout below: emulating a frame took 2–5 ms of page code, yet
the game ran at 4 fps, because each draw call cost about 7 ms in Safari's GPU process. The core
updates part of a 16 MiB vertex and an 8 MiB uniform stream buffer before every draw; Safari's
Metal backend replaces the whole buffer each time. The patch gives the WebGL build 256 KiB
vertex and 64 KiB index/uniform stream buffers (they grow when one request needs more) and
fresh storage on wrap. Desktop browsers do not show the cost, so it cannot be reproduced on
the build host.

## Shader failure handling and reports

Core v18 rejects programs that fail to link and retries affected GPU vertex draws
with CPU-transformed vertices. Successful programs keep their GPU path. Rejected
pairs are remembered for the session, including state loads, so they do not trigger
another link attempt every frame. Both background and synchronous linking check
the result. Shader text and the per-game cache stamp are unchanged.

The readout shows `failed N` (up to eight stored failures). Driver program/shader
logs are retained in `Module.wrcShaderFailures`, and the rendering check at
`diag.html` includes them even though rejected programs are never used. A fragment
shader failure cannot be repaired by CPU vertex processing; this fallback covers
vertex compilation and program-pair failures where the CPU vertex program links.
Physical iPhone confirmation of the red Cosmog fix is still required.

Run `WEBRCADE_TEST_STATE=<scene.state> node tests/browser_webrcade_3ds_shader_failure.cjs
webkit` from the repository against staging. It forces real PICA vertex compile
errors and verifies CPU fallback, no use of failed programs, stable linking across
frames and state loads, and pause/resume. `WEBRCADE_TEST_REJECT_SHADERS=0` checks
the normal GPU path; `WEBRCADE_TEST_SYNC_SHADERS=1` disables background linking.
`WEBRCADE_TEST_CORE_DIR` can select a previous core to verify the regression.
The scene state is read-only and cloud interaction is disabled in the test profile.

Compiler reports persist under `/wrc/3ds-shader-failures/<game-id>` in browser
storage and sync to `${NEXTCLOUD_SAVE_FOLDER}/wrc/retro-azahar/<game-id>/shader-failures.zip`
through the existing cloud-save account. The ZIP contains `shader-failures.json`:
core, game title, GPU/browser, compiler logs, shader sources, first/last occurrence,
and per-session counts. Identical reports merge by SHA-256; retention is bounded
to 32 reports, 16 sessions per report, and 2 MiB. Sources over 256 KiB are explicitly
marked as truncated. Local persistence comes first; cloud failures retry on
pause, exit, or a subsequent run without suppressing ordinary save error messages.
Capture happens only on failed linking and adds no ordinary draw-time hooks.

The same revision eliminates duplicate prewarm shader compilation, preserves
synchronous programs across state loads, and retries unchanged shader caches
after failed uploads. Save metadata is heap-owned and snapshot creation runs once
instead of twice. Temporary state-buffer and shader-string allocations are reduced.
The build cleans its patch-created header so repeated builds apply cleanly.

Regression checks from the repository root:

```sh
node tests/test_webrcade_3ds_shader_failures.cjs
node tests/test_webrcade_3ds_shader_retry.cjs
node tests/test_webrcade_3ds_shader_cache.cjs
node tests/test_webrcade_3ds_state_info.cjs <patched-RetroArch>/tasks/task_save.c
```

The native state API check needs a C compiler with AddressSanitizer/UBSan.
Browser checks require Playwright, a staged feed/app, and `WEBRCADE_TEST_ORIGIN`
(default `http://localhost:18084`). They also check local report persistence and
real compressed state creation. Headless results establish correctness, not phone speed.

## Performance readout

`../patch-player.py` adds a **Core Settings** page to the library's Settings
dialog. Its **3DS performance readout** switch (`wrcad.3ds.perf.v1`) makes the
app draw a once-a-second readout over the game (`app/src/emulator/perf.js`), read at launch:

| Line | Meaning |
|---|---|
| `3DS 23.4 fps 39%  <core>` | emulated frames per second, share of full speed, core revision |
| `frame 38 ms  worst 71  busy 92%` | main-loop time per emulated frame, slowest iteration, share of the second spent in the loop |
| `draws 412  gpu 380 cpu 32` | draw calls per frame; vertex batches run as GPU shaders or on the CPU (0/0 on cores without the native vertex patch) |
| `readback` / `upload` / `shader` | calls per frame and time in graphics calls that can block: pixel readback and sync, texture and buffer uploads, shader compiles |
| `timers N/s  asked X  ran Y ms` | `setTimeout` calls per second, delay requested, time spent in their callbacks (the core sleeps through timers and resumes work inside them) |
| `raf N/s  ran Y ms  late Z ms` | animation-frame callbacks and their run time; `late` = how far a steady 50 ms timer slipped, i.e. time the page was blocked |
| `queue X ms  drift Y  44100 Hz  lat 64` | audio queued ahead of the core's pacing clock, that clock minus the audio context's own, sample rate, configured latency |
| `loops N/s` (second line) | main-loop iterations per second |
| `Target.message 8/s 37 ms` etc. | the three event handlers taking the most time, by target and event type |
| `gl 1179x1415  sent 0.11 MB/f` | drawing buffer size (`aa` antialiased, `keep` preserved), megabytes handed to upload calls per frame |
| `gpu draw 6 ms  worst 4 @WxH screen  upl 5  end 0` and indented rows | one frame every two seconds waits (`getError`, which must answer; `finish` does not wait in Safari) after each call; rows list the costliest call kinds (`Arrays m4 x90 652 ms` = `drawArrays`, mode 4, 90 calls): total wait after draws, slowest draw with its viewport (`screen` = final blit), after uploads, at frame end |
| `heap 602 MB  audio running` | WASM memory, audio clock state |

Busy near 100% with a long frame time means emulation itself is the limit; a large
`readback`/`upload`/`shader` time means graphics calls are; low busy with low fps means the
frames wait on pacing (audio or the browser).

Since v18, the readout defaults to passive timing. Deliberately blocking GPU
cost probes require `wrcad.3ds.perf.gpu-probes.v1=1` in local storage before
launch, in addition to the readout switch; otherwise it shows `gpu cost probes off`.
