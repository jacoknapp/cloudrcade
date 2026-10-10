# cloudRcade

[![Docker release](https://github.com/jacoknapp/cloudrcade/actions/workflows/docker.yml/badge.svg)](https://github.com/jacoknapp/cloudrcade/actions/workflows/docker.yml)

**cloudЯcade** (cloudRcade, with a backwards R) is an independent, self-hosted fork of [webRcade](https://github.com/webrcade/webrcade)
with Nextcloud saves, editable mobile controls, offline caching, Recently Played,
clock support, PlayStation disc streaming and an Azahar-based Nintendo 3DS app.
It preserves upstream history and credits; it is not an official webRcade release.

## Run with Docker

```sh
git clone https://github.com/jacoknapp/cloudrcade.git
cd cloudrcade
cp .env.example .env
mkdir -p roms/nes/roms roms/3DS/bios data/feeds data/derived managed config
# Edit .env for your public HTTPS origin, paths, cloud options and branding.
docker compose up -d
```

Open your configured HTTPS origin. The default listener is `127.0.0.1:8443`;
place it behind your HTTPS gateway or change the bind address for your network.
ROMs and BIOS are supplied by the operator and mounted read-only. Most systems
use `roms/<system>/roms/` and `roms/<system>/bios/`; 3DS games can live below
`roms/3DS/`. The scanner writes feeds and derived discs into `data/`, preserving
the ROM originals. The same app container scans at startup and refreshes every six hours. Set
`WEBRCADE_SCAN_ENABLED` and `WEBRCADE_SCAN_INTERVAL_SECONDS` to control it.
The initial library can be empty while the first scan runs. Request an immediate
refresh with `docker compose exec webrcade python3 /usr/local/share/cloudrcade/service.py scan`.
Optional metadata integration is disabled by default.

The single image is `ghcr.io/jacoknapp/cloudrcade:latest`. Every merge to `master`
builds and publishes it; pull requests build and validate without publishing.
Commit-specific `sha-<full-commit>` tags and `v*` release tags are also published.
CI authenticates using GitHub's built-in token; no Docker Hub secret is required.

## Internet connection for streamed games

**PlayStation and Nintendo 3DS ROM/disc streaming requires an active internet
connection during play.** Game data is fetched as needed. PlayStation CHD/PBP
discs stream through HTTP byte ranges; the 3DS loader streams ROMs larger than
512 MiB. Keep the connection available for uncached portions of the file.
Partially streamed files are not complete offline games. Offline play requires
all required game, emulator and BIOS assets to have been fully downloaded and
cached; runtime 3DS keys are fetched separately and are never cached.

**3DS caches shaders as they are created.** The first encounter with a new
shader can cause hitching. Encountering many new shaders at once can cause
larger pauses, especially on mobile devices; cached shaders reduce repeat work.

## Nextcloud and SSO

Set `NEXTCLOUD_URL` and `NEXTCLOUD_ENABLED=true` to make Nextcloud available.
Set `NEXTCLOUD_AUTO_REDIRECT=true` to start login automatically. These flags are
independent: disabling automatic login leaves the **Link** button available.
Other cloud choices retain their normal setup flow.

For automatic authorization with an existing Nextcloud/Authentik session,
install the [optional Nextcloud handoff app](integrations/nextcloud/README.md),
configure its exact trusted origin/client and existing SAML provider, then set
`NEXTCLOUD_HANDOFF=true`. The default native Nextcloud flow retains Nextcloud's
approval screen. Existing SSO can pass through without another login; the
identity provider can still require authentication or MFA when its policy does.

Denied access returns to the library and displays: “No access has been enabled
for Nextcloud. Please enable your own cloud instance.” Optional access-header
hints are configured through the environment; Nextcloud still authorizes grants.
URLs, feature flags, origins, paths, app name, storage namespace and save folder
come from `.env`. Keep the namespace and save folder stable when upgrading to
preserve the selected save locations. Existing deployments can keep their
previous branding and namespace by setting those variables explicitly.

## 3DS BIOS and keys

The release includes a key-free 3DS emulator. Encrypted games need your own
compatible Citra-format `aes_keys.txt` in the mounted BIOS directory selected
by `WEBRCADE_3DS_BIOS_PATH`. `WEBRCADE_3DS_KEYS_FILE` selects its container path.
Decrypted games can run without it. No key set, BIOS, ROM or console backup is
provided. Builds remove upstream preset keys before compilation.

The authorized browser reads the mounted keys into emulator memory at runtime;
the endpoint uses `no-store` and same-origin restrictions. Keys are excluded
from source control, build contexts, offline assets and ordinary battery-save
ZIPs. See [3DS setup and limitations](deploy/webrcade/retro-azahar/README.md#runtime-decryption-keys).

## Development and licensing

See [configuration and features](deploy/webrcade/README.md),
[build architecture](docs/architecture.md), and [third-party licenses](THIRD_PARTY.md).
The release uses a pinned upstream runtime with hash-checked overlays; inherited
frontend source edits require an explicit source-build upgrade or overlay port.
Run `python3 scripts/check-release.py` and `python3 scripts/test.py` to validate
portable source and synthetic tests. Browser/native-core tests are documented
in their headers and require your own staged deployment/build sources.

The frontend and our standalone deployment additions use Apache 2.0, with
upstream attribution retained. Emulator cores and the optional Nextcloud app
have separate licenses, including GPL/AGPL and noncommercial terms. The full
core bundle must not be treated as wholly Apache-licensed or unrestricted for
commercial redistribution. The modified 3DS corresponding source ships in the
image at `/licenses/sources/3ds-source.tar.gz`. See [LICENSE](LICENSE),
[NOTICE](NOTICE), and [THIRD_PARTY.md](THIRD_PARTY.md).
