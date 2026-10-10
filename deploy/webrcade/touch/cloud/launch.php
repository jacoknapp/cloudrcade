<?php
declare(strict_types=1);
require_once __DIR__ . '/settings.php';
header('Cache-Control: no-store');
$feed = cloudConfig()['feedUrl'];
if (isset($_GET['feed']) || parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) === '/play/default-feed.json') header('Location: ' . $feed, true, 302);
else header('Location: /play/?feed=' . rawurlencode($feed), true, 302);
