<?php
declare(strict_types=1);
require_once __DIR__ . '/settings.php';
header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Cross-Origin-Resource-Policy: same-origin');
echo 'window.WrcadCloudConfig = ' . json_encode(cloudConfig(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES) . ';';

// Loaded before emulator bootstrap for every core, including cached core packages.
readfile(__DIR__ . '/core-crash.js');
