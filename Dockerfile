# CloudRcade release: tested webRcade 0.2.3 runtime plus maintained overlays.
# Source-build reference: docker/Dockerfile.upstream; see docs/architecture.md.
# Upstream supplies architecture-independent browser assets, never native tools.
ARG ASSET_PLATFORM=linux/amd64
FROM --platform=$ASSET_PLATFORM webrcade/webrcade@sha256:77789de80c2963d58631b57306335638eec8f6425c66b7d6868576f0ea5f7a49 AS upstream
FROM --platform=$BUILDPLATFORM python:3.12-alpine@sha256:1b668429b3511ab407d8e00648891631b0b1a4d7e15e3ca70f38ab5b91ad4ab4 AS overlays
COPY --from=upstream /var/www/html/play /source/play
WORKDIR /work
COPY deploy/webrcade/patch-player.py deploy/webrcade/prepare-touch.py deploy/webrcade/patch-clock-core.py deploy/webrcade/patch-psx-stream.py ./
COPY src/react/screens/releasenotes/notes.json ./release-notes.json
COPY deploy/webrcade/touch/ ./touch/
COPY release/3ds/app/ /extra/retro-azahar/
COPY release/psp/app/ /extra/retro-ppsspp/
RUN WEBRCADE_SOURCE_ROOT=/source WEBRCADE_PLAYER_OUTPUT=/out-player.js python3 patch-player.py \
 && WEBRCADE_SOURCE_ROOT=/source WEBRCADE_EXTRA_APPS=/extra WEBRCADE_TOUCH_ROOT=/out-pages python3 prepare-touch.py

FROM php:8.3.35-fpm-bookworm AS php-fpm

FROM php:8.3.35-apache-bookworm AS web
# Official 8.3.36 images are not yet published; build the verified PHP release
# with the official base configuration, including CLI, Apache module and FPM.
ENV PHP_VERSION=8.3.36 \
    PHP_URL=https://www.php.net/distributions/php-8.3.36.tar.xz \
    PHP_ASC_URL=https://www.php.net/distributions/php-8.3.36.tar.xz.asc \
    PHP_SHA256=dd54693aa334c5c4d72e9aee96b082c2473750a18a6c1d105789c93a3b1692fd
COPY docker/build-php-runtime.sh /usr/local/bin/build-php-runtime
RUN sh /usr/local/bin/build-php-runtime && rm /usr/local/bin/build-php-runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 mame-tools nodejs npm openssl \
 && npm install -g miniflare@2.12.1 \
 && a2dismod php mpm_prefork \
 && a2enmod mpm_event headers proxy_http proxy_fcgi setenvif ssl http2 \
 && mkdir -p /usr/local/apache2/conf/ssl \
 && printf '\nEnableMMAP off\nEnableSendfile off\n' >> /etc/apache2/apache2.conf \
 && rm -rf /var/lib/apt/lists/*
COPY --from=php-fpm /usr/local/etc/php-fpm.conf /usr/local/etc/php-fpm.conf
COPY --from=php-fpm /usr/local/etc/php-fpm.d/ /usr/local/etc/php-fpm.d/
COPY deploy/webrcade/php-fpm.conf /usr/local/etc/php-fpm.d/zz-cloudrcade.conf
COPY deploy/webrcade/php-fpm-apache.conf /etc/apache2/conf-enabled/php-fpm.conf
RUN php-fpm --test
COPY --from=upstream /var/www/html/ /var/www/html/
COPY --from=upstream /var/www/cors.js /var/www/cors.js
COPY --from=upstream /etc/apache2/sites-available/000-default.conf /etc/apache2/sites-available/000-default.conf
COPY --from=upstream /usr/local/bin/generate-certificate.sh /usr/local/bin/setup-https.sh /usr/local/bin/
LABEL org.opencontainers.image.title="cloudRcade" \
      org.opencontainers.image.source="https://github.com/jacoknapp/cloudrcade" \
      org.opencontainers.image.description="Self-hosted webRcade fork with cloud saves and touch controls"
COPY --from=overlays /out-pages /var/www/touch/pages
COPY --from=overlays /out-player.js /var/www/html/play/static/js/main.7ac86965.chunk.js
COPY deploy/webrcade/touch /var/www/touch
COPY release/3ds/app/ /var/www/touch/apps/retro-azahar/
COPY release/3ds/sources/ /var/www/html/licenses/sources/
COPY release/psp/app/ /var/www/touch/apps/retro-ppsspp/
COPY release/psp/sources/ /var/www/html/licenses/sources/
COPY release/gamecube/app/ /var/www/html/experimental/gamecube/
COPY deploy/webrcade/retro-dolphin/apache.conf /etc/apache2/conf-enabled/gamecube.conf
COPY release/ps2/app/ /var/www/html/experimental/ps2/
COPY release/ps2/sources/ /var/www/html/licenses/sources/
COPY deploy/webrcade/retro-play/apache.conf /etc/apache2/conf-enabled/ps2.conf
# Deploy qualified images explicitly, preserving the current release policy.
LABEL com.centurylinklabs.watchtower.enable="false"
COPY LICENSE LICENSE-third-party NOTICE THIRD_PARTY.md /var/www/html/licenses/
COPY LICENSES/ /var/www/html/licenses/texts/
COPY deploy/webrcade/rom-library.conf /etc/apache2/conf-enabled/rom-library.conf
COPY deploy/webrcade/environment.py deploy/webrcade/refresh-feed.py deploy/webrcade/service.py deploy/webrcade/mount_layout.py deploy/webrcade/metadata_lookup.py /usr/local/share/cloudrcade/
ENV WEBRCADE_APP_NAME=cloudЯcade WEBRCADE_STORAGE_PREFIX=cloudrcade \
    NEXTCLOUD_SAVE_FOLDER=CloudRcade WEBRCADE_ENABLE_3DS=true \
    WEBRCADE_ROM_ROOT=/var/www/html/content WEBRCADE_STATE_PATH=/data \
    WEBRCADE_SCAN_ENABLED=true WEBRCADE_SCAN_INTERVAL_SECONDS=21600
CMD ["python3", "/usr/local/share/cloudrcade/service.py"]
STOPSIGNAL SIGTERM
EXPOSE 80 443

# Compatibility target for existing build commands. Both targets include GameCube.
FROM web AS web-gamecube
