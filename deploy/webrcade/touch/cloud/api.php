<?php
declare(strict_types=1);
// Same-origin WebDAV bridge. Temporary login state is retained until browser receipt.
// Nextcloud app credentials belong to the browser and are supplied per request.
require_once __DIR__ . '/settings.php';
define('NC', cloudConfig()['server']);
define('ORIGIN', cloudUrl('WEBRCADE_PUBLIC_URL', true));
const MAX_SAVE = 67108864;
ini_set('display_errors', '0');
ini_set('session.use_strict_mode', '1');
ini_set('session.gc_maxlifetime', '1800');
session_save_path(sys_get_temp_dir());
session_name('__Host-' . cloudConfig()['storagePrefix'] . '_cloud');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
session_start();
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Cross-Origin-Resource-Policy: same-origin');
$_SESSION['csrf'] ??= bin2hex(random_bytes(32));

function reply(int $status, array $body): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}
function upstream(string $method, string $path, ?array $auth = null, ?string $body = null, array $headers = []): array {
    $ch = curl_init(NC . $path);
    $etag = null;
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_TIMEOUT => 60,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_USERAGENT => cloudConfig()['appName'] . ' cloud saves',
        CURLOPT_HTTPHEADER => array_merge(['OCS-APIRequest: true'], $headers),
        CURLOPT_HEADERFUNCTION => static function ($ch, $line) use (&$etag) {
            if (stripos($line, 'ETag:') === 0) $etag = trim(substr($line, 5));
            return strlen($line);
        }]);
    if ($auth) curl_setopt_array($ch, [CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
        CURLOPT_USERPWD => $auth['login'] . ':' . $auth['password']]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    if ($method === 'HEAD') curl_setopt($ch, CURLOPT_NOBODY, true);
    $result = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($result === false) reply(502, ['error' => 'Nextcloud could not be reached. Your local saves have been kept.']);
    return [$code, $result, $etag];
}
function davRoot(array $auth): string {
    return '/remote.php/dav/files/' . rawurlencode($auth['uid']) . '/' . rawurlencode(cloudConfig()['saveFolder']);
}
function checkUpstream(int $code): void {
    if ($code === 401) reply(401, ['error' => 'Reconnect to Nextcloud to access your saves.']);
    if ($code === 403) reply(403, ['code' => 'access_denied', 'error' => cloudConfig()['message']]);
    if ($code === 412) reply(409, ['error' => 'This save changed on another device. Cloud upload was stopped and your local copy has been kept.']);
    if ($code === 404) reply(404, ['error' => 'Save not found.']);
    if ($code === 507) reply(507, ['error' => 'Nextcloud storage is full. Your local copy has been kept.']);
    if ($code < 200 || $code >= 300) reply(502, ['error' => 'Nextcloud could not complete the save operation.']);
}
function loginLinks(string $flow): array {
    $handoff = cloudConfig()['handoff'];
    return ['start' => $handoff ? NC . '/apps/retroarcade_login/start' : null, 'flow' => $flow,
        'login' => $handoff ? NC . '/apps/retroarcade_login/connect?flow=' . rawurlencode($flow) : $flow,
        'directLogin' => NC . '/login?direct=1&redirect_url=' . rawurlencode($flow)];
}

$action = $_GET['action'] ?? 'status';
$method = $_SERVER['REQUEST_METHOD'];
if ($action === 'status' && $method === 'GET') {
    reply(200, ['csrf' => $_SESSION['csrf'], 'folder' => cloudConfig()['saveFolder'], 'server' => NC, 'config' => cloudConfig(),
        'pending' => isset($_SESSION['pending']) && $_SESSION['pending']['expires'] > time()]);
}
if (isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== ORIGIN) reply(403, ['error' => 'Origin rejected.']);
if (!hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) reply(403, ['error' => 'Refresh the page and try again.']);
if ($action === 'cancel' && $method === 'POST') {
    unset($_SESSION['pending']);
    reply(200, ['cancelled' => true]);
}
$config = cloudConfig();
if (!$config['enabled']) reply(403, ['code' => 'nextcloud_disabled', 'error' => $config['message']]);
if (!$config['accessAllowed'] && $action !== 'unlink') reply(403, ['code' => 'access_denied', 'error' => $config['message']]);

