# Experimental GameCube prototype

This is the first GameCube milestone on the reset beta branch: an isolated
Dolphin browser session with local ISO/GCM loading, keyboard/gamepad input,
pause/resume, hardware WebGPU rendering and explicit worker cleanup. It is experimental.
Sound, saves and the native CloudRcade library are not integrated yet.
The 50 MB threshold and GPU configuration apply only to GameCube. Other
systems keep their existing thresholds, renderer settings and controller behavior.

The prototype uses [wasm-dolphin](https://github.com/dougchansan/wasm-dolphin)
at the exact commit in `core.json`. Both JavaScript and WASM are hash-checked.
Preparation reconstructs the pinned Dolphin source, verifies every patch and
resulting tree, and packages the corresponding source alongside the binary.
The adapter source is also retained in the generated `adapter-source/` directory.
No ROMs, BIOS dumps, keys, accounts or production settings are included.

```sh
python3 deploy/webrcade/retro-dolphin/prepare.py
python3 deploy/webrcade/retro-dolphin/serve.py
# Open http://127.0.0.1:18572/ and explicitly initialize the experimental core.
```

Prerequisites: Git, Node22 or newer, Python3.10 or newer, tar and network access.
`WORK` selects a dedicated upstream checkout. `OUT` selects a new generated
output directory (default `release/gamecube`). Preparation rejects tracked
edits, unexpected remotes, mismatching binaries and existing output directories.
The server binds to localhost and adds the headers required for shared memory.
Browsers need a secure context, cross-origin isolation, shared-memory workers,
OffscreenCanvas and WebGPU access to the device GPU. Software adapters and
CPU rasterizer fallback are rejected. Headless software-GPU checks cannot
qualify actual device performance or game rendering.

ISO/GCM validation reads only the 32-byte header. The worker mounts the original
File through WORKERFS rather than copying a multi-gigabyte disc into MEMFS.
URL-loaded games over **50 MB (50,000,000 bytes)** use bounded HTTP ranges.
The existing disk reader supplies exactly the same **2 MiB chunks**, eight-chunk
LRU and **16 MiB maximum cache** used by the other large-disc integrations.
Each worker response must match the requested range and total file size;
servers that return a full-file 200 response are rejected. Smaller URL games
can download into a bounded File; local Files always use WORKERFS reads.
Cross-origin URLs require CORS and an exposed `Content-Range` header.
Compressed RVZ and Wii discs are outside this first milestone. A disc inspected
by DiscIO is not reported as running unless the real Dolphin core accepts boot.
The **real Dolphin WebGPU hardware backend** is mandatory, with no software
rasterizer. The cached interpreter handles CPU emulation; dynamic JIT is off.

The binary is **pinned upstream**, not a claimed local native rebuild. Upstream's
current build lock is Windows-specific. A reproducible Linux source build must
be qualified before adding the core to release images. This prototype is not
registered by the scanner, bundled by Docker, or exposed as a playable library
system. PSP remains available without an experimental setting, and beta still
publishes AMD64 only.

```sh
node tests/test_webrcade_gamecube.cjs
NODE_PATH=<Playwright modules> node tests/browser_webrcade_gamecube.cjs
```

The browser test requires a running prepared lab and uses no games or accounts.
It verifies capability rejection, real WASM initialization, streaming and cleanup,
not gameplay or hardware speed. Device GPU qualification remains required.

Next milestones: qualify the Linux source build and real gameplay; add bounded
native app registration behind a default-off GameCube
Experimental Settings switch; then scanner entries, touch controls, local and
Nextcloud memory cards/save states, mobile behavior and packaged-image checks.
Preserve the existing PSP app identity, saves, controls and flag-free behavior.
