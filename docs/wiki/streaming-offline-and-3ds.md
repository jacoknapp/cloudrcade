# Streaming, offline and 3DS

[Wiki home](README.md) · [Library administration](library-administration.md) · [Saves](saves-and-storage.md)

## Before you play

For an ordinary cartridge game, the browser usually downloads the required game bytes before play. For a streamed disc/large ROM, it reads additional bytes as you progress. Offline play depends on complete cached files, not just seeing the title in your library.

| Scenario | What to expect |
| --- | --- |
| Ordinary game with all required files already cached | May work offline; test it on the same browser/profile first |
| Streamed PlayStation/GameCube/Wii/PS2 disc, PSP game over 128 MiB or 3DS ROM over 512 MiB | Keep access to the game server available during play |
| Encrypted 3DS cold launch needing runtime keys | Keys are fetched separately and never cached; do not count on offline launch |
| Offline gameplay with cloud storage linked | Cloud transfer still needs a connection; preserve local regular-save backups and check upload later |

## Streamed games require a connection

**Streamed games require a connection to their game server during play.** This includes streamed PlayStation, GameCube, Wii and PlayStation 2 discs and large PSP/3DS files. They fetch game bytes on demand. Startup success does not mean the rest of the file is available offline; keep access to the server throughout play. Network latency or a missing chunk can briefly pause emulation. A local server can remain reachable without public internet access, but external assets and cloud transfers may still need it.

Direct same-origin PlayStation CHD/PBP files use HTTP byte ranges when their server advertises compatible binary/range responses. Startup probes with HEAD and fetches an initial chunk. A bounded resident chunk cache reduces whole-disc transfer and memory use. Existing BIOS selection, disc selection, memory cards, save states and feed save IDs remain the native PlayStation interfaces.

External feeds, archives and servers without valid advertised range support retain upstream download handling. Invalid or incomplete range responses fail rather than passing corrupt bytes to the emulator. Preserve HEAD, Range, Content-Length, Content-Type and range response behavior through your proxy. Do not rewrite binary responses as login pages or compress them in a way that breaks byte offsets.

The 3DS loader streams ROMs **larger than 512 MiB**. Its bounded chunk cache is not a full download. ROM size, browser memory, core compatibility and server range behavior all affect whether a game can run. Small ROMs still need all required assets and any runtime keys.

PSP files **larger than 128 MiB** use a bounded HTTP range reader with at most 16 MiB of game chunks retained. Keep the game server reachable during play; those chunks do not form a complete offline download. PSP needs no external console BIOS. See the [PSP guide](../../deploy/webrcade/retro-ppsspp/README.md).

<a id="gamecube-and-the-ps2-beta"></a>

## GameCube, Wii and PlayStation 2

GameCube is included when the Dolphin core is packaged and has no enable flag. Supply valid ISO/GCM files under `roms/GameCube/`; RVZ and Wii discs are unsupported. Games larger than 50,000,000 bytes use strict HTTP 206 streaming with a bounded cache. The player's browser needs HTTPS (or localhost), shared-memory isolation, OffscreenCanvas and hardware WebGPU. Software GPU fallback is rejected. The core reserves 768 MiB of WASM memory; browser and GPU allocations add to that. Compatibility and performance depend on the game, browser and device.

Wii is available by default with no player or Docker enable flag. Place ISO,
complete single-file WBFS or Wii CISO discs under `roms/Wii/` (case insensitive).
It uses device WebGPU and the same strict streaming/isolation requirements as
GameCube, with a768MiB WASM reserve plus browser/GPU allocations. It has its own
controller and `wii/<game ID>/` save namespace. Only title-data files are synced;
console keys, tickets and title content are excluded. Compatibility and speed
vary by game/browser/device. See the [Wii guide](../../deploy/webrcade/retro-wii/README.md)
for controller modes, phone motion and current format/input limitations.

GameCube and Wii retire cold compiled functions when their bounded cache fills.
GameCube permits a larger cache on suitable desktops while keeping the smaller
standard/mobile budget. Full compiled blocks use chaining by default. These
changes preserve save formats and do not guarantee full speed or prevent every
browser/device termination; physical iOS behavior needs device testing.

PlayStation 2 is available by default with no player or Docker enable flag. ISO, CHD v5 and homebrew ELF files are scanned recursively under `roms/PS2/` or `roms/ps2/`. Play! supplies an HLE BIOS and does not need an external PS2 BIOS. PlayStation 2 requires hardware WebGPU, HTTPS (or localhost), cross-origin isolation and SharedArrayBuffer, with no WebGL or software-adapter fallback; see the [PS2 guide](../../deploy/webrcade/retro-play/README.md). Remote ISO/CHD discs use strict HTTP 206 ranges and a bounded cache throughout play; a server returning the full file instead of the requested range fails the launch/read.

