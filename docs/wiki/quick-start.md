# Quick start

[Wiki home](README.md) · [Project README](../../README.md)

## Play your first game

These steps are for using an existing arcade. If you are installing the server yourself, continue to [Prepare the deployment](#prepare-the-deployment).

1. Open the arcade URL your operator gave you. Complete the website's sign-in if one appears.
2. If you want cloud progress, open **Settings → Cloud Storage** before starting and select an enabled provider. For Nextcloud, choose **Link**, finish its approval, and check that Status says **Connected**. If the site links automatically, still check the account shown. See [the connection walkthrough](nextcloud-and-access.md#link-as-a-player) and [storage choices](saves-and-storage.md#choose-a-storage-option).
3. Open a system folder, select a game, and choose **Play**. Wait for the loading screen to finish; the browser downloads the emulator and required game files.
4. Use touch buttons, a connected gamepad or the keyboard. On touch, **Menu** opens the pause menu. For other devices, use the emulator's **View Controls** guide to find its controls and pause shortcut.
5. Save using the game's own save function if it has one. Open the native pause menu and exit back to the library. Allow saving to finish and read any error before closing the tab.
6. Reopen the game and check your progress before relying on it. If you plan to switch devices, follow [Moving to another device](saves-and-storage.md#moving-to-another-device).

You can play supported games without linking cloud storage; their local progress belongs to this browser/profile. Installing the web app is optional and does not itself move saves into the cloud. A game that does not have its own save function may offer emulator state slots; see [the difference](saves-and-storage.md#in-game-saves-and-save-states).

If something fails, use [player troubleshooting](operations-and-troubleshooting.md#player-troubleshooting) and tell the operator the game, device/browser and visible error. Do not clear browser data to try to fix missing progress.

## Prepare the deployment

You need Docker with Compose, space for ROMs and writable app data, and an HTTPS origin reachable by your players. Start with a small game library to check the deployment before adding large discs or optional integrations.

```sh
git clone https://github.com/jacoknapp/cloudrcade.git
cd cloudrcade
cp .env.example .env
mkdir -p roms/nes/roms roms/3DS/bios config/data/feeds config/data/derived config/tls roms/managed
```

Edit `.env`. Set `WEBRCADE_PUBLIC_URL` to your public origin, for example `https://arcade.example.com`. The default initial feed is `/content/feeds/combined.json`. Keep relative feed/content URLs for a same-origin deployment. Leave Nextcloud and metadata disabled for the first test if you do not need them yet.

Copy a supported, legally supplied NES ROM into `roms/nes/roms/`. ROMs belong in the mounted library, outside tracked release source. See [library administration](library-administration.md) for other formats and BIOS requirements.

```sh
docker compose pull
docker compose up -d
docker compose logs --tail=100 webrcade
```

The repository's service is named `webrcade`; this command uses that service, not the image name. The default port binding is `127.0.0.1:8443` to container port 443. Configure your HTTPS gateway to reach that listener, or adjust the bind address and gateway network arrangement. A gateway in a separate container cannot reach the host listener through its own `127.0.0.1`.

The base runtime provides a generated TLS certificate in the config mount's `tls` directory. Configure appropriate backend certificate trust at your gateway, or supply your own certificate files following your gateway's deployment requirements. Use your intended authentication/access policy before exposing private ROMs or runtime keys. This repository does not create a public DNS record, trusted public certificate or identity-provider application for you.

## Verify your first library

The integrated scanner runs at startup and every six hours by default. The first scan may take time to hash files or convert discs; the library can initially be empty. Check logs and `config/data/last-scan.json` after completion (container path `/data/last-scan.json`). The scanner retains the last complete feed if a later scan fails.

Open your configured public origin, sign in if your gateway requires it, select the NES system folder, open a game and choose **Play**. Confirm input and audio, use the game's pause menu, and return through the native exit flow. Save inside the game if it supports saving and check that progress survives a normal exit and reopening.

If you add another ROM, either wait for the next scan or request one:

```sh
docker compose exec webrcade python3 /usr/local/share/cloudrcade/service.py scan
```

Then reload the feed/library. Only one scan runs at a time. Empty scans do not replace a populated feed; do not use an empty ROM mount as a way to erase the library.

## Add optional features

- [Nextcloud](nextcloud-and-access.md): enable the configured server and manually Link first, then decide whether to enable automatic login.
- [Mobile controls](controls-and-menus.md): adjust buttons while a game is running; save portrait and landscape separately.
- [Installed web app](library-and-devices.md#install-the-web-app): use your browser's installation action.
- [Disc streaming and 3DS](streaming-offline-and-3ds.md): supply any required BIOS/keys and keep a connection for streamed files. GameCube needs device WebGPU; PS2 remains an opt-in beta.
- [Metadata](library-administration.md): optionally configure server-only IGDB credentials in `config/metadata.json`; no Gaseous service is required.

Before using the deployment for lasting progress, establish a backup plan for app data, browser-local saves and any Nextcloud files. See [operations](operations-and-troubleshooting.md#back-up-before-changing-a-deployment).
