# PHP security runtime

The application uses Apache event MPM and PHP-FPM. Both CLI and the HTTP worker
must contain the security fixes; copying only a newer FPM binary is insufficient.

PHP 8.3.36 fixes CVE-2026-109618 and CVE-2026-109619. At release time on October 21,
2026, the Docker Official Image tags had not yet been published. The Dockerfile
therefore builds the official PHP 8.3.36 source once with the existing official
Apache configure arguments plus FPM, replacing PHP binaries, headers, the unused
Apache module and all shared extensions. The existing FPM configuration remains.
The source archive is checked against PHP's published SHA-256 before extraction.
No PHP source patches are applied. The build script follows the official Apache
Bookworm recipe's dependencies, compiler hardening and dependency cleanup.

Sources:

- [PHP release and source checksums](https://www.php.net/releases/index.php?json&version=8.3.36)
- [OOM advisory](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w)
- [Stale-state advisory](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp)
- [Official Apache recipe used as reference](https://github.com/docker-library/php/blob/e3eaff845f7a9f7259c31da54dce0320b47a3bbd/8.3/bookworm/apache/Dockerfile)

The image smoke check asserts the CLI/FPM versions, Apache event configuration,
and the PHP/extension versions returned by a real FastCGI request. Its temporary
probe is confined to the synthetic smoke container and removed after use.

When official fixed images are available, a later maintenance change can replace
this temporary rebuild with matching fixed Apache and FPM base images. Retain the
runtime smoke checks and advance their expected PHP version with future updates.
