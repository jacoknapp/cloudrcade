# Experimental GameCube

The beta image adds Nintendo GameCube to the CloudRcade library. Valid ISO/GCM
files under the GameCube content directory launch Dolphin in the browser, using
the device GPU through WebGPU. Keyboard, standard gamepad and touch controls,
acknowledged pause/resume, Web Audio, memory cards and eight save-state slots are
included. Menu and Escape open CloudRcade's shared native pause screen and save
slot editor, with the same keyboard and gamepad navigation as the other cores.
Return to Browse saves memory cards before leaving. The controller settings
drawer handles only touch controls, mute and layout editing. GameCube has its
own default button and stick geometry; saved per-system layouts remain usable.
The first Menu or drawer gesture unlocks browser audio; master mute still applies.
Memory cards autosave every15seconds, on pause and when returning to the library;
unchanged cards skip storage writes, and failed cloud sync remains retryable.
The built-in
GameCube performance readout is enabled by default; switch it off or on in the
library's Experimental Settings before launching. It samples native frame and
emulated-time counters once per second, reports core fps and speed independently
of a game's frame-rate target, and shows device WebGPU resolution and WASM memory.
It resets after pause/resume or loading states and adds no GPU timing probes.
Local and connected Nextcloud saves use the existing CloudRcade account isolation,
conflict handling and offline recovery bridge. States are scoped to the exact
core binary version. Game compatibility and mobile memory support are experimental.

PSP remains available without a beta flag. The beta publishes AMD64 images only.
The standard `web` Docker target excludes GameCube; beta uses `web-gamecube`.
GameCube availability follows the packaged core, with no global renderer/read
change. Its disc URL threshold is50,000,000bytes. Larger games stream through
strict HTTP206 requests with strong ETag/Last-Modified and If-Range validation.
The existing LazyRom disk reader retains2MiB chunks, eight-entry LRU and16MiB
cache. A helper worker adds one2MiB shared transfer buffer. Full-file200 responses
are rejected before reading the body. Local Files use WORKERFS at every size.
Compressed RVZ and Wii discs are unsupported. Header inspection alone never
counts as a boot: Dolphin must accept the disc and reach its Running state.

Browsers require HTTPS or localhost, shared-memory isolation, OffscreenCanvas
and hardware WebGPU. Software adapters and CPU rasterizer fallback are rejected.
Rendering runs entirely on the browser device. CPU emulation uses Dolphin's
cached interpreter with its guarded PPC-to-WASM acceleration and separate CPU
thread. Native WebGPU uses packed geometry, mapped uploads and the replay pump;
heavy diagnostic GPU probes remain off. These choices apply only to GameCube.
No server GPU dependency exists.
Compiled PPC callbacks use the native direct dispatch and inline wrapper while
retaining block accounting, timing, invalidation and halt checks.

Backgrounding suspends GameCube without opening the pause menu. Returning resumes
only a session paused by the background transition; intentional menu/layout pauses
stay paused. Worker pause/start commands are serialized, and persisted page
restores retain the session. CPU resume does not depend on restarting browser audio.
The native binary reserves1GiB of initial WASM memory; small devices may lack
sufficient memory. Performance depends on browser, device and game.

The renderer translates generated GX shaders through GLSL, SPIR-V and Naga to
WGSL. Texture decoding remains on the CPU. Integer texture bindings and generic
GPU-to-CPU texture readback still have incomplete paths; this is not a claim that
every GameCube effect translates correctly. The native texture destructor now
releases its browser GPU texture, and replaced texture bind groups retire after
the owning render pass publishes. Physical resource destruction follows GPU
submission. Slow scenes keep guarded JIT acceleration while native frames advance;
five seconds without progress still trips the JIT fuse. Byte-identical compiled
functions with identical helper imports reuse their worker-local handles. The
instance cache caps at32768; new blocks beyond that budget stay interpreted,
without deleting or overwriting existing compiled handles. Only the unused legacy
CPU notification image is reduced; the native GPU render resolution is unchanged.
Fatal worker/WASM/GPU errors and sixty seconds without frame progress stop the
session and offer restart or return to the library.

