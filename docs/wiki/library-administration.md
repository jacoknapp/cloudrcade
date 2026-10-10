# Library administration

[Wiki home](README.md) · [Quick start](quick-start.md) · [Streaming and 3DS](streaming-offline-and-3ds.md)

## ROM directory layout

The root Compose file mounts `WEBRCADE_ROM_PATH` (default `./roms`) read-only at `/var/www/html/content`. The scanner's `WEBRCADE_ROM_ROOT` uses that container path. Most systems scan recursively below `<folder>/roms`; 3DS scans below `3DS` directly. Folder spelling and case matter on case-sensitive filesystems.

| Folder | System | Scanner extensions |
| --- | --- | --- |
| `nes/roms` | NES | `.nes` |
| `snes/roms` | SNES | `.sfc`, `.smc` |
| `gb/roms` | Game Boy | `.gb` |
| `gbc/roms` | Game Boy Color | `.gbc` |
| `gba/roms` | Game Boy Advance | `.gba` |
| `n64/roms` | Nintendo 64 | `.z64`, `.v64`, `.n64` |
| `nds/roms` | Nintendo DS | `.nds` |
| `segaMD/roms` | Genesis | `.bin`, `.gen`, `.smd`, `.md` |
| `psx/roms` | PlayStation | `.chd`, `.pbp`, `.cue` |
| `3DS` | Nintendo 3DS | `.cia`, `.3ds`, `.cci` |

These are the integrated scanner's supported formats, not an exhaustive list of formats/apps possible in a hand-written webRcade feed. A matching extension does not guarantee a valid or compatible game. The scanner validates 3DS headers and application titles, excludes updates/DLC/system titles and known unsupported seed-protected titles, and applies operator exclusions. It also routes `.smc` files directly under `nes/roms` to SNES for compatibility with a misfiled library.

## BIOS files

Supply your own required BIOS files. For generated PlayStation entries, `psx/bios` must contain either the scanner's validated `PSXONPSP660.BIN` variant or all three validated `scph5500.bin`, `scph5501.bin` and `scph5502.bin` files. The scanner checks their expected hashes. Missing or mismatching PlayStation BIOS prevents publishing a scan containing PlayStation games.

For DS, `nds/bios/bios7.bin`, `bios9.bin` and `firmware.bin` are included in the generated feed when all three exist. Actual emulator/game requirements still apply. Other custom feeds may specify their own app-specific BIOS properties.

Encrypted 3DS games use external Citra-format `aes_keys.txt` through a separate read-only BIOS mount, not a public feed property containing keys. See [3DS key setup](streaming-offline-and-3ds.md#3ds-setup). No ROM, BIOS, key set or console backup is bundled.

## Scanner lifecycle and output

`WEBRCADE_SCAN_ENABLED=true` enables a startup scan and repeated scans at `WEBRCADE_SCAN_INTERVAL_SECONDS` (default `21600`, six hours). The app image contains Python, chdman and metadata tooling; no separate scanner service or Docker socket is needed for normal operation.

Request an immediate scan:

```sh
docker compose exec webrcade python3 /usr/local/share/cloudrcade/service.py scan
```

Only one scan runs at a time. Files are deduplicated, hashes are reused for unchanged files, and feeds are published atomically. Empty/unavailable libraries and failed disc conversion retain the last complete feed. A scheduled failure retries at the next interval. Metadata lookup failure can fall back to cached metadata or filenames instead of failing the entire scan.

| Data file/directory | Purpose |
| --- | --- |
| `data/feeds/combined.json` | Initial combined library feed |
| `data/feeds/<system>.json` | Per-system feeds |
| `data/derived/` | Converted PlayStation discs, served read-only |
| `data/hash-cache.json` | Cached file identities/stat signatures |
| `data/psx-save-ids.json` | Stable published PlayStation disc save IDs |
| `data/metadata-cache.json` | Last available metadata rows |
| `data/last-scan.json` | Last successful completion, counts and metadata source |
| `data/refresh-errors.json` | Disc conversion errors, removed after success |

Paths above use `WEBRCADE_HOST_PATH=./data`. Apache serves feeds through an alias from the state mount; do not create a nested writable feed mount inside the ROM share. Preserve `psx-save-ids.json` and existing feeds during migrations to retain published save identities.

CUE input is converted to a derived CHD using its referenced track bytes. Original CUE/BIN files remain unchanged. Missing tracks or conversion errors stop feed publication. Allow adequate data-directory space and scan time for large disc collections. The scanner deduplicates identical content; duplicates may increase the scanned count without increasing entries.

## Optional Gaseous metadata

Metadata is disabled by default. Without it, filenames supply titles. With a supported Gaseous database, matching rows can supply titles, descriptions and IGDB cover URLs. Most systems match hashes; 3DS matches filenames to avoid hashing multi-gigabyte files.

Mount an external JSON credential file under the host directory selected by `WEBRCADE_CONFIG_PATH` (default `./config`). Set:

```dotenv
WEBRCADE_METADATA_ENABLED=true
WEBRCADE_METADATA_CONFIG=/run/cloudrcade/config/metadata.json
WEBRCADE_METADATA_DB_HOST=database.example.com
WEBRCADE_METADATA_DB_PORT=3306
```

The JSON's `DatabaseConfiguration` supplies `UserName`, `Password` and `DatabaseName`. Use an appropriate read-only database account and a reachable, protected database connection. Keep credentials outside Git and release images. The scanner passes the password through its child environment rather than command-line arguments.

Alternatively, add a read-only shared MariaDB socket-directory mount to your own Compose configuration and set `WEBRCADE_METADATA_DB_SOCKET` to its path inside the app. Socket transport takes precedence over TCP host/port. The database container must also share that directory. The root example does not add a socket mount for you.

`WEBRCADE_METADATA_PATH_PREFIX` can map Gaseous catalog paths into `WEBRCADE_MANAGED_ROOT` (root example `/var/www/html/managed`, mounted from `WEBRCADE_MANAGED_PATH`). The legacy `WEBRCADE_METADATA_CONTAINER` option is for host-run scanner compatibility; integrated operation should use direct TCP/socket mode and needs no Docker socket.

## Mount guards and exclusions

`WEBRCADE_REQUIRED_ROM_DIR` requires a particular directory below the scanner root. `WEBRCADE_REQUIRE_ROM_MOUNT` optionally requires the root to be a mountpoint. Use these when they match your storage layout so an absent share does not look like a valid replacement library.

`WEBRCADE_ENABLE_3DS=false` omits 3DS from generated feeds. `WEBRCADE_3DS_SKIP_DIRS` and `WEBRCADE_3DS_SKIP_NAMES` are pipe-separated directory components and filename stems to exclude. These are scanner settings; a player's experimental 3DS setting is separate. Recreate the container after environment changes and run/review a scan.
