# Library administration

[Wiki home](README.md) · [Quick start](quick-start.md) · [Streaming and 3DS](streaming-offline-and-3ds.md)

## Who manages the files

This page is for the operator. Players browse the resulting system folders; they do not need to create server directories. The scanner reads files on your server and creates the library listing. It does not download games, scan personal Dropbox/Drive accounts or provide BIOS files.

Three locations are easy to confuse:

| Location | Contains | Example |
| --- | --- | --- |
| Server's ROM directory | Original game and BIOS files supplied by the operator | `roms/nes/roms/Example.nes` |
| Server's data directory | Generated feeds, scan records and converted discs | `data/feeds/combined.json` |
| Player's browser/Nextcloud | That player's progress and preferences | Browser-local storage or their configured Nextcloud save folder |

A directory named `roms` inside a system folder is where its games go. A directory named `bios` holds that system's BIOS/firmware. A **feed** is a JSON list of file URLs; it does not contain the games themselves. Do not put player saves in the server's ROM directory.

## ROM directory layout

For the default configuration, create only the system folders you need. This example shows a few systems; use the table below for all supported folder names:

```text
cloudrcade/
├── .env                         Your deployment settings (keep private)
├── compose.yaml                 Starts the application container
├── roms/                        Original library: read-only in the app
│   ├── nes/
│   │   └── roms/Example.nes
│   ├── snes/
│   │   └── roms/Example.sfc
│   ├── nds/
│   │   ├── roms/Example.nds
│   │   └── bios/                bios7.bin, bios9.bin, firmware.bin
│   ├── psx/
│   │   ├── roms/                CHD/PBP or CUE plus its BIN tracks
│   │   └── bios/                Required validated PlayStation BIOS
│   └── 3DS/
│       ├── Games/Example.3ds    3DS games may be directly here or nested
│       └── bios/                Your external aes_keys.txt, if needed
├── data/                        Writable generated data
│   ├── feeds/combined.json     Created by a successful scan
│   └── derived/                Converted discs; originals stay in roms/
├── managed/                     Optional externally managed game files
└── config/                      Optional external metadata credentials
```

**Do not add `roms/3DS/roms/` merely to match the other systems.** The 3DS scanner searches beneath `3DS/` directly, including subfolders. The `3DS/bios/` directory is mounted separately for runtime keys. Use the exact system spelling: `segaMD` and `3DS` are case-sensitive examples.

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
| `psp/roms` | PSP | `.iso`, `.cso`, `.pbp`, `.elf` |
| `psx/roms` | PlayStation | `.chd`, `.pbp`, `.cue` |
| `PS2` or `ps2` | PlayStation 2 (experimental beta) | `.iso`, `.chd` v5, homebrew `.elf` |
| `3DS` | Nintendo 3DS | `.cia`, `.3ds`, `.cci` |

These are the integrated scanner's supported formats, not an exhaustive list of formats/apps possible in a hand-written webRcade feed. A matching extension does not guarantee a valid or compatible game. The scanner validates 3DS headers and application titles, excludes updates/DLC/system titles and known unsupported seed-protected titles, and applies operator exclusions. It also routes `.smc` files directly under `nes/roms` to SNES for compatibility with a misfiled library.

## Add your first game or another game

1. Identify its system and supported file extension in the table above. A ZIP containing a game needs extraction for this scanner; `.zip` is not one of its listed input formats.
2. Copy the file under that system's ROM directory, for example `roms/gb/roms/Example.gb`. You can use subfolders to organize games. For a PlayStation CUE, keep its referenced track files available alongside it or at the paths the CUE names.
3. Supply required BIOS files using the next section. Grant the container read access to originals and write access to `data/`.
4. Wait for the next scan or run the command under [Scanner lifecycle and output](#scanner-lifecycle-and-output).
5. Read the logs and `data/last-scan.json`. Reload the library's operator feed, open the system folder and test the new game.

For a game stored in Drive, first follow [Google Drive setup](saves-and-storage.md#google-drive-setup). If you want direct Dropbox hosting instead of copying files to the server, use a [custom feed](#a-small-feed-example); the integrated scanner does not enumerate shared cloud links.

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

## A small feed example

You normally let the scanner create the Default feed. Use your own feed when you need to list directly hosted files, such as a Dropbox ROM. Here is a minimal NES feed:

```json
{
  "title": "My games",
  "categories": [{
    "title": "NES",
    "items": [{
      "title": "Example",
      "type": "nes",
      "props": {"rom": "https://files.example.com/games/Example.nes"}
    }]
  }]
}
```

Replace the example URL with a tested direct ROM URL; for Dropbox use its direct shared link. Save this text as `my-games.json`, then open **Feeds → Add → FILE** and select it. Alternatively, host the JSON as a reachable direct file and use **Add → URL**. Load the resulting feed entry to browse it.

The title controls the visible name; `categories` create system folders; `items` list games; `type` selects an emulator; `props.rom` points to game bytes. This simple example needs no artwork. Other systems can need different properties, BIOS or disc lists: follow the [upstream feed format](https://docs.webrcade.com/feeds/format/) rather than guessing from NES.

The feed's host and each ROM's host need suitable HTTPS/access/CORS behavior. A browser needs permission to fetch the file from a different website (**CORS**); being able to open a preview page is not enough. Linking Nextcloud does not grant access to a Dropbox/Drive ROM. Do not hand-edit `data/feeds/combined.json` for lasting custom entries: the next successful scanner run regenerates it. Keep your custom feed separately.

## Metadata on demand

CloudRcade can fetch metadata directly from IGDB when a game is selected in the
library. Provider credentials stay server-side in `/config/metadata.json`:

```json
{"IGDBConfiguration":{"ClientId":"your-client-id","Secret":"your-client-secret"}}
```

Set `WEBRCADE_METADATA_ENABLED=true`. Cached results are reused, requests are
serialized and bounded, and missing credentials/provider outages never prevent
launching games. Existing imported metadata remains available in the local cache;
no Gaseous service, database, SQL client or socket is required. New lookups are
cached under `data/metadata/` and included in subsequent feed scans. Keep the
metadata credential file readable only by the container's root/www-data group
(mode0640, host GID33). Never store credentials under the public ROM tree.

Deploy with a writable config folder at `/config` and read-only games at `/roms`.
Config contains `data/`, `tls/` and optional `metadata.json`; games keep their
normal system folders, managed imports use `managed/`, and the 3DS key stays in
`3DS/bios/aes_keys.txt`. Existing internal paths are mapped inside the image, so
public game/feed URLs and save identities remain stable.
