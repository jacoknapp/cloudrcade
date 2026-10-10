# CloudRcade release: tested webRcade 0.2.3 runtime plus maintained overlays.
# Source-build reference: docker/Dockerfile.upstream; see docs/architecture.md.
FROM webrcade/webrcade@sha256:77789de80c2963d58631b57306335638eec8f6425c66b7d6868576f0ea5f7a49 AS upstream
FROM python:3.12-alpine AS overlays
COPY --from=upstream /var/www/html/play /source/play
WORKDIR /work
COPY deploy/webrcade/patch-player.py deploy/webrcade/prepare-touch.py deploy/webrcade/patch-clock-core.py deploy/webrcade/patch-psx-stream.py ./
COPY deploy/webrcade/touch/ ./touch/
COPY release/3ds/app/ /extra/retro-azahar/
RUN WEBRCADE_SOURCE_ROOT=/source WEBRCADE_PLAYER_OUTPUT=/out-player.js python3 patch-player.py \
 && WEBRCADE_SOURCE_ROOT=/source WEBRCADE_EXTRA_APPS=/extra WEBRCADE_TOUCH_ROOT=/out-pages python3 prepare-touch.py

FROM php:8.3-apache-bookworm AS web
RUN apt-get update && apt-get install -y --no-install-recommends python3 mame-tools mariadb-client nodejs npm openssl \
 && npm install -g miniflare@2.12.1 \
 && a2enmod headers proxy_http ssl \
 && mkdir -p /usr/local/apache2/conf/ssl \
 && printf '\nEnableMMAP off\nEnableSendfile off\n' >> /etc/apache2/apache2.conf \
 && rm -rf /var/lib/apt/lists/*
COPY --from=upstream /var/www/html/ /var/www/html/
COPY --from=upstream /var/www/cors.js /var/www/cors.js
COPY --from=upstream /etc/apache2/sites-available/000-default.conf /etc/apache2/sites-available/000-default.conf
COPY --from=upstream /usr/local/bin/generate-certificate.sh /usr/local/bin/setup-https.sh /usr/local/bin/
LABEL org.opencontainers.image.title="CloudRcade" \
      org.opencontainers.image.source="https://github.com/jacoknapp/cloudrcade" \
      org.opencontainers.image.description="Self-hosted webRcade fork with cloud saves and touch controls"
COPY --from=overlays /out-pages /var/www/touch/pages
COPY --from=overlays /out-player.js /var/www/html/play/static/js/main.7ac86965.chunk.js
COPY deploy/webrcade/touch /var/www/touch
COPY release/3ds/app/ /var/www/touch/apps/retro-azahar/
COPY release/3ds/sources/ /var/www/html/licenses/sources/
COPY LICENSE LICENSE-third-party NOTICE THIRD_PARTY.md /var/www/html/licenses/
COPY LICENSES/ /var/www/html/licenses/texts/
COPY deploy/webrcade/rom-library.conf /etc/apache2/conf-enabled/rom-library.conf
COPY deploy/webrcade/environment.py deploy/webrcade/refresh-feed.py deploy/webrcade/service.py /usr/local/share/cloudrcade/
ENV WEBRCADE_APP_NAME=CloudRcade WEBRCADE_STORAGE_PREFIX=cloudrcade \
    NEXTCLOUD_SAVE_FOLDER=CloudRcade WEBRCADE_ENABLE_3DS=true \
    WEBRCADE_ROM_ROOT=/var/www/html/content WEBRCADE_STATE_PATH=/data \
    WEBRCADE_SCAN_ENABLED=true WEBRCADE_SCAN_INTERVAL_SECONDS=21600
CMD ["python3", "/usr/local/share/cloudrcade/service.py"]
STOPSIGNAL SIGTERM
EXPOSE 80 443
