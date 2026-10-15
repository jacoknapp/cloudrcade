# Nextcloud and access

[Wiki home](README.md) · [Cloud choices and saves](saves-and-storage.md) · [Operations](operations-and-troubleshooting.md)

Nextcloud is optional cloud storage for your progress. It is visible in the arcade: **Settings → Cloud Storage** shows a Nextcloud row, a **Link** or **Manage** button, and a connection status when the operator enables it. A separate connection page handles sign-in, approval and disconnection. Linking the arcade website and signing into Nextcloud are related but separate steps.

## Link as a player

1. Open the arcade and complete any website sign-in.
2. Open **Settings** and move to **Cloud Storage**. On smaller screens, use the settings page arrows to reach it.
3. Find **Nextcloud**. If the current row shows Dropbox, open **Choose storage**, select **Nextcloud** and link there, or choose **Use this storage** for an existing connection. **Link** means this browser has no connection; choose it. If it says **Manage**, read the Status/account first: this browser already remembers a connection.
4. On the connection page, finish Nextcloud sign-in and approve access. The ordinary native flow opens a separate Nextcloud tab while the arcade page waits. If no tab opens, choose **Open Nextcloud sign-in ↗** on the page. **Use Nextcloud password instead ↗** is another visible option when an SSO route needs a manual fallback.
5. After approval, return to the waiting arcade tab if necessary. It finishes the connection and returns to the original library/game URL.
6. Open Cloud Storage again and check Status. It should read **Connected** (with your name when available) and **automatic saves**. Confirm the account before loading valuable progress.

You do not enter a server URL or choose a cloud save directory in these player settings. The operator sets the Nextcloud server and folder. If the Nextcloud row is absent or access is denied, ask the operator which cloud choices this site offers. Having a Nextcloud account elsewhere does not automatically connect it to this arcade.

## What the visible screens mean

| What you see | Meaning and next action |
| --- | --- |
| **Link** and **Disconnected · saves stay on this browser** | No connected Nextcloud account in this browser; Link before launching if you want cloud progress |
| **Manage** and **Connected … · automatic saves** | A connection is remembered; check the displayed name and any save errors |
| **Finish sign-in and approval in Nextcloud…** | The connection page is waiting for the Nextcloud tab; finish approval or use its visible sign-in link |
| **Finishing your Nextcloud connection…** | The arcade is receiving the approved connection; let it complete |
| **No access has been enabled for Nextcloud…** | The configured service or your access is unavailable; contact the operator |
| A cloud/save error during play or exit | The latest transfer may have failed; preserve this browser's data and read [save recovery](saves-and-storage.md#offline-saves-and-recovery) |

A remembered connection is not proof that a recent save uploaded successfully. An expired/revoked credential or network outage can still cause an error. Check errors before moving to another device.

## Automatic login and manual linking

The operator may enable automatic login. In that case, opening the arcade online can take you through the connection page without choosing Link. Existing valid credentials are reused; an existing Nextcloud/SSO session may avoid another password prompt. Nextcloud approval, sign-in or MFA can still appear according to the configured flow and account policy.

Automatic login and Nextcloud availability are separate settings. Turning automatic login off leaves **Link**, **Manage** and connected save synchronization available. Automatic attempts are limited to once per tab to avoid sign-in loops. Explicit Disconnect pauses automatic reconnection in this browser until you choose Link again.