The core uses [wasm-dolphin](https://github.com/dougchansan/wasm-dolphin) at the
exact base commit in `core.json`, with independently verified upstream artifacts. Preparation
reconstructs and verifies Dolphin's pinned source and66patches, then applies our
locked native patches and builds using the AMD64 Linux SDK digest and Rust
nightly in `native-build.json`. The native source tree, build recipe, patches and
resulting JavaScript/WASM are independently SHA256-locked. CI rebuilds them from
source and rejects differences. The corresponding source includes both patch
series and the Linux recipe; the modified host and save SDK source ship separately. The
save SDK uses pinned webRcade common9a7cf19 and locked npm dependencies. Dolphin's
Apache-licensed replacement GameCube fonts and license ship with the core.
The shared native heap is fixed at768MiB, with matching generated PPC module
imports and memory growth disabled. Performance details sample native allocator
usage and heap extent every5seconds; browser and GPU allocations are separate.
`stateFormatId` preserves the previous verified save-state namespace when a native
rebuild leaves Dolphin serialization compatible. Change it when the serialized
format changes; artifact integrity always uses the current JS/WASM hashes.
No games, BIOS dumps, keys, accounts or operator settings are packaged.
The binary is a CloudRcade Linux source build. Broader device/game qualification
remains a promotion requirement.

```sh
python3 deploy/webrcade/retro-dolphin/prepare.py
python3 deploy/webrcade/retro-dolphin/serve.py
node tests/test_webrcade_gamecube.cjs
NODE_PATH=<Playwright modules> node tests/browser_webrcade_gamecube.cjs
```

Preparation requires Git, Node22+, npm, Python3.10+, Docker, tar and network access.
The native builder uses a disposable SDK container, pinned Ninja/pkg-config and
Rust with `cargo --locked`, a fixed source-date epoch, fixed shared-memory pages,
and explicit Dolphin revision metadata. `GAMECUBE_BUILD_JOBS` defaults to8.
`GAMECUBE_NATIVE_CACHE` can point to artifacts from a previous qualified Linux
build; source/recipe and both artifact hashes are still verified. CI leaves this
unset and rebuilds independently.
`WORK` is a dedicated upstream checkout; `OUT` is a new output directory (default
`release/gamecube`). Unexpected remotes, tracked edits, mismatching artifacts and
existing outputs are rejected. The localhost lab's manual disc controls are at
`/experimental/gamecube/` in beta. Its native `props` launch automatically selects
and boots a library disc. The lab server does not supply the CloudRcade save API;
use a packaged image to test full saves. Synthetic browser checks validate DiscIO,
streaming and lifecycle; actual GPU/game qualification requires a hardware browser.

GameCube hardware presents are limited to60Hz at completed command-ring presents,
with normal console timing. The diagnostic upstream `frameCap` option is not an
FPS limit. Standard Menu → Performance shows the last active window's native
speed, presentation gaps, JS replay cost, command backlog, disc waits/read-ahead,
shader/resource counts and allocated core memory. GPU execution time and total
browser/GPU memory are explicitly unavailable without intrusive probes.

Remote discs retain the existing2MiB chunks/eight-entry16MiB budget. The fetch
worker owns the cache (pending buffers included), reads ahead two chunks and
coalesces demand with pending prefetch. Seeks cancel unrelated speculative work;
failed speculative fetches retry on demand. Shared2MiB staging carries only the
requested bytes on a cache hit, with no second full-chunk cache/copy in the core
worker. This is GameCube-only; the shared disk reader is unchanged.

Opening standard Menu flushes changed memory cards through the shared account-
scoped cloud bridge. A slot state is created/uploaded only on Save State. The
menu displays local/cloud upload status. Completed state scratch files are
unlinked and output bytes transfer without an extra full-state copy; the native
1GiB allocation remains unchanged.
