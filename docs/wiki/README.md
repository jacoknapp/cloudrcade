# cloudЯcade wiki

[Project README](../../README.md) · [Source repository](https://github.com/jacoknapp/cloudrcade)

cloudЯcade is a self-hosted browser arcade based on webRcade. A feed describes your games; the browser loads the appropriate emulator when you launch one. The Docker image also builds feeds from an operator-supplied ROM library. Games, BIOS files, decryption keys, Nextcloud accounts and an HTTPS gateway are supplied separately.

This wiki lives in Git with the code. The project README gives the release overview and short installation instructions; these pages explain everyday use and operating a deployment. Examples use generic hosts and the root repository's Compose service name, `webrcade`, even though the app and image are named cloudЯcade/cloudrcade. A custom Compose deployment may use a different service name.

## Start here

| Task | Guide |
| --- | --- |
| Start a Docker deployment and launch your first game | [Quick start](quick-start.md) |
| Browse, search, switch feeds, install the web app | [Library and devices](library-and-devices.md) |
| Use touch, keyboard and gamepad controls; pause or edit layouts | [Controls and game menus](controls-and-menus.md) |
| Preserve progress, understand save states and recover failed uploads | [Saves and storage](saves-and-storage.md) |
| Link Nextcloud, configure automatic login, or operate SSO | [Nextcloud and access](nextcloud-and-access.md) |
| Add ROMs/BIOS, understand scanner output and metadata | [Library administration](library-administration.md) |
| Understand streamed games, offline caching and 3DS limitations | [Streaming, offline and 3DS](streaming-offline-and-3ds.md) |
| Configure, build, upgrade, back up and diagnose the app | [Operations and troubleshooting](operations-and-troubleshooting.md) |
| Review data handling and redistribution conditions | [Privacy and licenses](privacy-and-licenses.md) |

## Choose your role

**Players:** obtain the arcade URL from its operator, open it in a browser, complete any site sign-in, select a system folder and a game, then choose **Play**. Read the controls and saves guides before relying on progress across devices. Installing the web app is optional.

**Operators:** start with Docker quick start, then library administration and operations. Nextcloud and SSO are optional. A local-only arcade can use browser-local saves, but remote device access and service workers require a suitable secure browser context. The public deployment should use HTTPS.

**Contributors:** see [build architecture](../architecture.md), [runtime implementation documentation](../../deploy/webrcade/README.md) and [third-party attribution](../../THIRD_PARTY.md). The shipped frontend comes from a pinned upstream runtime plus verified overlays; inherited frontend source edits alone do not change the release image.

## What to expect

Desktop uses the upstream carousel. Phones and touch tablets use the compact library and native game launcher. Emulator performance and compatibility vary by system, game, browser and device. Linux browser automation is useful regression evidence, but it does not establish full-speed playback or compatibility on a physical phone.

Nextcloud adds account-scoped saves, controller preferences and Recently Played synchronization. It does not synchronize your ROM collection. Offline caching stores eligible assets actually loaded by the browser; it does not pre-download every game. Streamed PlayStation discs and 3DS ROMs need a connection for uncached data, and external 3DS keys are never cached.
