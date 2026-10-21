#!/bin/sh
# Rebuild every PHP SAPI/extension from the checksum-verified upstream security
# release while Docker Official Images publication catches up. Configuration and
# dependency cleanup follow docker-library/php's Apache Bookworm recipe at
# e3eaff845f7a9f7259c31da54dce0320b47a3bbd; additionally build FPM for our event MPM.
set -eux
savedAptMark="$(apt-mark showmanual)"
apt-get update
apt-get install -y --no-install-recommends $PHPIZE_DEPS apache2-dev \
    libargon2-dev libcurl4-openssl-dev libonig-dev libreadline-dev libsodium-dev \
    libsqlite3-dev libssl-dev libxml2-dev zlib1g-dev
rm -rf /var/lib/apt/lists/*
docker-php-source delete
curl -fsSL -o /usr/src/php.tar.xz "$PHP_URL"
echo "$PHP_SHA256 */usr/src/php.tar.xz" | sha256sum -c -
# php-config records the trusted official base's exact configure arguments.
eval "set -- $(php-config --configure-options)"
export CFLAGS="$PHP_CFLAGS" CPPFLAGS="$PHP_CPPFLAGS" LDFLAGS="$PHP_LDFLAGS"
export PHP_BUILD_PROVIDER='https://github.com/jacoknapp/cloudrcade' PHP_UNAME='Linux - Docker'
docker-php-source extract
cd /usr/src/php
./configure "$@" --enable-fpm --with-fpm-user=www-data --with-fpm-group=www-data
make -j "$(nproc)"
# Prevent any superseded shared extension from remaining in the resulting image.
rm -f "$(php-config --extension-dir)"/*.so
make install
find /usr/local -type f -perm /0111 -exec sh -c 'strip --strip-all "$@" 2>/dev/null || :' -- '{}' +
cp php.ini-* "$PHP_INI_DIR/"
cd /
docker-php-source delete
apt-mark auto '.*' > /dev/null
[ -z "$savedAptMark" ] || apt-mark manual $savedAptMark
find /usr/local -type f -executable -exec ldd '{}' ';' \
    | awk '/=>/ { so = $(NF-1); if (index(so, "/usr/local/") == 1) { next }; gsub("^/(usr/)?", "", so); printf "*%s\n", so }' \
    | sort -u | xargs -rt dpkg-query --search \
    | awk 'sub(":$", "", $1) { print $1 }' | sort -u | xargs -r apt-mark manual
apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false
rm -rf /var/lib/apt/lists/* /tmp/pear /root/.pearrc
php -r 'if (PHP_VERSION !== getenv("PHP_VERSION")) { exit(1); }'
php-fpm --version | head -1 | grep -F "PHP $PHP_VERSION "
