<?php
declare(strict_types=1);
// Public runtime settings. Missing settings leave Nextcloud disabled.
function cloudBool(string $name): bool {
    return in_array(strtolower(trim((string)getenv($name))), ['1', 'true', 'yes', 'on'], true);
}
function cloudUrl(string $name, bool $originOnly = false): string {
    $url = rtrim(trim((string)getenv($name)), '/');
    $parts = parse_url($url);
    if (!$parts || !filter_var($url, FILTER_VALIDATE_URL) || ($parts['scheme'] ?? '') !== 'https' ||
        isset($parts['user'], $parts['pass']) || isset($parts['user']) || isset($parts['query']) || isset($parts['fragment'])) return '';
    if ($originOnly && !empty($parts['path'])) return '';
    return $url;
}
function cloudConfig(): array {
    $server = cloudUrl('NEXTCLOUD_URL');
    $enabled = cloudBool('NEXTCLOUD_ENABLED') && $server !== '' && cloudUrl('WEBRCADE_PUBLIC_URL', true) !== '';
    // Optional gateway access hint. Native Nextcloud still authorizes every grant.
    $header = trim((string)getenv('NEXTCLOUD_ACCESS_HEADER'));
    $value = trim((string)getenv('NEXTCLOUD_ACCESS_VALUE'));
    $allowed = true;
    if ($header !== '' || $value !== '') {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $header));
        $values = array_map('trim', preg_split('/[|,]/', (string)($_SERVER[$key] ?? '')));
        $allowed = $value !== '' && preg_match('/^[A-Za-z0-9-]+$/D', $header) === 1 && in_array($value, $values, true);
    }
    $prefix = trim((string)getenv('WEBRCADE_STORAGE_PREFIX')) ?: 'cloudrcade';
    if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $prefix)) $prefix = 'cloudrcade';
    $folder = trim((string)getenv('NEXTCLOUD_SAVE_FOLDER')) ?: 'CloudRcade';
    if (!preg_match('/^[A-Za-z0-9 _.-]{1,128}$/D', $folder) || in_array($folder, ['.', '..'], true)) $folder = 'CloudRcade';
    $dropboxKey = trim((string)getenv('DROPBOX_APP_KEY'));
    if (!preg_match('/^[A-Za-z0-9_-]{3,128}$/D', $dropboxKey)) $dropboxKey = '';
    $dropboxEnabled = cloudBool('DROPBOX_ENABLED') && $dropboxKey !== '' && cloudUrl('WEBRCADE_PUBLIC_URL', true) !== '';
    $feed = trim((string)getenv('WEBRCADE_FEED_URL')) ?: '/content/feeds/combined.json';
    if (!preg_match('~^/(?!/)[^\s\\\\]*$~D', $feed) && !validFeedUrl($feed)) $feed = '/content/feeds/combined.json';
    $icon = __DIR__ . '/../assets/cloudrcade.svg';
    $iconVersion = is_file($icon) ? substr(hash_file('sha256', $icon), 0, 16) : 'cabinet';
    return ['appName' => trim((string)getenv('WEBRCADE_APP_NAME')) ?: 'cloudЯcade', 'iconVersion' => $iconVersion,
        'storagePrefix' => $prefix, 'saveFolder' => $folder, 'feedUrl' => $feed,
        'enable3DS' => cloudBool('WEBRCADE_ENABLE_3DS'),
        'n3dsKeysUrl' => cloudBool('WEBRCADE_ENABLE_3DS') && n3dsKeysPath() !== '' ? '/cloud-saves/3ds-keys.php' : '',
        'dropbox' => ['enabled' => $dropboxEnabled, 'appKey' => $dropboxKey],
        'enabled' => $enabled, 'autoRedirect' => $enabled && cloudBool('NEXTCLOUD_AUTO_REDIRECT'),
        'server' => $server, 'handoff' => cloudBool('NEXTCLOUD_HANDOFF'), 'accessAllowed' => $allowed,
        // Upgrade-only: claim legacy credentials only for the explicitly configured old server.
        'legacyServer' => cloudUrl('NEXTCLOUD_LEGACY_URL'),
        'message' => 'No access has been enabled for Nextcloud. Please enable your own cloud instance.'];
}
function validFeedUrl(string $url): bool {
    $p = parse_url($url);
    return (bool)$p && filter_var($url, FILTER_VALIDATE_URL) && ($p['scheme'] ?? '') === 'https' &&
        !isset($p['user']) && !isset($p['pass']) && !isset($p['fragment']);
}

function n3dsKeysPath(): string {
    $path = trim((string)getenv('WEBRCADE_3DS_KEYS_FILE'));
    if ($path === '' || $path[0] !== '/' || !is_file($path) || !is_readable($path)) return '';
    $size = filesize($path);
    return $size > 0 && $size <= 262144 ? $path : '';
}
