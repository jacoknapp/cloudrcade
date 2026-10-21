# GameCube

The release image includes Nintendo GameCube in the CloudRcade library. Valid ISO/GCM
files under the GameCube content directory launch Dolphin in the browser, using
the device GPU through WebGPU. Keyboard, standard gamepad and touch controls,
acknowledged pause/resume, Web Audio, memory cards and eight save-state slots are
included. Menu and Escape open CloudRcade's shared native pause screen and save
slot editor, with the same keyboard and gamepad navigation as the other cores.
Return to Browse saves memory cards before leaving. The controller settings
drawer includes touch controls, mute, layout editing and **Frame skip**. Frame skip
defaults to **Off**; **2×**, **3×** and **4×** render every second, third or fourth
GX frame. The preference is saved separately for GameCube and Wii on this
browser and changes apply between complete graphics images. Cadence follows
new VI display images, including games making multiple XFB copies per image;
a latched decision prevents an in-flight draw from changing midway. Skipped frames omit
texture loading, pipeline preparation, buffer uploads and draws, plus bulk vertex
conversion. The final three valid input vertices retain GX normal/matrix/zfreeze
state; suppressed indexed tails use full conversion. CPU emulation, register
processing and audio continue every frame. GPU-only EFB copies retain their last
complete image instead of overwriting it with incomplete skipped-frame content;
RAM copies and clears continue. Games relying on graphics readbacks can require
Off. CPU-bound games can gain little speed even when drawing work falls sharply.
Native frame markers determine presentation, with no second host skip cadence.
GameCube has its
own default button and stick geometry; saved per-system layouts remain usable.
Desktop audio starts enabled after Play; browser gestures retry audio activation.
Touch devices use Menu or the drawer to enable audio; master mute still applies.
Memory cards sync on pause (Menu or app backgrounding) and when returning to the
library. There is no periodic upload during gameplay. Unchanged cards skip
storage writes, and failed cloud sync remains retryable on the next pause/exit.
The built-in
GameCube performance readout is off by default; switch it on or off in the
library's Core Settings before launching. It samples native frame and
emulated-time counters once per second. It reports rendered FPS, native game target
and emulation speed, plus device WebGPU resolution and WASM memory. Native execute/compile timings time one CoreTiming slice in eight and scale the totals, so the readout costs about 2% of the emulation thread instead of about 9%. Sunshine NTSC
targets30 rendered FPS at100% speed; presentation is capped at60 FPS for games
that normally render at60. The cap does not alter the emulated game clock.
It resets after pause/resume or loading states and adds no GPU timing probes.
Local and connected Nextcloud saves use the existing CloudRcade account isolation,
conflict handling and offline recovery bridge. States use the verified serialization-format namespace, allowing compatible
native performance rebuilds to retain existing slots. Game compatibility and performance depend on the browser and device.

The standard release includes GameCube with no enable flag. The current Docker
workflow builds `main` and version tags for AMD64 and ARM64; `beta/*` branches
publish AMD64 only. The historical
`/experimental/gamecube/` URL remains compatible with existing library links.
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
thread. Native WebGPU uses packed geometry, queue uploads and the replay pump.
Mandatory uniform uploads skip a redundant comparison; clean retained slices still
receive an exact comparison.
Immediate texture and buffer uploads share the same bounded4MiB host scratch,
avoiding a new texture payload allocation on each write. Held uploads retain their
own bytes; oversized writes use a temporary copy. Heavy diagnostic GPU probes
remain off. These choices apply only to GameCube.
No server GPU dependency exists.
Compiled PPC callbacks use the native direct dispatch and inline wrapper while
retaining block accounting, timing, invalidation and halt checks.

Backgrounding suspends GameCube without opening the pause menu. Returning resumes
only a session paused by the background transition; intentional menu/layout pauses
stay paused. Worker pause/start commands are serialized, and persisted page
restores retain the session. CPU resume does not depend on restarting browser audio.
The native binary reserves768MiB of initial WASM memory; small devices may lack
sufficient memory. Performance depends on browser, device and game.

