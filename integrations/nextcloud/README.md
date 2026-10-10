# Nextcloud sign-in handoff for CloudRcade and other trusted clients

Installed app: `retroarcade_login` in AIO's persistent `custom_apps` volume. Install or update with `sh install.sh` after syncing this directory. It has no database schema or migrations; the installer records the code version to invalidate Nextcloud's version-keyed route cache, then enables the app. Version 1.2.0 also refreshes Nextcloud's version-derived JavaScript cache key so returning browsers receive the client-specific callback script.

## Environment configuration

Copy `handoff.env.example` to `handoff.env` and configure it before running
`sh install.sh`. `RETROARCADE_ENV_FILE` selects a different env file. Version
1.5.0 reads these settings from Docker environment variables, falling back to
persisted app configuration. The installer persists the env values with `occ`,
which supports AIO without changing its managed child container. The example origin must be replaced before installation; no identity provider is selected by default.

| Variable | Purpose |
| --- | --- |
| `RETROARCADE_TRUSTED_CLIENTS` | JSON map of exact HTTPS origins to `client`, `name`, `callback` and `back` values. Callbacks must share the configured origin. |
| `RETROARCADE_SERVER_URL` | Canonical Nextcloud HTTPS base URL, including a subdirectory if used. Empty derives it from Nextcloud's URL generator. |
| `RETROARCADE_SAML_IDP` | Existing SAML provider ID. Empty uses Nextcloud's normal login route. |
| `RETROARCADE_LEGACY_ORIGIN` | Optional origin for pending sessions created before origin tracking. Empty rejects those older sessions. |
| `NEXTCLOUD_CONTAINER`, `NEXTCLOUD_APP_PATH`, `NEXTCLOUD_OCC_PATH` | Installer container and filesystem locations. |

`handoff.env` holds this deployment's choices; the release example uses generic
hosts. For CloudRcade, the configured `client` must equal `WEBRCADE_APP_NAME`
followed by ` cloud saves`. Its callback is the configured public origin plus
`/cloud-saves/?resume=1`; its back URL returns to that origin's library.

Connecting starts a same-tab form POST to `/apps/retroarcade_login/start` with
the native Login Flow v2 URL in the `flow` field. The app validates the local
flow URL, pending token, matching client name and expiry, then binds the origin
to random state in the Nextcloud session. Missing, foreign and sibling origins
are rejected. Request-supplied callback URLs are never used. GET links cannot
initiate automatic authorization. The resume route checks state before reusing
a Nextcloud session or redirecting through the configured login route. An
existing Authentik session can complete SAML without another login; password or
MFA screens still appear if the identity provider requires them.

After authentication, the app prepares native Login Flow v2 session state. A Nextcloud-hosted guest page automatically POSTs to the native grant endpoint using the Nextcloud CSRF token. Native authentication, password-confirmation middleware, credential issuance and encryption remain intact. If Nextcloud specifically requests password confirmation, the page shows a password form and submits only to its native throttled `/login/confirm` endpoint. It never sends that password to the originating application. Other errors retain a native manual-approval link. Completion returns to that client's fixed callback; the application backend polls for the credential using its session-bound native poll token. Credentials never travel in redirect URLs. Repeat resume after completion does not mint a second credential.

The original GET `/connect?flow=...` remains a manual SSO fallback with native approval. The games connection page retains a direct Nextcloud-password option. App credentials remain revocable in Nextcloud. CloudRcade remembers its credential in browser storage; Slate keeps its credential on its own backend and exposes only an opaque session cookie to its browser. Existing SAML access policies, MFA and automatic provisioning rules are unchanged. Localhost origins are intentionally not authorized for automatic consent; use native Login Flow v2 approval for local development.

## Validation

`php tests/connect-controller.php` runs isolated controller tests with stub Nextcloud services. Run from this directory, or use `docker run --rm -v "$PWD:/app:ro" -w /app php:8.3-cli-alpine php tests/connect-controller.php`. They cover both clients, exact origin/client matching, rejected external flow URLs, expiration, cross-session state, native session preparation, SAML resume, fixed callbacks and compatibility with pending games sessions. Live SAML/MFA and native credential issuance still require a disposable account against the deployed Nextcloud; these unit tests do not claim to verify them.

This integration uses the pinned Nextcloud34 Login Flow v2 controller's session constants and endpoints. Revalidate start/resume, native grant/confirmation, Origin/state rejection and session-reuse tests before upgrading Nextcloud.

To roll back automatic linking, restore the previous CloudRcade `api.php`, `connect.js` and `index.html` together with the previous app source; set this app’s `installed_version` back to the restored XML version to invalidate route caches. To remove the entire handoff, restore CloudRcade’s native Login Flow v2 URL behavior and disable `retroarcade_login`. SAML can separately be disabled with `occ app:disable user_saml`; previous multiple-backend and require-provisioned flags were both `0`. Do not disable SAML automatically during app deployment.
