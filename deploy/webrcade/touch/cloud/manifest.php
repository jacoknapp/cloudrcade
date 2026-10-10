<?php
declare(strict_types=1);
require_once __DIR__ . '/settings.php';
header('Content-Type: application/manifest+json');
header('Cache-Control: no-store');
$name = cloudConfig()['appName'];
echo json_encode(['name' => $name, 'short_name' => $name, 'start_url' => '/play/',
    'scope' => '/', 'display' => 'fullscreen', 'display_override' => ['fullscreen', 'standalone'], 'background_color' => '#000000',
    'theme_color' => '#000000', 'icons' => [
        ['src' => '/touch-controls/cloudrcade-192.png', 'sizes' => '192x192', 'type' => 'image/png'],
        ['src' => '/touch-controls/cloudrcade-512.png', 'sizes' => '512x512', 'type' => 'image/png']
    ]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