The renderer translates generated GX shaders through GLSL, SPIR-V and Naga to
WGSL. Fragment depth and fog use the same reversed-depth convention as vertex
depth. Constant destination-alpha effects use separate GPU color/alpha draws so
RGB blends with TEV source alpha while the framebuffer retains its requested
alpha. This works without optional dual-source blending, framebuffer copies or
CPU pixel readback. Overlapping primitives retain depth and alpha ordering.
Texture decoding remains on the CPU. Integer texture bindings and generic
GPU-to-CPU texture readback still have incomplete paths; this is not a claim that
every GameCube effect translates correctly. The native texture destructor now
releases its browser GPU texture, and replaced texture bind groups retire after
the owning render pass publishes. Physical resource destruction follows GPU
submission. Slow scenes keep guarded JIT acceleration while native frames advance;
five seconds without progress still trips the JIT fuse. Byte-identical compiled
functions with identical helper imports reuse their worker-local handles. The
instance cache caps at16384 for GameCube. On pressure, a clock policy gives
recently executed functions another chance and retires cold functions in bounded
batches at a CPU slice boundary. Every native block sharing a retired handle is
unlinked before its function-table slot is cleared or reused. Hot functions and
permanent helpers keep their slots. New blocks use the interpreter until room is
available; deferred compilation waits for that room. The CPU records access with
one native byte store, without per-block JS calls, timestamps or map lookups.
GameCube's native callback arena is64MiB within the unchanged768MiB heap reserve.
Only the unused legacy
CPU notification image is reduced; the native GPU render resolution is unchanged.
Fatal worker/WASM/GPU errors and sixty seconds without frame progress stop the
session and offer restart or return to the library.
Crash runtime identifiers cover native JavaScript, host modules and patch inputs,
so JavaScript-only changes are distinguishable when the WASM stays unchanged.

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
usage and heap extent only while paused; browser and GPU allocations are separate.
WASM state-buffer growth releases the obsolete allocation before replacement;
LZ4 save compression uses4MiB blocks to bound scratch memory. During restoration,
the temporary rollback snapshot uses independent4MiB LZ4 chunks when these take
at most half its raw size; the raw snapshot is released before decoding the
incoming state. Poorly compressible snapshots retain the existing raw fallback.
A rejected state restores the prior game and reports failure; rollback buffers
are released after the transaction. The existing
length-prefixed decoder reads these and previous larger blocks, preserving state
serialization and failed-load recovery.
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
GAMECUBE_SOURCE_ARCHIVE=release/gamecube/app/gamecube-source.tar.gz python3 tests/test_native_gamecube_clock.py
```

Preparation requires Git, Node22+, npm, Python3.10+, Docker, tar and network access.
The native builder uses a disposable SDK container, pinned Ninja/pkg-config and
Rust with `cargo --locked`, a fixed source-date epoch, fixed shared-memory pages,
and explicit Dolphin revision metadata. `GAMECUBE_BUILD_JOBS` defaults to8.
`GAMECUBE_NATIVE_CACHE` can point to artifacts from a previous qualified Linux
build; source/recipe and both artifact hashes are still verified. CI can reuse only an exact-input, hash-verified native cache. Changed native inputs
or the workflow's explicit full-rebuild option compile the core independently.
`WORK` is a dedicated upstream checkout; `OUT` is a new output directory (default
`release/gamecube`). Unexpected remotes, tracked edits, mismatching artifacts and
existing outputs are rejected. The localhost lab's manual disc controls are at
the compatible `/experimental/gamecube/` URL. Its native `props` launch automatically selects
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
completed entries use LRU eviction so old reads cannot displace upcoming data.
Transient network failures retry once within the original timeout; disc-identity
and range-validation failures are never retried. Failed speculative fetches can
still retry on demand. Shared2MiB staging carries only the
requested bytes on a cache hit, with no second full-chunk cache/copy in the core
worker. This is GameCube-only; the shared disk reader is unchanged.

Opening standard Menu flushes changed memory cards through the shared account-
scoped cloud bridge. A slot state is created/uploaded only on Save State. The
menu displays local/cloud upload status above its screen, with immediate save
notifications and an animated upload indicator. A background indicator remains
visible when Menu closes during a memory-card upload. Unchanged cards report
that no upload was needed.

GameCube keeps snapshot ZIP entries uncompressed because the native snapshot is
already LZ4-compressed. ZIP contents stay Blob-backed until native input is
needed; input then transfers to the worker. Slot inspection reads entry names
and metadata without inflating snapshots, never writes its incomplete records,
and prefers pending local progress. Existing compressed ZIPs remain readable.
The shared bridge's metadata reader is opt-in; other cores keep their existing
serialization. Actual reads check ZIP CRCs before passing snapshots to the core.

Completed state scratch files are unlinked. The native undo snapshot remains
available during a failed-load rollback, then is released after the transaction;
there is no browser Undo Load action. The fixed native allocation remains768MiB.
Run `tests/browser_webrcade_gamecube_saves.cjs` against the prepared SDK for
both-engine ZIP/IndexedDB/cloud-recovery checks with isolated persistent profiles
and synthetic accounts. Native gameplay/state qualification is separate.


The adapter restores Dolphin's normal `SyncOnSkipIdle` setting through an
in-memory game configuration before boot. With it disabled in the upstream
wasm host, Double Dash could stop submitting draws at the track preview while
its native VI counter continued. This setting applies within the GameCube
worker; the compiled core, state format, disc cache and other systems stay the
same. Qualification checks both rendered and native progress and reviews the
race image. The root image disables automatic Watchtower updates so native browser
verification can complete before an explicit deployment.


### Compiled-code cache budgets

Before boot, positively identified Windows/macOS/x86 Linux desktops select a
32,768-instance executable cache and 128 MiB callback arena. iOS (including iPad
Mac-style user agents), Android/mobile, unknown devices and desktops reporting
less than 8 GiB through the optional browser memory hint retain 16,384 instances and
64 MiB. Browsers without a memory hint use the desktop classification; that does
not measure available RAM. Wii retains its existing 32,768/128 MiB native baseline
under either profile. Profiles are sealed atomically when the cached interpreter
allocates its arena; active callbacks are never resized or recycled in place.
Both budgets use the existing bounded CLOCK retirement and 768 MiB WASM reserve.
Cache budgets are runtime policy, excluded from Dolphin state serialization.
A larger cache reduces capacity pressure; it does not skip CPU emulation work or
guarantee higher FPS. The performance readout's native helper stats include
`instcap` and `instlive`.
