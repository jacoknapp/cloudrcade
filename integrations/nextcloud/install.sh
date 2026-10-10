#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -f "${RETROARCADE_ENV_FILE:-handoff.env}" ]; then
    set -a
    . "${RETROARCADE_ENV_FILE:-./handoff.env}"
    set +a
fi
NEXTCLOUD_CONTAINER=${NEXTCLOUD_CONTAINER:-nextcloud-aio-nextcloud}
NEXTCLOUD_APP_PATH=${NEXTCLOUD_APP_PATH:-/var/www/html/custom_apps}
NEXTCLOUD_OCC_PATH=${NEXTCLOUD_OCC_PATH:-/var/www/html/occ}
# The AIO-managed custom_apps directory is a persistent volume.
docker cp retroarcade_login "$NEXTCLOUD_CONTAINER:$NEXTCLOUD_APP_PATH/"
docker exec "$NEXTCLOUD_CONTAINER" chown -R www-data:www-data "$NEXTCLOUD_APP_PATH/retroarcade_login"
# This app has no database schema or migrations. Record its code version to
# invalidate Nextcloud's version-keyed route cache when new endpoints are added.
retroarcade_version=$(docker exec "$NEXTCLOUD_CONTAINER" php -r 'echo (string)simplexml_load_file($argv[1])->version;' "$NEXTCLOUD_APP_PATH/retroarcade_login/appinfo/info.xml")
docker exec -u www-data "$NEXTCLOUD_CONTAINER" php "$NEXTCLOUD_OCC_PATH" config:app:set retroarcade_login installed_version --value="$retroarcade_version"
docker exec -u www-data "$NEXTCLOUD_CONTAINER" php "$NEXTCLOUD_OCC_PATH" app:enable retroarcade_login

# AIO manages its child container. Persist env configuration with occ rather than
# editing or recreating that child; other Docker installs can pass the env directly.
docker exec -u www-data "$NEXTCLOUD_CONTAINER" php "$NEXTCLOUD_OCC_PATH" config:app:set retroarcade_login trusted_clients --value="${RETROARCADE_TRUSTED_CLIENTS:-}"
docker exec -u www-data "$NEXTCLOUD_CONTAINER" php "$NEXTCLOUD_OCC_PATH" config:app:set retroarcade_login server_url --value="${RETROARCADE_SERVER_URL:-}"
docker exec -u www-data "$NEXTCLOUD_CONTAINER" php "$NEXTCLOUD_OCC_PATH" config:app:set retroarcade_login saml_idp --value="${RETROARCADE_SAML_IDP:-}"
docker exec -u www-data "$NEXTCLOUD_CONTAINER" php "$NEXTCLOUD_OCC_PATH" config:app:set retroarcade_login legacy_origin --value="${RETROARCADE_LEGACY_ORIGIN:-}"
