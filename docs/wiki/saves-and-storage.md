# Saves and storage

[Wiki home](README.md) · [Nextcloud](nextcloud-and-access.md) · [Operations](operations-and-troubleshooting.md)

## In-game saves and save states

An **in-game save** is progress written by the game's own save system, such as battery memory, memory cards, or the 3DS emulated SD/NAND files. Use the game's save action first. The app's SaveManager persists the supported files and retains a local backup for regular saves. Use normal pause/exit flows and allow persistence to finish.

A **save state** is an emulator snapshot stored through the native state slots where that app supports them. It can resume a particular moment but depends on emulator/core compatibility. Keep in-game saves as your durable progress when updating a core. Available slots and menu wording vary by emulator. Thumbnails appear when capture succeeds; a missing thumbnail does not by itself prove that the state failed to save.

Nextcloud supports regular saves and native state slots through the configured cloud folder. Controllers, Recently Played and shaders use their own settings/data paths. Linking cloud storage does not create a ROM backup.

## What lives where

| Data | Location and behavior |
| --- | --- |
| Regular local progress and recovery records | Browser storage, scoped to the unlinked profile or connected Nextcloud server/user |
| Native save-state slots | App's normal storage path, with cloud operations when linked |
| Nextcloud game saves/states | Connected user's Files beneath `NEXTCLOUD_SAVE_FOLDER` |
| Controller layouts/preferences | Browser storage; optional Nextcloud `settings/touch-controller.v1.json` |
| Recently Played | Browser storage; optional Nextcloud `settings/recently-played.v1.json` |
| Offline emulator/ROM assets | Separate browser asset cache, subject to quota and eviction |
| Scanner feeds, hashes and derived discs | Operator's writable `WEBRCADE_HOST_PATH` data directory |

A Docker data backup does not include saves that exist only in a player's browser or Nextcloud account. Likewise, clearing browser data can remove local progress even while the server's ROMs and feeds remain intact.

## Moving to another device

Connect both browsers to the same Nextcloud server and user. On the first device, finish the game's save and exit, then check for cloud errors. On the second, establish the cloud connection before launching the game. Avoid playing the same save simultaneously on two devices.

Uploads use conditional writes to detect changed remote versions. A conflict retains the local copy and reports an error instead of silently overwriting the other device. There is no automatic gameplay-progress merge. If a conflict occurs, stop switching devices, preserve both copies, and decide which progress to keep before making further saves.

## Offline saves and recovery

Cloud transfers require a connection, but supported regular saves keep local backups. A failed upload records pending progress and the remote revision against which it was attempted. On restart, pending local progress loads first; upload proceeds only if the remote version still matches. An older cloud copy does not silently replace that pending progress.

If an upload response is lost, recovery checks whether the attempted game data already reached Nextcloud. Recovery metadata stays in the local ZIP and is stripped from emulator/cloud save files. Browser Web Locks serialize related local operations where supported. Keep the same browser/profile and do not clear storage while diagnosing pending uploads.

The app reports cloud errors; inspect them before assuming another device has the latest save. Reconnect or reload to retry eligible pending work. Repeated conflicts need a deliberate choice of progress, not repeated save attempts on multiple devices.

## Account and namespace boundaries

Local backups are scoped to the connected server and user. Changing accounts while a game is running requires reopening the game before cloud operations; the existing game's final local save stays with its original profile. Another account does not automatically inherit the previous account's backups or queued settings. Existing legacy backups are retained by the explicit upgrade migration rather than reassigned to every new account.

Operators should keep `WEBRCADE_STORAGE_PREFIX`, `NEXTCLOUD_SAVE_FOLDER`, the public site origin, and published game identities stable across upgrades. Changing a namespace/folder selects another storage location; it does not rename or delete old files. Changing site origin also changes browser storage access. Plan a migration and preserve the old data before changing these identities.

**Disconnect** revokes the browser's Nextcloud app credential and leaves remote save files in place. Clearing site data removes the browser connection and local data; it does not erase the Nextcloud folder. Revocation can also be performed through Nextcloud's own account settings.

## History and controller preferences

Recently Played merges each game's latest timestamp across connected devices and keeps the newest 20 matching entries. Local history imports on first connection; account changes do not import another account's history. Reconnection, reload and returning to the tab refresh history.

Controller settings merge preferences and per-platform/orientation layouts independently. Explicit later edits win for the same setting/layout. Save publishes a layout; Cancel does not. Arriving cloud preferences do not discard unsaved layout drags. Offline edits retry for the account to which they belong.

## Clocks and 3DS auxiliary data

SameBoy GB/GBC cartridge clocks synchronize to local time and weekday while preserving RTC behavior; English retail Pokémon Gold/Silver/Crystal offsets are compensated. Other game-defined calendars can differ. GBA/DS retain their native host-clock handling. Supported RTC sidecars travel as `clock.rtc` in ordinary save ZIPs; older saves without them remain usable.

3DS ordinary saves include SD/NAND and shader data, while external decryption keys are excluded. Shader caches depend on the graphics-driver tag and observed shaders; copying a cache does not guarantee that every scene is precompiled. Failed shader-link reports may persist locally and sync to the connected cloud account. See [privacy](privacy-and-licenses.md) before sharing diagnostics.