if ($action === 'login' && $method === 'POST') {
    if (isset($_SESSION['pending']) && ($_SESSION['pending']['server'] ?? $config['legacyServer']) !== NC) unset($_SESSION['pending']);
    if (isset($_SESSION['pending']) && $_SESSION['pending']['expires'] > time()) {
        if (isset($_SESSION['pending']['credential'])) reply(200, ['ready' => true]);
        reply(200, loginLinks($_SESSION['pending']['login']));
    }
    [$code, $body] = upstream('POST', '/index.php/login/v2', null, '');
    checkUpstream($code);
    $flow = json_decode($body, true);
    foreach ([$flow['login'] ?? '', $flow['poll']['endpoint'] ?? ''] as $url) {
        if (!str_starts_with($url, NC . '/')) reply(502, ['error' => 'Unexpected Nextcloud login response.']);
    }
    $_SESSION['pending'] = ['login' => $flow['login'], 'endpoint' => substr($flow['poll']['endpoint'], strlen(NC)),
        'token' => $flow['poll']['token'], 'server' => NC, 'expires' => time() + 1200];
    reply(200, loginLinks($flow['login']));
}
if ($action === 'ack' && $method === 'POST') {
    $receipt = $_SESSION['pending']['receipt'] ?? '';
    if ($receipt === '' || !hash_equals($receipt, $_SERVER['HTTP_X_LOGIN_RECEIPT'] ?? '')) reply(409, ['error' => 'Connection receipt changed.']);
    unset($_SESSION['pending']);
    reply(200, ['acknowledged' => true]);
}
if ($action === 'poll' && $method === 'POST') {
    $pending = $_SESSION['pending'] ?? null;
    if (!$pending || $pending['expires'] < time()) reply(410, ['error' => 'Login expired. Please connect again.']);
    if (($pending['server'] ?? $config['legacyServer']) !== NC) {
        unset($_SESSION['pending']);
        reply(410, ['error' => 'Nextcloud server changed. Please connect again.']);
    }
    // Native polling is one-shot. Keep the result in this short-lived session
    // until the browser confirms durable receipt; downstream failures are retryable.
    if (!isset($pending['credential'])) {
        [$code, $body] = upstream('POST', $pending['endpoint'], null, http_build_query(['token' => $pending['token']]),
            ['Content-Type: application/x-www-form-urlencoded']);
        if ($code === 404) reply(202, ['connected' => false]);
        checkUpstream($code);
        $result = json_decode($body, true);
        if (rtrim($result['server'] ?? '', '/') !== NC || empty($result['loginName']) || empty($result['appPassword'])) {
            unset($_SESSION['pending']);
            reply(502, ['error' => 'Unexpected Nextcloud authorization response.']);
        }
        $_SESSION['pending']['credential'] = ['login' => $result['loginName'], 'password' => $result['appPassword']];
        $_SESSION['pending']['receipt'] = bin2hex(random_bytes(32));
        // Persist before the next network operation, even if PHP times out.
        session_write_close(); session_start();
    }
    $auth = $_SESSION['pending']['credential'];
    [$code, $body] = upstream('GET', '/ocs/v2.php/cloud/user?format=json', $auth, null, ['Accept: application/json']);
    if ($code === 401 || $code === 403) unset($_SESSION['pending']);
    checkUpstream($code);
    $user = json_decode($body, true)['ocs']['data'] ?? [];
    if (empty($user['id'])) reply(502, ['error' => 'Nextcloud did not identify the account.']);
    $auth['uid'] = $user['id'];
    $auth['server'] = NC;
    $auth['name'] = $user['display-name'] ?? $user['displayname'] ?? $user['id'];
    [$code] = upstream('MKCOL', davRoot($auth), $auth);
    if ($code !== 405) checkUpstream($code);
    if (empty($_SESSION['pending']['delivered'])) session_regenerate_id(true);
    $_SESSION['pending']['delivered'] = true;
    reply(200, ['connected' => true, 'connection' => $auth, 'receipt' => $_SESSION['pending']['receipt']]);
}
// File-transfer credentials are never stored in the server session.
$auth = null;
$encoded = $_SERVER['HTTP_X_NEXTCLOUD_AUTHORIZATION'] ?? '';
if (str_starts_with($encoded, 'Basic ')) {
    if (($_SERVER['HTTP_X_NEXTCLOUD_SERVER'] ?? $config['legacyServer']) !== NC) {
        reply(401, ['error' => 'Nextcloud server changed. Please connect again.']);
    }
    $decoded = base64_decode(substr($encoded, 6), true);
    $pair = $decoded === false ? [] : explode(':', $decoded, 2);
    $uid = rawurldecode($_SERVER['HTTP_X_NEXTCLOUD_USER'] ?? '');
    if (count($pair) === 2 && $pair[0] !== '' && $pair[1] !== '' && $uid !== '' && strlen($uid) < 256) {
        $auth = ['login' => $pair[0], 'password' => $pair[1], 'uid' => $uid];
    }
}
if ($action === 'verify' && $method === 'POST') {
    if (!$auth) reply(401, ['error' => 'Reconnect to Nextcloud.']);
    [$code] = upstream('GET', '/ocs/v2.php/cloud/user?format=json', $auth, null, ['Accept: application/json']);
    checkUpstream($code);
    reply(200, ['connected' => true]);
}
if ($action === 'unlink' && $method === 'POST') {
    if ($auth) {
        [$code] = upstream('DELETE', '/ocs/v2.php/core/apppassword', $auth);
        if (!in_array($code, [401, 404], true)) checkUpstream($code);
    }
    unset($_SESSION['pending']);
    session_regenerate_id(true);
    reply(200, ['connected' => false]);
}
if ($action !== 'file' || !in_array($method, ['GET', 'HEAD', 'PUT', 'DELETE'], true)) reply(405, ['error' => 'Unsupported operation.']);
if (!$auth) reply(401, ['error' => 'Connect to Nextcloud first.']);
$path = ltrim($_GET['path'] ?? '', '/');
if (strlen($path) > 1024 || !preg_match('~^[a-zA-Z0-9_.-]+(?:/[a-zA-Z0-9_.-]+)*\.(?:zip|json)$~', $path)) reply(400, ['error' => 'Invalid save path.']);
$parts = explode('/', $path);
if (in_array('.', $parts, true) || in_array('..', $parts, true)) reply(400, ['error' => 'Invalid save path.']);
$url = davRoot($auth) . '/' . implode('/', array_map('rawurlencode', $parts));
$body = null;
$headers = [];
if ($method === 'PUT') {
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_SAVE) reply(413, ['error' => 'Save exceeds the 64 MB limit.']);
    $body = file_get_contents('php://input', false, null, 0, MAX_SAVE + 1);
    if (strlen($body) > MAX_SAVE) reply(413, ['error' => 'Save exceeds the 64 MB limit.']);
    $parent = davRoot($auth);
    foreach (array_slice($parts, 0, -1) as $part) {
        $parent .= '/' . rawurlencode($part);
        [$code] = upstream('MKCOL', $parent, $auth);
        if ($code !== 405) checkUpstream($code);
    }
    $headers[] = 'Content-Type: application/octet-stream';
    if (!isset($_SERVER['HTTP_IF_MATCH']) && !isset($_SERVER['HTTP_IF_NONE_MATCH'])) reply(428, ['error' => 'Save version is required.']);
}
foreach (['HTTP_IF_MATCH' => 'If-Match', 'HTTP_IF_NONE_MATCH' => 'If-None-Match'] as $key => $name) {
    if (isset($_SERVER[$key])) {
        $value = $_SERVER[$key];
        if (strlen($value) > 256 || preg_match('/[\r\n]/', $value)) reply(400, ['error' => 'Invalid version.']);
        $headers[] = "$name: $value";
    }
}
// Release the session lock before long file transfers / parallel slot reads.
session_write_close();
[$code, $result, $etag] = upstream($method, $url, $auth, $body, $headers);
checkUpstream($code);
if ($etag) header('ETag: ' . $etag);
http_response_code($code);
header('Content-Type: application/octet-stream');
if ($method !== 'HEAD') echo $result;
