# Privacy and licenses

[Wiki home](README.md) · [Nextcloud boundaries](nextcloud-and-access.md#credential-boundaries) · [Third-party notices](../../THIRD_PARTY.md)

## Before connecting or sharing files

Nextcloud **Link** approves a browser connection for game progress. Nextcloud **Manage → Disconnect this browser** revokes it while leaving remote files intact. The arcade shows connection/account status; check it on shared devices. Keep your browser profile trusted because it holds saves and the remembered credential.

Dropbox ROM/feed sharing and Google Drive file sharing are separate from save synchronization. People who can fetch a shared file URL can obtain that file. Do not put private BIOS/key material in shared links or public feeds. Google also explains that shared-file owner information can be visible in its [sharing help](https://support.google.com/drive/answer/2494822).

## Data handled by the app

cloudЯcade stores local progress, controller preferences, Recently Played and eligible offline assets in browser storage. Nextcloud connection credentials are also retained by the browser when linked. These belong to the site's origin and profile; another origin/browser does not share them automatically.

When linked, the app sends supported saves, state slots, controller preferences, history and relevant 3DS auxiliary data to the configured user's Nextcloud folder. The server bridge enforces folder confinement for its requests; the native app credential retains Nextcloud's standard account access. Cloud login uses temporary PHP session state, and regular WebDAV credentials are supplied per request rather than kept as permanent server account configuration.

The scanner reads operator-mounted ROMs/BIOS and optional database metadata, and writes feeds, cached identities and derived discs. Optional IGDB cover URLs can cause browsers to request artwork from that external host. Imported feeds can point to other hosts, including Dropbox direct links; those hosts receive the player's asset requests under their own policies. A downloaded Drive source file served from the arcade is fetched from the arcade during play, rather than automatically synchronizing to Drive. Your gateway/identity provider can also maintain its own access logs and sessions.

3DS shader-link diagnostics can record game title, core revision, GPU/browser information, compiler logs and generated shader sources. Reports are bounded and may persist locally and sync to the connected cloud account. Review diagnostics before sharing them publicly. They are troubleshooting data, not a ROM or account credential export.

## Runtime keys and operator secrets

No ROM, BIOS, key set or console backup is distributed by this release. The 3DS build removes upstream preset keys; encrypted games use an external runtime file. The authorized browser receives that file into emulator memory, so keep the arcade behind the intended access policy. Same-origin/no-store endpoint restrictions prevent ordinary asset caching and static key access; they do not make keys invisible to an authorized emulator browser.

Do not commit operator `.env`, handoff settings, database credentials, runtime keys, private certificates or backups. The public examples use placeholder hosts and contain no account credentials. Avoid putting key contents in environment variables or sharing raw browser storage/session dumps. Revoke a linked Nextcloud app credential through Disconnect or Nextcloud account settings if the browser/profile is no longer trusted.

The offline asset cache excludes credentials, cloud APIs, authentication routes, redirects/login HTML, private/no-store responses and runtime key files. Regular save ZIPs exclude 3DS external keys. Clearing browser site data removes local files and connection information but leaves remote Nextcloud files; Disconnect leaves those remote files too.

## License boundaries

The frontend and standalone deployment additions use Apache 2.0 with upstream notices retained. The emulator bundle has separate terms, including GPL/AGPL components and noncommercial restrictions such as those associated with FBNeo/Snes9x. The optional Nextcloud handoff app has its own AGPL license. Do not treat the full image as entirely Apache-licensed or unrestricted for commercial redistribution.

Read [LICENSE](../../LICENSE), [NOTICE](../../NOTICE), [THIRD_PARTY.md](../../THIRD_PARTY.md), [license snapshots](../../LICENSES/) and the [integration license](../../integrations/nextcloud/LICENSE). The modified 3DS corresponding source ships in the image at `/licenses/sources/3ds-source.tar.gz`. Wrapper reference snapshots and upstream source links document provenance without claiming exact matching source for every inherited binary.

ROM/BIOS ownership and permission are separate from the emulator/frontend license. Supply content you are entitled to use and distribute, and assess applicable requirements for your deployment. cloudЯcade is an independent fork preserving webRcade history and credits; it is not an official webRcade release.
