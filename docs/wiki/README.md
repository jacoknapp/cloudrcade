# cloudЯcade wiki

[Project README](../../README.md) · [Source repository](https://github.com/jacoknapp/cloudrcade)

cloudЯcade is a website for playing an operator-supplied game library in your browser. Start with the route below that fits you. You do not need to understand server configuration to play.

## Start here

**Players:** get the website address from its operator, follow [your first game](quick-start.md#play-your-first-game), then read [controls](controls-and-menus.md) and [saves](saves-and-storage.md). If you want the same progress on another device, use the visible [Nextcloud connection screens](nextcloud-and-access.md#link-as-a-player) before launching on that device.

**Operators:** you are the person installing and maintaining the arcade. Follow [Docker quick start](quick-start.md#prepare-the-deployment), [folder layout](library-administration.md#rom-directory-layout) and [operations](operations-and-troubleshooting.md). Players need your arcade URL, their account instructions and an explanation of which cloud options you have enabled.

| I need to… | Read |
| --- | --- |
| Launch my first game, or install my first server | [Quick start](quick-start.md) |
| Browse folders, search, switch feeds or install the web app | [Library and devices](library-and-devices.md) |
| Use keyboard/gamepad/touch, pause or move buttons | [Controls and game menus](controls-and-menus.md) |
| Set up local storage, Nextcloud, Dropbox or Drive; use state slots or recover progress | [Saves and storage](saves-and-storage.md) |
| See Nextcloud status, Link, Manage, disconnect or reconnect | [Nextcloud and access](nextcloud-and-access.md) |
| Add games/BIOS and understand the server's directories | [Library administration](library-administration.md) |
| Prepare offline play or understand disc/3DS streaming | [Streaming, offline and 3DS](streaming-offline-and-3ds.md) |
| Configure, back up, upgrade or fix the server | [Operations and troubleshooting](operations-and-troubleshooting.md) |
| Understand stored data, runtime keys and license terms | [Privacy and licenses](privacy-and-licenses.md) |

## Words used in these guides

| Word | Meaning |
| --- | --- |
| Operator | The person running the website and supplying the library, cloud configuration and access policy |
| Player | Someone opening the website to play; a player may also be its operator |
| ROM/disc image | A game's data file; use content you have permission to use |
| BIOS/firmware | Console system files some emulators need; supplied separately from games |
| Emulator/core | Software that runs a console's games inside the browser |
| Feed | A JSON document listing games, systems, artwork and file URLs; it points to game files rather than containing them |
| System folder | A library category such as NES or PlayStation; the browser view of a feed |
| In-game save | Progress written by the game's own save menu or memory card system |
| Save state/slot | An emulator snapshot of a particular moment; separate from the game's own save |
| Browser profile | The particular browser user/profile that owns local saves, credentials and cached files |
| Installed web app/PWA | A shortcut that opens the same website in an app-style window |
| SSO | Single sign-on: an existing identity-provider session can help sign into the arcade/Nextcloud |

## Who supplies what

The release supplies the browser app, emulator integration and integrated scanner. The operator supplies Docker, HTTPS/access configuration, ROMs, any required BIOS/keys and optional metadata or cloud-provider configuration. Players supply their own allowed cloud account and approve the connection when needed.

[Cloud choices](saves-and-storage.md#choose-a-storage-option) explains the difference between progress synchronization and hosting source files. Connected Nextcloud or Dropbox storage synchronizes supported progress, controller preferences and Recently Played. It does not copy the ROM library to your cloud account. Offline caching stores eligible files actually loaded by a browser; it does not download every game. Streaming needs access to uncached bytes during play.

Desktop uses a carousel; phones and touch tablets use a compact full-viewport library. Games and controls vary by system. Speed and compatibility depend on the game, device and browser, particularly for 3DS. Test the game and its save behavior on the device you intend to use.

GameCube requires hardware WebGPU on the player's device. PlayStation 2 is available by default without an enable switch. See [device requirements and streaming](streaming-offline-and-3ds.md#gamecube-and-the-ps2-beta); availability does not establish game compatibility or phone performance.

## About these pages

These pages live in Git alongside the code. Generic examples use `arcade.example.com` and the root Compose service name `webrcade`; a custom deployment may use another service name. Folder examples use the root `.env.example` defaults. Follow your operator's paths if they differ.

Contributors can continue with [architecture](../architecture.md), [runtime implementation](../../deploy/webrcade/README.md) and [third-party attribution](../../THIRD_PARTY.md). The release uses a pinned upstream runtime plus verified overlays; inherited frontend source edits alone do not update the released image.
