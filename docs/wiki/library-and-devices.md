# Library and devices

[Wiki home](README.md) · [Controls](controls-and-menus.md) · [Saves](saves-and-storage.md)

## Browse and play

The library organizes the selected feed into system folders. Open a folder, select a game, review its details and choose **Play**. The launcher loads the emulator on demand. Artwork and descriptions depend on the feed; a filename-only library works without metadata.

Desktop retains the original carousel. Touch phones and tablets use a full-viewport library in portrait or landscape. Mobile folders use console artwork, game details appear in a touch-friendly panel, and large game lists show 48 cards per page with lazy artwork. The library releases its mobile cards/details and search caches while a game runs. Returning through the emulator's native exit disposes its frame and returns you to the folder you were browsing.

System folders without custom artwork use distinct console silhouettes on desktop
and mobile, including separate Game Boy/Color, DS/3DS and Genesis/N64 designs.
Recently Played uses a red history icon. Custom feed images take precedence.

Use **Search all games** on mobile to search across the current feed's games rather than only the open folder. Clearing the search restores browsing. Search does not scan your filesystem or search every saved feed at once.

## Recently Played

After you launch a game, **Recently Played** collects up to 20 matching games, newest first. Replaying a game moves it to the front. The library initially highlights this folder when it has matching entries, but you still select it to open it. All system folders remain available.

History is stored in this browser and syncs when Nextcloud is connected. A second linked device can receive the matching history. Games removed from the current feed are omitted from the view. The virtual folder uses the current feed's launch properties and artwork; it does not modify the shared generated feed or duplicate games in search.

## Select or import a feed

On mobile, the **Feeds** button in the main header opens the feed picker, alongside Search and Settings. **Back to Systems** stays within system-folder navigation. Desktop uses its native feed navigation. Open an existing feed card and use its native **LOAD** action to browse it; **DELETE** removes that saved feed entry. Use **Add** to open the native import dialog, which supports **URL** or **FILE** input. Use an actual webRcade-compatible feed document; a ROM file is not a feed file.

A URL feed describes where its games and assets are served. Importing it does not copy those assets to this server. A JSON-file import saves the feed in the browser and still requires access to the URLs it describes. Third-party servers may need HTTPS, suitable CORS headers and compatible file responses. Availability, access permissions and emulator support still apply.

The operator's `WEBRCADE_FEED_URL` supplies the native Default feed. Browser-selected or imported feeds can coexist with it. When troubleshooting a missing new ROM, confirm that you are viewing the operator's refreshed feed rather than another imported feed.

## Install the web app

Use the browser's **Install app** or **Add to Home Screen** action, when available. The installed app opens the same site and uses that site's browser storage. Installation does not download the whole library or bypass site sign-in.

The manifest requests fullscreen with a standalone fallback. The app supports notches/home indicators and both orientations. iOS controls the system status bar and may keep it visible; installation cannot guarantee hiding all OS UI. Reopen or reinstall an existing installation if it keeps an older display mode. Back up valuable local progress before removing site data; removing an icon and clearing browser data are different browser actions.

## Device expectations

Use the same browser/profile when relying on local saves or offline files. Private browsing, another browser or another device has separate storage. Touch controls appear on touch devices; keyboard and physical gamepads remain available. Smaller desktop windows continue to use the desktop carousel when their primary pointer is a fine pointer. The compact library targets a primary coarse pointer at widths up to 1366 CSS pixels.

A browser may require an explicit tap to start audio. Keep the game tab in the foreground for predictable timing. Rotation releases held inputs and switches to the appropriate saved touch layout. Some emulator apps require cross-origin isolation for shared memory; keep the runtime's security headers intact at your proxy.
