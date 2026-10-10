# Operations and troubleshooting

[Wiki home](README.md) · [Quick start](quick-start.md) · [Configuration example](../../.env.example)

## Configuration reference

The root Compose file reads `.env`. URL, branding, cloud and scanner settings are runtime configuration; recreate the service to change its environment. Editing `.env` without recreation does not update a running container. Keep the operator file out of Git.

| Group | Variables and purpose |
| --- | --- |
| Image/listener | `WEBRCADE_IMAGE` chooses an image; `WEBRCADE_BIND_ADDRESS` and `WEBRCADE_HTTPS_PORT` publish container HTTPS |
| Host mounts | `WEBRCADE_HOST_PATH`, `WEBRCADE_ROM_PATH`, `WEBRCADE_MANAGED_PATH`, `WEBRCADE_CONFIG_PATH`, `WEBRCADE_3DS_BIOS_PATH` select data/ROM/managed/config/key directories |
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

Back up Nextcloud saved files through your Nextcloud backup procedure. Browser-only saves/preferences live on each player device; a server-data backup does not capture them. Before origin/namespace/account/core migrations, preserve local progress and verify a restoration path for the relevant app. Record the current image tag/digest so a code rollback can use the exact former runtime.

Do not delete data or clear browser storage as an initial troubleshooting step. Pending local saves can be the newest available progress.

## Upgrade and rollback

The public image is `ghcr.io/jacoknapp/cloudrcade:latest`. Master merges build/publish images; pull requests validate without publishing. Commit-specific `sha-<full-commit>` and `v*` tags are also published. Pin a known tag or digest when reproducibility matters.

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
