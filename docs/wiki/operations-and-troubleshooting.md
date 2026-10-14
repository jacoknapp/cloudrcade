# Operations and troubleshooting

[Wiki home](README.md) · [Quick start](quick-start.md) · [Configuration example](../../.env.example)

## Player troubleshooting

Start here if you use an arcade someone else runs. You do not need to edit `.env` or run Docker commands. Keep the browser/profile that holds your progress while investigating.

| Problem | Try this | If it still fails |
| --- | --- | --- |
| I cannot find my games | Open **Feeds** and load the intended feed; clear search and return to system folders | Ask the operator whether the scan finished and that game is supported |
| I cannot link Nextcloud | Check **Settings → Cloud Storage**; use Link and the connection page's visible sign-in link | Give the operator the visible error; a cloud account alone does not enable this site |
| I see Manage/Connected but my save failed | Restore connection/sign-in, check the account, and follow [save recovery](saves-and-storage.md#offline-saves-and-recovery) | Keep local data; ask for help with conflicts or revoked credentials |
| My other device has older progress | Finish saving/exiting on the first device; link the same Nextcloud account before launching on the second | Check for first-device upload errors and changed game/feed identity |
| Recently Played is empty | Check the correct account/feed and allow cloud refresh; only games matching this feed appear | Preserve cached history; report account/feed details without credentials |
| I cannot see touch buttons | Launch a game; wait for loading; resume from pause; open the edge tab and turn Controls on | Check that the device/browser is detected as touch |
| Buttons are uncomfortable | Open the touch drawer → Edit layout → drag → Save; repeat in the other orientation | See [layout editing](controls-and-menus.md#edit-a-layout) |
| There is no sound | Tap a control/menu, check Mute audio, volume and output device | Report game/browser/device; browsers can require a gesture |
| A streamed game stops or pauses | Restore the connection to the game server | Ask the operator to check file/range responses; uncached chunks need access |
| 3DS hitches on a new scene | Let new shaders compile; repeat visits can reuse observed shaders | Speed varies by game/device; see [3DS performance](streaming-offline-and-3ds.md#3ds-shaders-and-performance) |
| Dropbox is missing from Choose storage | Check `DROPBOX_ENABLED`, the public `DROPBOX_APP_KEY` and HTTPS `WEBRCADE_PUBLIC_URL`; recreate the container after environment changes | Register the exact callback from [Dropbox setup](saves-and-storage.md#enable-dropbox-saves) |
| Dropbox asks to reconnect | Link again through Choose storage; preserve browser data and pending saves | Check the app's scopes/authorization and the account's connected apps |
| A Drive/Dropbox feed link fails | Confirm it is a feed JSON file, not a folder/preview page; use the documented setup route | Ask the feed author to test direct file access and browser permissions |
| Offline launch fails | Try online in the same browser/profile; fully load/test required assets | A partly streamed game or uncached 3DS keys cannot be fixed by installing the app |

When asking for help, share the game title, selected feed, device/browser, what you clicked and exact error text. Do not share account passwords, app credentials, key files or raw browser-storage dumps. A screenshot of status with personal account details hidden can help.

## Operator troubleshooting and configuration

The rest of this page is for the person running the service. See [quick start](quick-start.md#prepare-the-deployment) for the first installation and [library administration](library-administration.md) for input directories.

## Configuration reference

The root Compose file reads `.env`. URL, branding, cloud and scanner settings are runtime configuration; recreate the service to change its environment. Editing `.env` without recreation does not update a running container. Keep the operator file out of Git.

| Group | Variables and purpose |
| --- | --- |
| Image/listener | `WEBRCADE_IMAGE` chooses an image; `WEBRCADE_BIND_ADDRESS` and `WEBRCADE_HTTPS_PORT` publish container HTTPS |
| Host mounts | `WEBRCADE_HOST_PATH` mounts the config folder at `/config`; `WEBRCADE_ROM_PATH` mounts games at `/roms` read-only. Config contains `data/`, `tls/` and optional `metadata.json`; managed games are under `roms/managed`, keys under `roms/3DS/bios`. A metadata database socket can be a third mount |
| Public URLs | `WEBRCADE_PUBLIC_URL` is the public HTTPS origin; `WEBRCADE_FEED_URL` selects the initial feed; `WEBRCADE_CONTENT_URL` prefixes generated asset URLs |
| Branding | `WEBRCADE_APP_NAME`, `WEBRCADE_FEED_TITLE`, `WEBRCADE_FEED_DESCRIPTION` set visible names/text |
| Persistent identities | `WEBRCADE_STORAGE_PREFIX`, `NEXTCLOUD_SAVE_FOLDER`; preserve these to keep selecting existing data |
| Scanner | `WEBRCADE_SCAN_ENABLED`, `WEBRCADE_SCAN_INTERVAL_SECONDS`, `WEBRCADE_ROM_ROOT`, `WEBRCADE_STATE_PATH`, `WEBRCADE_MANAGED_ROOT` |
| Share validation | `WEBRCADE_REQUIRE_ROM_MOUNT`, `WEBRCADE_REQUIRED_ROM_DIR` |
| Metadata | `WEBRCADE_METADATA_ENABLED`, `WEBRCADE_METADATA_CONFIG`, `WEBRCADE_METADATA_DB_HOST`, `WEBRCADE_METADATA_DB_PORT`, `WEBRCADE_METADATA_DB_SOCKET`, `WEBRCADE_METADATA_PATH_PREFIX`; see [metadata guide](library-administration.md#optional-gaseous-metadata) |
| 3DS | `WEBRCADE_ENABLE_3DS`, `WEBRCADE_3DS_KEYS_FILE`, `WEBRCADE_3DS_SKIP_DIRS`, `WEBRCADE_3DS_SKIP_NAMES` |
| Nextcloud | `NEXTCLOUD_URL`, `NEXTCLOUD_ENABLED`, `NEXTCLOUD_AUTO_REDIRECT`, `NEXTCLOUD_HANDOFF`, `NEXTCLOUD_CLIENT_NAME`, access-header pair and upgrade-only `NEXTCLOUD_LEGACY_URL`; see [access guide](nextcloud-and-access.md) |

Host mount variables and scanner container variables are different. For example, `WEBRCADE_ROM_PATH=./roms` selects a host directory; `WEBRCADE_ROM_ROOT=/var/www/html/content` selects where the scanner reads it inside the container. Changing one does not automatically change every container path/Apache alias.

The root Compose example leaves ROMs, managed content, derived content, external config and 3DS BIOS mounts read-only. `/data` is writable. Do not mount the Docker socket for integrated scanning. Optional shared database sockets or TLS certificates require your own explicit mount arrangement.

## Back up before changing a deployment

Preserve the app's writable data directory, including feeds, derived discs, identity/hash maps and metadata state. Preserve operator configuration separately in secure storage. ROMs, BIOS, runtime keys and TLS material belong to their own backups according to your deployment. Keep secret files out of source and build context.

Back up Nextcloud saved files through your Nextcloud backup procedure. If you keep ROM source backups in Google Drive or Dropbox, that is a separate backup of those files; verify their restore/download path and keep it separate from player save synchronization. Browser-only saves/preferences live on each player device; a server-data backup does not capture them. Before origin/namespace/account/core migrations, preserve local progress and verify a restoration path for the relevant app. Record the current image tag/digest so a code rollback can use the exact former runtime.

Do not delete data or clear browser storage as an initial troubleshooting step. Pending local saves can be the newest available progress.

## Upgrade and rollback

The public image is `ghcr.io/jacoknapp/cloudrcade:latest`. Master merges build/publish images; pull requests validate without publishing. Commit-specific `sha-<full-commit>` and `v*` tags are also published. Pin a known tag or digest when reproducibility matters.

The image works on Linux AMD64 and Linux ARM64. Use a 64-bit OS on an ARM server
or Raspberry Pi; a 32-bit ARM OS is not supported. Docker automatically pulls
the correct variant, so the Compose setup is the same for both. Both variants
are tested for startup, web serving, library scans and disc conversion before
they are published. Building your own multi-platform image is covered in
[build architecture](../architecture.md).

```sh
docker compose pull webrcade
docker compose up -d webrcade
docker compose logs --tail=100 webrcade
```

After an upgrade, verify the configured feed, scanner status, game launch/input, normal save/reload, menus/exit, cloud linking and any mounted-key game you use. Reload existing tabs to pick up updated HTML; long-running emulator sessions can retain their old core. The app preserves browser save stores and caches rather than requiring a storage wipe.

To return to a previous runtime, set `WEBRCADE_IMAGE` to its recorded tag/digest and recreate the service. Keep data and namespace settings intact. A code rollback is not a data rollback: newer save states/storage encodings may require compatibility review. In particular, retain the 3DS byte-array storage codec when reverting older 3DS cores so recently written local records remain readable. Review [architecture](../architecture.md) and relevant implementation notes before a core downgrade.

## Build and verify from source

The release image combines pinned upstream compiled assets with hash-checked overlays. Editing inherited `src/` alone does not update those shipped assets. Upstream upgrades need matching bundle hooks/hashes, core patches, license/source provenance and regression checks.

The startup update popup is an exception: [current notes](../../src/react/screens/releasenotes/notes.json) are shared by the source frontend and the patched release player. Update this file for a user-visible release. The image embeds the notes before the popup's first render; notes-only changes also receive a new player script URL. [The browser check](../../tests/browser_webrcade_updates.cjs) verifies the mobile footer, first paint and remembered dismissal in Chromium and WebKit.

```sh
python3 scripts/check-release.py
python3 scripts/test.py
python3 scripts/prepare-core.py
docker build --target web -t cloudrcade:local .
```

The checks require their documented interpreters, including PHP CLI for PHP validation/tests. Preparing a changed 3DS core requires Docker, Git, Python 3.12+, rsync and ample space; unchanged inputs can reuse the checksum-pinned public key-free package. First-time core builds are slower than overlay changes. See [architecture](../architecture.md).

Synthetic tests do not establish live SSO, physical controller behavior or phone speed. Browser/native-core tests document their staged deployment, Playwright, own-ROM and optional build-source prerequisites in their headers. Use disposable accounts/profiles and avoid modifying a player's valuable progress during verification.

## Useful diagnostics

```sh
docker compose ps
docker compose logs --tail=200 webrcade
docker compose exec webrcade python3 /usr/local/share/cloudrcade/service.py scan
```

Check `data/last-scan.json`, `data/refresh-errors.json` and the selected feed. Share sanitized counts/error text rather than secrets, credential files, ROM bytes or keys. The supervisor exits on a web-process failure so Docker's restart policy can recover it; a scanner failure retains the previous feed and retries.

## Troubleshooting by symptom

| Symptom | Check first |
| --- | --- |
| Empty first library | Startup scan still running; supported folder/extension; mounted paths and read permissions; logs |
| New game absent | Selected feed, last successful scan, unsupported/invalid format, 3DS exclusions, duplicate content |
| Old feed persists after removal | Empty or failed scans deliberately retain the last feed; inspect logs rather than deleting state |
| PlayStation scan fails | Valid BIOS set, CUE track references, chdman conversion output, writable data space |
| Feed loads but ROM fails | Generated URL, gateway authorization, binary MIME/range responses, external-feed CORS and HTTPS |
| Game pauses while streaming | Connectivity/latency, complete range response, proxy behavior; partial chunks are not offline support |
| Encrypted 3DS fails | Valid external key file, read-only mount readable inside container, configured file path, title/seed compatibility |
| No audio | Tap a game control/menu to satisfy browser gesture requirements; check Mute audio and OS output |
| Touch buttons unavailable | Running game required, controls switch, touch-device detection, loading/pause state |
| Progress absent on another device | Same Nextcloud server/user and save folder, successful previous upload, same stable game identity |
| Cloud upload error | Connectivity, account authorization, TLS, revision conflict or 64 MB bridge upload limit; retain local copy |
| Offline game fails | Same browser/profile, complete required cached files, quota/eviction, partial streaming or uncached runtime keys |
| Installed app has old presentation | Reopen/reinstall as needed; preserve saves before clearing any site data |

## Blank page after gateway sign-in

An empty Authentik callback HTTP 400 can follow a pending-session cookie lost during worker updates. Check the exact public worker-path exception, including query strings, and upgrade to the release behavior that makes no protected install-time prefetch requests. Run the [proxy checker](nextcloud-and-access.md#protect-sign-in-from-worker-updates).

For a tab already on the failed callback, begin a fresh sign-in through the outpost start route. With the example origin, the navigation is:

```text
https://arcade.example.com/outpost.goauthentik.io/start?rd=https%3A%2F%2Farcade.example.com%2F
```

Use your own URL-encoded public library URL as `rd`. A fresh navigation replaces the failed attempt; it does not require deleting local saves. If it still fails, inspect the identity provider/gateway logs and policy without weakening library/feed/ROM/key protection.
