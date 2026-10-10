# Streaming, offline and 3DS

[Wiki home](README.md) · [Library administration](library-administration.md) · [Saves](saves-and-storage.md)

## Before you play

For an ordinary cartridge game, the browser usually downloads the required game bytes before play. For a streamed disc/large ROM, it reads additional bytes as you progress. Offline play depends on complete cached files, not just seeing the title in your library.

| Scenario | What to expect |
| --- | --- |
| Ordinary game with all required files already cached | May work offline; test it on the same browser/profile first |
| Streamed PlayStation disc or 3DS ROM over 512 MiB | Keep the server/internet connection available during play |
| Encrypted 3DS cold launch needing runtime keys | Keys are fetched separately and never cached; do not count on offline launch |
| Offline gameplay with Nextcloud linked | Cloud transfer still needs a connection; preserve local regular-save backups and check upload later |

## Streamed games require a connection

**PlayStation disc streaming and streamed 3DS ROMs require an active internet connection during play.** They fetch game bytes on demand. Startup success does not mean the rest of the file is available offline; keep access to the server throughout play. Network latency or a missing chunk can briefly pause emulation.

Direct same-origin PlayStation CHD/PBP files use HTTP byte ranges when their server advertises compatible binary/range responses. Startup probes with HEAD and fetches an initial chunk. A bounded resident chunk cache reduces whole-disc transfer and memory use. Existing BIOS selection, disc selection, memory cards, save states and feed save IDs remain the native PlayStation interfaces.

External feeds, archives and servers without valid advertised range support retain upstream download handling. Invalid or incomplete range responses fail rather than passing corrupt bytes to the emulator. Preserve HEAD, Range, Content-Length, Content-Type and range response behavior through your proxy. Do not rewrite binary responses as login pages or compress them in a way that breaks byte offsets.

The 3DS loader streams ROMs **larger than 512 MiB**. Its bounded chunk cache is not a full download. ROM size, browser memory, core compatibility and server range behavior all affect whether a game can run. Small ROMs still need all required assets and any runtime keys.

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

The release image includes the key-free Azahar-based app. Enable scanner registration with `WEBRCADE_ENABLE_3DS=true` (the root example default). This registers the 3DS app and exposes its **Experimental Settings** page; [readout and CPU-lighting diagnostics](controls-and-menus.md#experimental-settings-and-defaults) start off. The inherited Experimental apps browser preference is separate. Supply supported application files under `roms/3DS/`; updates, DLC, unsupported seed-protected games and operator exclusions are filtered by the scanner.

Encrypted games need your own compatible Citra-format `aes_keys.txt`. The root Compose example uses:

```dotenv
WEBRCADE_3DS_BIOS_PATH=./roms/3DS/bios
WEBRCADE_3DS_KEYS_FILE=/run/cloudrcade/3ds/aes_keys.txt
```

Put that file in the selected host BIOS directory outside tracked source. Compose mounts the directory read-only at `/run/cloudrcade/3ds`. Custom deployments may choose another mount/file path, but `WEBRCADE_3DS_KEYS_FILE` must point to the readable file **inside the container**. Missing/unreadable files do not select a bundled fallback. Decrypted games can run without this key file. The project supplies no keys, BIOS or console backups and does not load `boot9.bin` as a substitute. Seed-dependent titles are not generally supported merely by adding AES keys.

The authorized browser reads keys from the same-origin no-store endpoint and places them in emulator memory before boot. Static key filenames in the ROM share are denied; keys are excluded from release source, build context, asset caches and ordinary battery-save ZIPs. Access control matters because the authorized browser must receive the runtime bytes to emulate encrypted content.

## 3DS shaders and performance

**Shaders cache as they are created.** The first encounter with a shader can hitch; many new shaders together can cause larger pauses, especially on mobile. Observed cached shaders reduce repeat work, but a cache is not a universal precompiled set for every scene/device. The current core has no Dynarmic CPU recompiler; native 1x resolution and the original model are defaults. Game/browser/device combinations vary substantially in performance.

The optional **3DS performance readout** in Experimental Settings is read at launch and helps distinguish emulation, graphics, audio and memory costs. Leave active GPU cost probes off for normal play; those diagnostics deliberately add waits. A passive FPS readout is evidence for the tested scene/device, not a promise for every game.

On mobile, 3DS controls provide independent Circle Pad, C-stick, D-pad and shoulders; portrait stacks screens toward the top. Text input uses a browser prompt. Audio may need a player gesture. Use the native exit flow so the core stops, workers terminate and ROM/audio resources release before returning to the library.

See the [3DS implementation documentation](../../deploy/webrcade/retro-azahar/README.md) for core patches, shader diagnostics and browser tests. Some sections there describe historical/custom source deployments; the root Docker image, Compose file and `.env.example` define the portable release installation.
