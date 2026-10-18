# cloudRcade

[![Docker release](https://github.com/jacoknapp/cloudrcade/actions/workflows/docker.yml/badge.svg)](https://github.com/jacoknapp/cloudrcade/actions/workflows/docker.yml)

**cloudЯcade** (cloudRcade, with a backwards R) lets you play a supplied game library in a web browser. It is an independent, self-hosted fork of [webRcade](https://github.com/webrcade/webrcade), with Nextcloud and Dropbox saves, editable touch controls, Recently Played, offline caching, clock support, PlayStation disc streaming, Nintendo 3DS, PSP and GameCube support. It preserves upstream history and credits; it is not an official webRcade release.

<a id="mobile-and-installed-web-app"></a>

## I want to play

Ask the person running your arcade for its website address and any required account. Open the site, complete sign-in, open a system folder, select a game and choose **Play**. You do not need Docker or your own ROM folders to use somebody else's arcade.

Start with [your first game](docs/wiki/quick-start.md#play-your-first-game). Then read:

- [Library, search, feeds and installing the web app](docs/wiki/library-and-devices.md).
- [Keyboard, gamepad, touch buttons and editing your layout](docs/wiki/controls-and-menus.md).
- [Where progress is saved, save states and changing devices](docs/wiki/saves-and-storage.md).
- [Nextcloud Link, connection status, Manage and reconnecting](docs/wiki/nextcloud-and-access.md).
- [Streaming, offline play and 3DS performance](docs/wiki/streaming-offline-and-3ds.md).

PSP support is available by default; no player or Docker enable setting is needed. Place PSP games under `roms/psp/roms/`. HTTPS and WebGL2 are required.

GameCube is also enabled by default. It requires HTTPS and browser WebGPU support;
compatibility and performance depend on the game and device. See the
[GameCube guide](deploy/webrcade/retro-dolphin/README.md).

PlayStation 2 is available by default and requires HTTPS and device WebGPU.
Its optional **PS2 performance readout** is in **Settings → Core Settings** and
defaults off. Existing ISO/CHD/homebrew ELF files under `roms/PS2/` or `roms/ps2/`
are scanned in place. No external PS2 BIOS is needed. Large discs stream with a
16 MiB cache; compatibility and speed vary. See the
[PlayStation 2 guide](deploy/webrcade/retro-play/README.md).

<a id="nextcloud-and-sso"></a>

Nextcloud and Dropbox can sync supported game saves, state slots, controller preferences and Recently Played. Operators enable providers; players choose a save destination in **Settings → Cloud Storage → Choose storage** and link their own account. Dropbox requires the operator's scoped App Folder app and public app key; its sign-in uses PKCE without an app secret. Browser-local saves work without a cloud connection for supported games. [Cloud choices and setup](docs/wiki/saves-and-storage.md#choose-a-storage-option) explains provider setup, switching, shared-file hosting and Google Drive source files. Google Drive save synchronization is not implemented.

<a id="internet-connection-for-streamed-games"></a>

**Keep a connection while playing streamed discs or large 3DS ROMs.** This includes streamed PlayStation, PSP, GameCube and PlayStation 2 discs. Loading the first screen does not download the whole game. **3DS shaders cache as they are created:** new shaders can cause hitches, and many new shaders together can cause longer pauses. Performance varies by game, browser and device.

<a id="run-with-docker"></a>

## I want to run an arcade

You supply Docker with Compose, an HTTPS gateway, games you are entitled to use, any required BIOS/keys, and optional cloud accounts. The image supplies the application and integrated library scanner.

```sh
git clone https://github.com/jacoknapp/cloudrcade.git
cd cloudrcade
cp .env.example .env
mkdir -p roms/nes/roms roms/3DS/bios roms/managed config
# Set your HTTPS origin and paths in .env; add a supported game under roms/nes/roms/.
docker compose up -d
```

The default listener is `127.0.0.1:8443`. Compose mounts `config/` read-write at `/config` and `roms/` read-only at `/roms`; startup creates persistent state under `config/data/` and certificates under `config/tls/`. Finish gateway setup and verify the first scan using [Docker quick start](docs/wiki/quick-start.md#prepare-the-deployment). The library can initially be empty while scanning. Scans run at startup and every six hours by default; ROMs and external BIOS files are mounted read-only.

[Folder layout and adding games](docs/wiki/library-administration.md) explains every scanner system directory, BIOS files, generated feeds and derived discs. [Operations](docs/wiki/operations-and-troubleshooting.md) covers environment variables, backup, upgrades and troubleshooting. [Nextcloud and access](docs/wiki/nextcloud-and-access.md#enable-a-server) covers manual linking, optional automatic login and SSO. All deployment URLs, flags, names, namespaces and paths remain environment-controlled.

The release image is `ghcr.io/jacoknapp/cloudrcade:latest`. Every merge to `main` builds and publishes it; pull requests validate without publishing. Commit-specific `sha-<full-commit>` and `v*` release tags are also published.

Main and release-tag images support **Linux AMD64 and ARM64**, including 64-bit ARM servers and Raspberry Pi systems running a 64-bit OS. Docker selects the matching image automatically. Both architectures pass the app and scanner smoke checks before publication. Beta branch images, including `beta-ps2-core`, are AMD64-only.

<a id="user-and-operator-wiki"></a>
<a id="development-and-licensing"></a>

## Documentation and development

The [wiki home](docs/wiki/README.md) explains basic terms and provides a route for players and operators. Advanced references are [runtime configuration and implementation](deploy/webrcade/README.md), [build architecture](docs/architecture.md) and [3DS core setup](deploy/webrcade/retro-azahar/README.md).

The release uses a pinned upstream runtime with hash-checked overlays. Editing inherited frontend source alone does not update the shipped image. Run `python3 scripts/check-release.py` and `python3 scripts/test.py` for release checks; see the operations guide for build and browser-test prerequisites.

<a id="3ds-bios-and-keys"></a>

No ROM, BIOS, key set or console backup is supplied. Encrypted 3DS games require your own compatible Citra-format `aes_keys.txt` under `roms/3DS/bios/`, supplied through the read-only ROM mount. Runtime keys are never part of offline caches or ordinary save ZIPs.

The frontend and standalone deployment additions use Apache 2.0 with attribution retained. Emulator cores and the optional Nextcloud app have separate licenses, including GPL/AGPL and noncommercial terms. The full bundle is not wholly Apache-licensed or unrestricted for commercial redistribution. Read [privacy and licenses](docs/wiki/privacy-and-licenses.md), [LICENSE](LICENSE), [NOTICE](NOTICE) and [THIRD_PARTY.md](THIRD_PARTY.md). Modified 3DS and PSP corresponding source ships at `/licenses/sources/3ds-source.tar.gz` and `/licenses/sources/psp-source.tar.gz` in the image.
