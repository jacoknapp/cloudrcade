# Library and devices

[Wiki home](README.md) · [Controls](controls-and-menus.md) · [Saves](saves-and-storage.md)

## What the library shows

A system folder such as NES or PlayStation is a category in the currently loaded **feed**. Its games can come from the operator's server or from URLs in an imported feed. These library folders are a view of the listing; opening one does not browse your device's Downloads, Dropbox or Drive directories.

The operator creates the normal Default feed by [scanning the server's ROM folders](library-administration.md#rom-directory-layout). Players can switch to another supplied feed using Feeds. Changing feeds changes the game listing, so first confirm the selected feed if expected games disappear.

## Browse and play

The library organizes the selected feed into system folders. Open a folder, select a game, review its details and choose **Play**. The launcher loads the emulator on demand. Artwork and descriptions depend on the feed; a filename-only library works without metadata.

Desktop retains the original carousel. Touch phones and tablets use a full-viewport library in portrait or landscape. Mobile folders use console artwork, game details appear in a touch-friendly panel, and large game lists show 48 cards per page with lazy artwork. The library releases its mobile cards/details and search caches while a game runs. Returning through the emulator's native exit disposes its frame and returns you to the folder you were browsing.

System folders without custom artwork use distinct console silhouettes on desktop
and mobile, including separate Game Boy/Color, DS/3DS and Genesis/N64 designs.
Recently Played uses a red history icon. Custom feed images take precedence.

Use **Search all games** on mobile to search across the current feed's games rather than only the open folder. Clearing the search restores browsing. Search does not scan your filesystem or search every saved feed at once.

## Recently Played

After you launch a game, **Recently Played** collects up to 20 matching games, newest first. Replaying a game moves it to the front. The library initially highlights this folder when it has matching entries, but you still select it to open it. All system folders remain available.

History is stored in this browser and syncs when Nextcloud or Dropbox is the connected save provider. A second device connected to the same provider/account can receive the matching history. Games removed from the current feed are omitted from the view. The virtual folder uses the current feed's launch properties and artwork; it does not modify the shared generated feed or duplicate games in search.

On startup, the app restores the current account's cached history and fetches its cloud history automatically. You do not need to switch tabs or launch another game to make the folder appear.

## Select or import a feed

On mobile, the **Feeds** button in the main header opens the feed picker, alongside Search and Settings. **Back to Systems** stays within system-folder navigation. Desktop uses its native feed navigation. Open an existing feed card and use its native **LOAD** action to browse it; **DELETE** removes that saved feed entry. Use **Add** to open the native import dialog, which supports **URL** or **FILE** input. Use an actual webRcade-compatible feed document; a ROM file is not a feed file.

A URL feed describes where its games and assets are served. Importing it does not copy those assets to this server. A JSON-file import saves the feed in the browser and still requires access to the URLs it describes. Third-party servers may need HTTPS, suitable CORS headers and compatible file responses. Availability, access permissions and emulator support still apply.

The operator's `WEBRCADE_FEED_URL` supplies the native Default feed. Browser-selected or imported feeds can coexist with it. When troubleshooting a missing new ROM, confirm that you are viewing the operator's refreshed feed rather than another imported feed.

On a PS2 beta deployment, PS2 games also require **Settings → Experimental Settings → Enable PlayStation 2 (experimental)** followed by **OK**. This browser preference starts off and filters PS2 games from the library while disabled. It does not delete those games or their saves.

## Install the web app

1. Open the arcade in your usual browser and sign in.
2. On desktop/Android, look in the address bar or browser menu for **Install app** (wording varies). On iPhone/iPad, use Safari's Share button and **Add to Home Screen**, then confirm.
3. Open the new icon, complete sign-in if requested, and test a game and its save. Use the same cloud account if the new window has separate browser storage.

Use the browser's **Install app** or **Add to Home Screen** action, when available. The installed app opens the same site. Storage sharing between ordinary tabs and installed windows depends on the browser/platform; check your progress and cloud account before relying on it. Installation does not download the whole library or bypass site sign-in.

The manifest requests fullscreen with a standalone fallback. The app supports notches/home indicators and both orientations. iOS controls the system status bar and may keep it visible; installation cannot guarantee hiding all OS UI. Reopen or reinstall an existing installation if it keeps an older display mode. Back up valuable local progress before removing site data; removing an icon and clearing browser data are different browser actions.

Installed mode uses full display sizing for the library and game frame; ordinary browser tabs follow the visible area as browser bars change. After an update, fully close and reopen the installed app to load the new page. A dark strip below the controls is not reserved controller space; report it with your device/OS and a screenshot if it persists.

Installed iPhone/iPad apps request an opaque black system status bar to reduce iOS shading into the header or game. The page fills the available display below it, with no extra top padding when iOS owns that area. Saved controller layouts remain intact. The system effect varies by iOS version; report persistent fading with your device/OS and a screenshot.

## Device expectations

Use the same browser/profile when relying on local saves or offline files. Private browsing, another browser or another device has separate storage. Touch controls appear on touch devices; keyboard and physical gamepads remain available. Smaller desktop windows continue to use the desktop carousel when their primary pointer is a fine pointer. The compact library targets a primary coarse pointer at widths up to 1366 CSS pixels.

A browser may require an explicit tap to start audio. Keep the game tab in the foreground for predictable timing. Rotation releases held inputs and switches to the appropriate saved touch layout. Some emulator apps require cross-origin isolation for shared memory; keep the runtime's security headers intact at your proxy.

GameCube needs hardware WebGPU, shared-memory isolation and sufficient device memory; its core reserves 768 MiB of WASM memory before other browser/GPU use. The current PS2 beta needs hardware WebGPU, HTTPS (or localhost), cross-origin isolation and SharedArrayBuffer, with no WebGL or software-adapter fallback; see the [PS2 guide](../../deploy/webrcade/retro-play/README.md). A browser that runs cartridge games may not meet these requirements, and meeting them does not guarantee a particular game's speed or compatibility.
