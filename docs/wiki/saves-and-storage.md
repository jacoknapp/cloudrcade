# Saves and storage

[Wiki home](README.md) · [Nextcloud](nextcloud-and-access.md) · [Operations](operations-and-troubleshooting.md)

## Choose a storage option

There are two different jobs often called “cloud storage”: **saving your progress** and **hosting the game/feed files**. Putting a ROM in Dropbox or Google Drive does not automatically send your progress there.

| Choice | What it does here | What you need to do |
| --- | --- | --- |
| This browser | Keeps supported regular progress locally; no cloud account needed | Stay in the same browser/profile and site; avoid clearing site data |
| Nextcloud | The fork's integrated saves/state slots, controller settings and Recently Played | Operator enables its server; player Links or completes configured automatic sign-in |
| Dropbox | Shared-link ROM/feed hosting; native Dropbox save syncing is not supported end to end in this release | Follow [Dropbox hosting setup](#host-game-or-feed-files-in-dropbox) |
| Google Drive | A place to keep source files/backups and download them for the operator's library; no Drive save connection is implemented | See [Google Drive setup](#google-drive-setup) |

The fork routes game saves through its local/Nextcloud adapter. It retains some inherited Dropbox account controls, but native Dropbox save syncing is not an end-to-end supported feature of this release. Nextcloud preferences/history synchronization uses Nextcloud; hosting a ROM in Dropbox does not change that route.

If you only want to play, start with browser-local storage or ask the operator to enable Nextcloud. If you want to supply a game library, continue to [library administration](library-administration.md); the arcade does not scan a player's personal cloud folders automatically.

## Dropbox setup

### Inherited Dropbox account screen

On an origin recognized by the pinned upstream runtime, **Settings → Cloud Storage** can show **Other cloud storage**. Turning it on exposes inherited Dropbox Link/status controls. They are upstream account-authorization controls; a **Linked** status does not mean this fork uploads game saves to Dropbox. Arbitrary self-hosted origins are not in the pinned native redirect list, so most custom sites will not show this option.

There is no Dropbox OAuth application/redirect setting in the root `.env.example`. Enabling Nextcloud does not configure Dropbox. Use the local/Nextcloud path for progress in this release. The [upstream cloud guide](https://docs.webrcade.com/storage/) describes upstream linking and its normal `/Apps/webrcade` application folder; it describes upstream behavior rather than a working Dropbox save setup for this fork.

### Host game or feed files in Dropbox

No arcade account link is needed merely to read accessible shared files. The person supplying a feed can:

1. Upload a legally shareable ROM or feed JSON to Dropbox.
2. Create/copy that file's shared link and allow the intended players to download it.
3. Use a direct-file link: replace `dl=0` with `dl=1`, retaining other parameters such as `rlkey`. A preview webpage is not ROM bytes or a JSON document. See [Dropbox's direct-download instructions](https://help.dropbox.com/share/force-download).
4. Put the ROM URL in the feed's `props.rom`; put the feed URL in **Feeds → Add → URL**. See the [small feed example](library-administration.md#a-small-feed-example).
5. Test the feed and game from the intended arcade browser without relying on the file owner's Dropbox login.

The [upstream Dropbox hosting guide](https://docs.webrcade.com/feeds/resources/dropbox/) describes its direct-link handling. Use an explicit direct link before shortening URLs, because a shortener can hide the Dropbox URL from that handling. Hosting a file this way does not select Dropbox as its save destination. External Dropbox discs also do not use the fork's same-origin PlayStation streaming path.

## Google Drive setup

There is no **Link Google Drive** button, Drive save adapter or Google OAuth setting in this release. Use Drive to store your source collection/backups, then download files into the operator's server library. This is a concrete supported route; the scanner reads mounted directories rather than Google accounts.

1. In Google Drive, select a game file you are entitled to use, right-click it and choose **Download**. If someone else owns it, they must allow your account to download it. Google documents the steps and download restrictions in [Drive download help](https://support.google.com/drive/answer/2423534).
2. Extract a downloaded folder ZIP if necessary. Copy the actual supported ROM to the server's correct directory, for example `roms/nes/roms/Example.nes`. Copy files with your usual file-transfer method; do not put a `.gdoc`, shortcut or Drive link in place of the ROM.
3. Ask the operator to [run a scan](library-administration.md#scanner-lifecycle-and-output), or wait for its scheduled scan. Reload the operator's feed and launch the game.
4. If Drive holds a feed JSON instead, download that JSON and use **Feeds → Add → FILE**. The feed still needs reachable ROM/BIOS/artwork URLs; importing JSON does not import its game files.

If you need to share source files with another operator, choose **Share**, select that person's account and give suitable access. **Anyone with the link** makes a file accessible to people who have its link; it is not a private account-based save connection. See [Google's sharing instructions](https://support.google.com/drive/answer/7166529).

A Drive preview/share page is not a guaranteed direct binary/JSON endpoint. Sign-in pages, download confirmations, traffic limits and browser access rules can prevent a ROM/feed from loading. This release has no Drive-specific flow to handle those cases. Keep files on the arcade's served ROM mount or use a tested direct-file host such as the Dropbox route above. Google Drive and Google Cloud Storage buckets are different products; no bucket credentials belong in player settings.

## In-game saves and save states

An **in-game save** is progress written by the game's own save system, such as battery memory, memory cards, or the 3DS emulated SD/NAND files. Use the game's save action first; a pause menu alone is not a game save. The app's SaveManager persists the supported files and retains a local backup for regular saves. Use normal pause/exit flows and allow persistence to finish. Leave the **Disable saves** setting off when you want regular progress to load and persist; when enabled, it disables the regular game-save path.

A **save state** is an emulator snapshot stored through the native state slots where that app supports them. It can resume a particular moment but depends on emulator/core compatibility. Keep in-game saves as your durable progress when updating a core. Open the pause menu, choose **Save States** when available, select a slot and choose **Save**. To resume, return to that slot and choose **Load**; loading replaces the current running moment. **Delete** removes the selected slot. Available slots and menu wording vary by emulator, and unsupported apps do not gain slots by linking a cloud account. Thumbnails appear when capture succeeds; a missing thumbnail does not by itself prove that the state failed to save.

Nextcloud supports regular saves and native state slots through the configured cloud folder. State-slot data and its listing/thumbnail information are separate transfers; do not assume the regular-save recovery procedure guarantees an offline slot will appear or upload later. Controllers, Recently Played and shaders use their own settings/data paths. Linking cloud storage does not create a ROM backup.

## Find your Nextcloud files

Open Nextcloud itself and choose **Files**. Find the folder named by your operator's `NEXTCLOUD_SAVE_FOLDER` (the root example uses **CloudRcade**). The arcade creates game save/state files beneath that folder using emulator/game identities, plus `settings/touch-controller.v1.json` and `settings/recently-played.v1.json` for preferences/history.

Names and subpaths for game files come from the emulator rather than the library's display title. Keep them intact when backing up: renaming a file or changing the game's published identity can make it appear missing. A PlayStation save ZIP, a state-slot snapshot and a controller JSON have different jobs; do not replace one with another. The player does not need to create these files by hand.

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

1. On the first device, use the game's save action and exit normally. Allow upload work to finish and check for cloud errors.
2. On the second device, open **Settings → Cloud Storage** and connect to the same Nextcloud server/user **before** launching the game.
3. Load the same game from a feed using its existing save identity. Confirm the expected progress.
4. Stop playing on the first device while using the second. Avoid two devices writing the same save at once.

For example, saving a game on your phone and linking your tablet to the same account lets the tablet retrieve supported progress. A different Nextcloud account, unlinked browser, changed site or different game identity can show separate progress.

Uploads use conditional writes to detect changed remote versions. A conflict retains the local copy and reports an error instead of silently overwriting the other device. There is no automatic gameplay-progress merge. If a conflict occurs, stop switching devices, preserve both copies, and decide which progress to keep before making further saves.

## Offline saves and recovery

If you see a failed cloud save, keep the tab/browser profile and its data. Do not reinstall by clearing storage, delete the cloud folder or start saving from several devices while deciding which copy is newest.

1. Restore the internet connection and any required website sign-in.
2. Check Nextcloud status/account. If its credential was revoked or expired, [reconnect](nextcloud-and-access.md#manage-disconnect-and-reconnect).
3. Reopen the game with the original account and browser/profile. Eligible pending regular saves can retry; watch for an error.
4. If the error says the save changed on another device, stop and preserve both copies. Ask the operator for help deciding which progress to keep. The app does not provide a gameplay-progress merge or a universal one-click conflict resolver.

Cloud transfers require a connection, but supported regular saves keep local backups. A failed upload records pending progress and the remote revision against which it was attempted. On restart, pending local progress loads first; upload proceeds only if the remote version still matches. An older cloud copy does not silently replace that pending progress.

If an upload response is lost, recovery checks whether the attempted game data already reached Nextcloud. Recovery metadata stays in the local ZIP and is stripped from emulator/cloud save files. Browser Web Locks serialize related local operations where supported. Keep the same browser/profile and do not clear storage while diagnosing pending uploads.

The app reports cloud errors; inspect them before assuming another device has the latest save. Reconnect or reload to retry eligible pending work. Repeated conflicts need a deliberate choice of progress, not repeated save attempts on multiple devices.

## Account and namespace boundaries

Local backups are scoped to the connected server and user. Changing accounts while a game is running requires reopening the game before cloud operations; the existing game's final local save stays with its original profile. Another account does not automatically inherit the previous account's backups or queued settings. Existing legacy backups are retained by the explicit upgrade migration rather than reassigned to every new account.

Operators should keep `WEBRCADE_STORAGE_PREFIX`, `NEXTCLOUD_SAVE_FOLDER`, the public site origin, and published game identities stable across upgrades. Changing a namespace/folder selects another storage location; it does not rename or delete old files. Changing site origin also changes browser storage access. Plan a migration and preserve the old data before changing these identities.

**Disconnect** revokes the browser's Nextcloud app credential and leaves remote save files in place. Clearing site data removes the browser connection and local data; it does not erase the Nextcloud folder. Revocation can also be performed through Nextcloud's own account settings.

## History and controller preferences

Recently Played merges each game's latest timestamp across connected devices and keeps the newest 20 matching entries. Local history imports on first connection; account changes do not import another account's history. Reconnection, reload and returning to the tab refresh history.

On startup, the app restores the connected account's cached history immediately and loads its Nextcloud history automatically. Cached entries remain available when that request fails or you are offline; matching games appear as soon as the feed is ready.

Controller settings merge preferences and per-platform/orientation layouts independently. Explicit later edits win for the same setting/layout. Save publishes a layout; Cancel does not. Arriving cloud preferences do not discard unsaved layout drags. Offline edits retry for the account to which they belong.

## Clocks and 3DS auxiliary data

SameBoy GB/GBC cartridge clocks synchronize to local time and weekday while preserving RTC behavior; English retail Pokémon Gold/Silver/Crystal offsets are compensated. Other game-defined calendars can differ. GBA/DS retain their native host-clock handling. Supported RTC sidecars travel as `clock.rtc` in ordinary save ZIPs; older saves without them remain usable.

3DS ordinary saves include SD/NAND and shader data, while external decryption keys are excluded. Shader caches depend on the graphics-driver tag and observed shaders; copying a cache does not guarantee that every scene is precompiled. Failed shader-link reports may persist locally and sync to the connected cloud account. See [privacy](privacy-and-licenses.md) before sharing diagnostics.
