<?php
declare(strict_types=1);
require_once __DIR__ . '/settings.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Cross-Origin-Resource-Policy: same-origin');
header_remove('Access-Control-Allow-Origin');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET'); http_response_code(405); exit;
}
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$site = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
if (($origin !== '' && $origin !== cloudUrl('WEBRCADE_PUBLIC_URL', true)) ||
    ($site !== '' && $site !== 'same-origin' && $site !== 'none')) {
    http_response_code(403); exit;
}
$path = n3dsKeysPath();
if (!cloudBool('WEBRCADE_ENABLE_3DS') || $path === '') {
    http_response_code(404); exit;
}
// Fixed operator-selected file only: no file names or paths accepted from requests.
$data = @file_get_contents($path);
if ($data === false || strlen($data) === 0 || strlen($data) > 262144) {
    http_response_code(404); exit;
}
header('Content-Type: application/octet-stream');
echo $data;
