# Experimental GameCube

The beta image adds Nintendo GameCube to the CloudRcade library. Valid ISO/GCM
files under the GameCube content directory launch Dolphin in the browser, using
the device GPU through WebGPU. Keyboard, standard gamepad and touch controls,
acknowledged pause/resume, Web Audio, memory cards and eight save-state slots are
included. Enable sound after launch to satisfy browser audio permission rules.
Memory cards autosave every15seconds, on pause and when returning to the library.
Use the Library/Close buttons to finish saving before leaving the game.
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
cached interpreter; dynamic JIT is disabled. No server GPU dependency exists.
The pinned binary reserves1.5GiB of initial WASM memory; small devices may lack
sufficient memory. Performance depends on browser, device and game.

The core uses [wasm-dolphin](https://github.com/dougchansan/wasm-dolphin) at the
exact commit in `core.json`, with SHA256-verified JavaScript/WASM. Preparation
reconstructs and verifies Dolphin's pinned source and66patches, packages its
corresponding source, and includes our modified host and save SDK source. The
save SDK uses pinned webRcade common9a7cf19 and locked npm dependencies. Dolphin's
Apache-licensed replacement GameCube fonts and license ship with the core.
No games, BIOS dumps, keys, accounts or operator settings are packaged.
The binary is pinned upstream, not a claimed local native rebuild. A Linux
native build and broader device/game qualification remain promotion requirements.

```sh
python3 deploy/webrcade/retro-dolphin/prepare.py
python3 deploy/webrcade/retro-dolphin/serve.py
node tests/test_webrcade_gamecube.cjs
NODE_PATH=<Playwright modules> node tests/browser_webrcade_gamecube.cjs
```

Preparation requires Git, Node22+, npm, Python3.10+, tar and network access.
`WORK` is a dedicated upstream checkout; `OUT` is a new output directory (default
`release/gamecube`). Unexpected remotes, tracked edits, mismatching artifacts and
existing outputs are rejected. The localhost lab's manual disc controls are at
`/experimental/gamecube/` in beta. Its native `props` launch automatically selects
and boots a library disc. The lab server does not supply the CloudRcade save API;
use a packaged image to test full saves. Synthetic browser checks validate DiscIO,
streaming and lifecycle; actual GPU/game qualification requires a hardware browser.