Stable images support AMD64 and ARM64; beta candidate images remain AMD64 only. PlayStation 2 compatibility and speed vary by game and device; passing a homebrew test does not establish commercial-game compatibility or phone performance. See the [PlayStation 2 guide](../../deploy/webrcade/retro-play/README.md) and [GameCube guide](../../deploy/webrcade/retro-dolphin/README.md) for qualification details.

## What offline caching does

After the authenticated app loads, it warms the library shell and configured feed. The worker also caches eligible same-origin emulator/static assets and complete game/BIOS responses that the browser actually loads. This does not download the entire collection or force streamed discs to fully download.

To prepare an ordinary supported game for offline use:

1. Open the arcade online in the browser/profile you will use later.
2. Launch the game and allow its required assets to load. Save/exit normally.
3. Test the same game while disconnected before depending on it for a trip or outage.

A fully cached game can launch from the normal site URL or a saved game link, including after reopening that browser. Missing files produce a reconnect message. External cover artwork may be absent. Cloud transfers need a connection even when gameplay is available offline.

A partially streamed disc/ROM is not a complete offline game. The worker can serve HEAD/range reads from a **cached complete file**, but partial responses are not treated as complete cached files. External 3DS keys are separately fetched and never cached; do not rely on cold offline launch of encrypted games that need that endpoint.

## Storage and authentication limits

Asset caching depends on browser quota and eviction. Where estimates are available, caching leaves at least 64 MiB or 5% of quota free for saves and other data. A failed cache write does not interrupt online gameplay. Clearing site data, browser eviction or switching profiles can remove offline files. Installed PWA status does not guarantee permanent storage.

The worker excludes redirects, login HTML, partial responses, private/no-store responses, cloud APIs, credentials and authentication routes. It does not store account credentials or runtime keys in its asset cache. Existing asset caches and save stores are not purged during app updates. Keep the same origin/storage prefix when upgrading.

Worker installation performs no protected fetches during sign-in. Caching starts from the loaded app after authentication. Authentik operators still need the exact public static-worker exception described in [Nextcloud and access](nextcloud-and-access.md#protect-sign-in-from-worker-updates).

## 3DS setup

The release image includes the key-free Azahar-based app. Enable scanner registration with `WEBRCADE_ENABLE_3DS=true` (the root example default). This registers the 3DS app; **Settings → Core Settings** contains its [readout and CPU-lighting diagnostics](controls-and-menus.md#experimental-settings-and-defaults), which start off. The inherited Experimental apps browser preference is separate. Supply supported application files under `roms/3DS/`; updates, DLC, unsupported seed-protected games and operator exclusions are filtered by the scanner.

Encrypted games need your own compatible Citra-format `aes_keys.txt`. The root Compose example uses:

```dotenv
WEBRCADE_3DS_KEYS_FILE=/run/cloudrcade/3ds/aes_keys.txt
```

Put `aes_keys.txt` in `roms/3DS/bios/` outside tracked source, relative to the default ROM mount. Root Compose mounts the ROM tree read-only at `/roms`; startup maps `/run/cloudrcade/3ds` to `/roms/3DS/bios`. There is no separate BIOS mount variable in the root example. Custom deployments may choose another mount/file path, but `WEBRCADE_3DS_KEYS_FILE` must point to the readable file **inside the container**. Missing/unreadable files do not select a bundled fallback. Decrypted games can run without this key file. The project supplies no keys, BIOS or console backups and does not load `boot9.bin` as a substitute. Seed-dependent titles are not generally supported merely by adding AES keys.

The authorized browser reads keys from the same-origin no-store endpoint and places them in emulator memory before boot. Static key filenames in the ROM share are denied; keys are excluded from release source, build context, asset caches and ordinary battery-save ZIPs. Access control matters because the authorized browser must receive the runtime bytes to emulate encrypted content.

## 3DS shaders and performance

**Shaders cache as they are created.** The first encounter with a shader can hitch; many new shaders together can cause larger pauses, especially on mobile. Observed cached shaders reduce repeat work, but a cache is not a universal precompiled set for every scene/device. The current core has no Dynarmic CPU recompiler; native 1x resolution and the original model are defaults. Game/browser/device combinations vary substantially in performance.

The optional **3DS performance readout** in Core Settings is read at launch and helps distinguish emulation, graphics, audio and memory costs. Leave active GPU cost probes off for normal play; those diagnostics deliberately add waits. A passive FPS readout is evidence for the tested scene/device, not a promise for every game.

On mobile, 3DS controls provide independent Circle Pad, C-stick, D-pad and shoulders; portrait stacks screens toward the top. Text input uses a browser prompt. Audio may need a player gesture. Use the native exit flow so the core stops, workers terminate and ROM/audio resources release before returning to the library.

See the [3DS implementation documentation](../../deploy/webrcade/retro-azahar/README.md) for core patches, shader diagnostics and browser tests. Some sections there describe historical/custom source deployments; the root Docker image, Compose file and `.env.example` define the portable release installation.