With the ordinary native flow, Nextcloud shows its approval screen. An operator can install the [optional trusted handoff](#optional-trusted-handoff) for configured clients; that can authorize through an existing session in the same tab. The connection/status screens remain part of the user experience.

## Manage, disconnect and reconnect

Choose **Manage** in Cloud Storage to open the connection page. It shows the account (when available), the configured folder, **Use this storage**, **Disconnect this browser** and **Back to games**. Choose Back to games to return without changing the connection. If you reached Nextcloud through **Choose storage** while Dropbox was active, choose **Use this storage** to make Nextcloud the active save destination; browsing a provider's status alone does not switch it or copy saves.

Disconnect revokes the browser's Nextcloud app credential and removes its connection. Your existing remote save files remain in Nextcloud. It does not copy account-scoped progress into an unlinked or different-account profile. You can also revoke a credential through Nextcloud's account settings.

To reconnect, return to **Settings → Cloud Storage → Nextcloud → Link** and complete approval again. Use the same server/account to reach the same cloud progress. If you reconnect or change accounts while a game is running, exit and reopen that game before using its cloud saves. Do not clear site data: that also removes local saves and pending recovery records.

For another device, link that browser separately to the same Nextcloud account before launching. Follow [Moving to another device](saves-and-storage.md#moving-to-another-device) for the full sequence.

## Enable a server

This section is for the operator. Nextcloud's native Login Flow v2 works without Authentik or a custom Nextcloud app. The root example disables Nextcloud and automatic login. Configure the arcade's `.env`:

```dotenv
WEBRCADE_PUBLIC_URL=https://arcade.example.com
NEXTCLOUD_URL=https://cloud.example.com
NEXTCLOUD_ENABLED=true
NEXTCLOUD_AUTO_REDIRECT=false
NEXTCLOUD_HANDOFF=false
NEXTCLOUD_SAVE_FOLDER=CloudRcade
```

Use the actual Nextcloud HTTPS base URL, including its subdirectory if applicable. The arcade verifies upstream TLS. The public URL must be an HTTPS origin without a path. Recreate the container after changing environment settings:

```sh
docker compose up -d --force-recreate webrcade
```

Manually Link with a disposable test account first. Confirm the account/status, save and reopen a game, then check that the files appear in that account's configured Nextcloud folder. Set `NEXTCLOUD_AUTO_REDIRECT=true` only if you want automatic connection attempts at startup. Automatic login does not enable a server by itself.

## Optional trusted handoff

The repository includes the `retroarcade_login` Nextcloud app for an operator who wants same-tab automatic authorization for exact trusted clients. It is an optional integration with Nextcloud's native Login Flow v2, not an arcade-side replacement for Nextcloud authorization. Read the [integration guide](../../integrations/nextcloud/README.md) and its generic [environment example](../../integrations/nextcloud/handoff.env.example) before installation.

1. Install/configure the handoff app on the intended Nextcloud server using the supplied installer and external operator environment file.
2. Configure `RETROARCADE_TRUSTED_CLIENTS` with the arcade's exact HTTPS origin and fixed callback/back URLs. For this client, the callback is `https://arcade.example.com/cloud-saves/?resume=1`; the example back URL is `https://arcade.example.com/cloud-saves/` so an interrupted handoff can return to the connection page.
3. Set the trusted `client` to the effective client name followed by ` cloud saves`. The effective name is nonempty `NEXTCLOUD_CLIENT_NAME`, otherwise `WEBRCADE_APP_NAME`. This lets existing deployments retain a trusted login identity while changing visible branding.
4. Select an existing SAML provider through `RETROARCADE_SAML_IDP` only if intended. An empty value uses Nextcloud's normal login route.
5. Set `NEXTCLOUD_HANDOFF=true` in the arcade environment, recreate it, and verify with a disposable test account before player use.

The app validates local native flow URLs, pending tokens, expiry, exact origin/client and session state. It uses configured callbacks rather than request-supplied URLs. Automatic start requires POST; origins absent from the exact trusted-client map, including sibling origins, are rejected. Use native approval for local development rather than adding a development origin to the production trust map. Native password confirmation, credential issuance and encryption remain owned by Nextcloud. Credentials do not travel in redirect URLs.

An existing Authentik/Nextcloud session can complete without another login, but SAML access policy, provisioning, password confirmation and MFA still apply. If automatic handling cannot finish, native/manual approval remains the fallback. Revalidate this integration when upgrading Nextcloud because it relies on version-specific Login Flow v2 interfaces.

## Access denied and gateway hints

Disabled or denied Nextcloud connections return to the original game/library and display:

> No access has been enabled for Nextcloud. Please enable your own cloud instance.

This message does not provision a personal server or grant access. The operator must enable a valid instance and the account must be authorized. Local supported progress remains available.

`NEXTCLOUD_ACCESS_HEADER` and `NEXTCLOUD_ACCESS_VALUE` optionally gate automatic redirection using a trusted gateway header. Both are empty by default. The gateway must overwrite the header rather than accepting a browser-supplied identity hint. This check is a hint to avoid known denied redirects; Nextcloud still authorizes the grant. An identity provider's own denial page requires an access hint or its own integrated denial callback to guarantee a return to the arcade.

## Protect sign-in from worker updates

If Authentik protects the arcade, allow the exact static worker path in this application's unauthenticated-path expressions:

```text
^/touch-controls/offline-worker\.js$
```

Allow its query-string update URLs too. Keep library HTML, feeds, ROMs, BIOS keys, configuration and cloud APIs protected. The worker is public application code. Background worker installation makes no protected prefetch requests; the loaded app warms shell/feed resources after sign-in. Both the exact static exception and this install behavior matter to preserving the gateway's pending sign-in cookie.

Verify from the repository root without logging into an account:

```sh
python3 scripts/check-auth-proxy.py --origin https://arcade.example.com
```

An already failed empty HTTP 400 callback needs a fresh sign-in navigation. See [troubleshooting](operations-and-troubleshooting.md#blank-page-after-gateway-sign-in) for recovery. Do not broaden anonymous access to private assets to fix a worker update.

Safari's native share/Home Screen UI also needs to fetch the static app icons
without a login session. Allow the exact [app icon paths](../../deploy/webrcade/README.md#app-icons)
and use the same proxy checker to verify them. The library, feeds, ROMs and
BIOS keys remain protected.

## Credential boundaries

The browser stores its app credential in site storage and supplies it per request to the same-origin PHP bridge. The bridge targets only the configured server and files under `NEXTCLOUD_SAVE_FOLDER`; it enforces TLS, session-bound CSRF, conditional writes and a 64 MiB per-file upload limit. PHP retains temporary login-flow state and a one-shot result until acknowledgement within the flow's lifetime; ordinary WebDAV credentials are request-only on the server. `NEXTCLOUD_SAVE_FOLDER` names one top-level folder, not a slash-separated path; invalid values fall back to `CloudRcade`.

The Nextcloud-issued credential itself has the account's standard file access. Folder restriction is enforced by this bridge; it is not a promise that the credential has a server-enforced folder-only scope. Protect the arcade origin and browser profile accordingly. Changing `NEXTCLOUD_URL` does not forward the old credential to another server. `NEXTCLOUD_LEGACY_URL` is an upgrade-only migration setting; leave it empty for new installations and do not change it alongside the current server URL.
