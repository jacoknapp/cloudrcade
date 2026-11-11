#!/bin/sh
# Build the upstream security release while distribution packages catch up.
# Keep Debian's paths and operator configuration; install only compiled programs
# and modules. Future image rebuilds repeat this verified installation.
set -eux
version=2.4.71
sha256=2bc5da5a33c247341de082717d4ebcb5cb49e8b73a05b7fddf7d5d6dc2f8de62
savedAptMark="$(apt-mark showmanual)"
apt-get update
apt-get install -y --no-install-recommends build-essential curl bzip2 \
    libapr1-dev libaprutil1-dev libpcre2-dev libssl-dev libnghttp2-dev \
    libxml2-dev liblua5.3-dev libldap2-dev libbrotli-dev libcurl4-openssl-dev libjansson-dev
work="$(mktemp -d)"
curl -fsSL "https://downloads.apache.org/httpd/httpd-$version.tar.bz2" -o "$work/httpd.tar.bz2"
echo "$sha256 *$work/httpd.tar.bz2" | sha256sum -c -
tar -xjf "$work/httpd.tar.bz2" -C "$work"
cd "$work/httpd-$version"
export CFLAGS="$(dpkg-buildflags --get CFLAGS) -fstack-protector-strong -fPIE"
export CPPFLAGS="$(dpkg-buildflags --get CPPFLAGS)"
export LDFLAGS="$(dpkg-buildflags --get LDFLAGS) -Wl,-z,relro,-z,now -pie"
./configure --enable-layout=Debian --enable-so --enable-pie \
    --enable-mods-shared=reallyall --enable-mpms-shared=all \
    --enable-log-config=static --enable-mods-static="unixd logio watchdog version" \
    --enable-ssl --enable-http2 --with-pcre=/usr/bin/pcre2-config \
    --with-program-name=apache2 --with-suexec-bin=/usr/lib/apache2/suexec
# Match Debian's FHS compile-time defaults without replacing operator config.
sed -i -e 's|^#define HTTPD_ROOT .*|#define HTTPD_ROOT "/etc/apache2"|' \
    -e 's|^#define SERVER_CONFIG_FILE .*|#define SERVER_CONFIG_FILE "apache2.conf"|' \
    -e 's|^#define AP_TYPES_CONFIG_FILE .*|#define AP_TYPES_CONFIG_FILE "mime.types"|' include/ap_config_auto.h
make -j "${APACHE_BUILD_JOBS:-4}"
make DESTDIR="$work/install" install
for module in mod_http2 mod_md mod_vhost_alias; do
    test -s "$work/install/usr/lib/apache2/modules/$module.so"
done
# Never replace conf, data, PHP modules or distribution helper scripts.
install -m 0755 "$work/install/usr/sbin/apache2" /usr/sbin/apache2
cp -a "$work/install/usr/lib/apache2/modules/"*.so /usr/lib/apache2/modules/
for program in ab checkgid dbmmanage fcgistarter htcacheclean htdbm htdigest htpasswd httxt2dbm logresolve rotatelogs; do
    for dir in bin sbin; do
        [ ! -f "$work/install/usr/$dir/$program" ] || install -m 0755 "$work/install/usr/$dir/$program" "/usr/$dir/$program"
    done
done
mkdir -p /usr/local/share/apache-security
printf '%s\n' "Apache $version; upstream source SHA256 $sha256" > /usr/local/share/apache-security/build.txt
cd /
rm -rf "$work"
apt-mark auto '.*' >/dev/null
[ -z "$savedAptMark" ] || apt-mark manual $savedAptMark
# Retain libraries required by the new server and all compiled modules.
find /usr/lib/apache2/modules /usr/sbin/apache2 -type f -exec ldd '{}' ';' \
    | awk '/=> \/usr\/lib|=> \/lib/ {print $(NF-1)}' | sort -u \
    | xargs -r readlink -f | xargs -r dpkg-query --search \
    | awk 'sub(":$", "", $1) {print $1}' | sort -u | xargs -r apt-mark manual
apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false
rm -rf /var/lib/apt/lists/*
apache2 -v | grep -F "Apache/$version "
