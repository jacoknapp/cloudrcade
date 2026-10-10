# Nextcloud and access

[Wiki home](README.md) · [Saves](saves-and-storage.md) · [Operations](operations-and-troubleshooting.md)

## Enable a server

Nextcloud is optional. Native Login Flow v2 works without Authentik or a custom Nextcloud app. Configure the app's `.env`:

```dotenv
WEBRCADE_PUBLIC_URL=https://arcade.example.com
NEXTCLOUD_URL=https://cloud.example.com
NEXTCLOUD_ENABLED=true
NEXTCLOUD_AUTO_REDIRECT=false
NEXTCLOUD_HANDOFF=false
NEXTCLOUD_SAVE_FOLDER=CloudRcade
```

Use the actual Nextcloud HTTPS base URL, including its subdirectory if applicable. The app verifies upstream TLS. Recreate the container after changing environment settings:

```sh
docker compose up -d --force-recreate webrcade
```

Enablement and automatic login are independent. With automatic redirect off, **Link** remains available in **Cloud Storage** settings and connected save synchronization still works. Setting `NEXTCLOUD_AUTO_REDIRECT=true` attempts login when the app opens online. Interrupted automatic sign-in is attempted once per tab to avoid loops; explicit Disconnect pauses auto reconnect until Link is selected.

## Link as a player

Open Settings, find Cloud Storage, select Nextcloud and choose **Link** when available. Complete Nextcloud's own sign-in and native approval flow. The app polls while the approval tab is open, then returns to the original library/game URL. If the browser blocks the tab, use the connection page's visible sign-in link.

The browser remembers a revocable app credential for that server. A reused valid credential avoids a new grant; an expired credential needs recovery/relinking. Existing identity-provider sessions can simplify sign-in, but authentication or MFA may still appear when required by policy.

Check the connected account before loading valuable progress. Use normal game saving and exit; check cloud errors before moving to another device. Disconnect leaves the remote save folder intact. See [save recovery](saves-and-storage.md#offline-saves-and-recovery).

## Optional trusted handoff

The repository includes the `retroarcade_login` Nextcloud app for an operator who wants same-tab automatic authorization for exact trusted clients. It is an optional integration with Nextcloud's native Login Flow v2, not an arcade-side replacement for Nextcloud authorization. Read the [integration guide](../../integrations/nextcloud/README.md) and its generic [environment example](../../integrations/nextcloud/handoff.env.example) before installation.

1. Install/configure the handoff app on the intended Nextcloud server using the supplied installer and external operator environment file.
2. Configure `RETROARCADE_TRUSTED_CLIENTS` with the arcade's exact HTTPS origin and fixed callback/back URLs. For this client, the callback is `https://arcade.example.com/cloud-saves/?resume=1`; the back URL returns to the arcade library.
3. Set the trusted `client` to the effective client name followed by ` cloud saves`. The effective name is nonempty `NEXTCLOUD_CLIENT_NAME`, otherwise `WEBRCADE_APP_NAME`. This lets existing deployments retain a trusted login identity while changing visible branding.
4. Select an existing SAML provider through `RETROARCADE_SAML_IDP` only if intended. An empty value uses Nextcloud's normal login route.
5. Set `NEXTCLOUD_HANDOFF=true` in the arcade environment, recreate it, and verify with a disposable test account before player use.

The app validates local native flow URLs, pending tokens, expiry, exact origin/client and session state. It uses configured callbacks rather than request-supplied URLs. Automatic start requires POST; foreign or sibling origins and automatic localhost consent are rejected. Native password confirmation, credential issuance and encryption remain owned by Nextcloud. Credentials do not travel in redirect URLs.

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

The browser stores its app credential in site storage and supplies it per request to the same-origin PHP bridge. The bridge targets only the configured server and files under `NEXTCLOUD_SAVE_FOLDER`; it enforces TLS, session-bound CSRF, conditional writes and a 64 MB upload limit. PHP retains temporary login-flow state and a one-shot result until acknowledgement within the flow's lifetime; ordinary WebDAV credentials are request-only on the server.

The Nextcloud-issued credential itself has the account's standard file access. Folder restriction is enforced by this bridge; it is not a promise that the credential has a server-enforced folder-only scope. Protect the arcade origin and browser profile accordingly. Changing `NEXTCLOUD_URL` does not forward the old credential to another server. `NEXTCLOUD_LEGACY_URL` is an upgrade-only migration setting; leave it empty for new installations and do not change it alongside the current server URL.
