<?php
declare(strict_types=1);
// Bounded core diagnostics go to the app's existing Apache/PHP logs.
// This endpoint never accesses saves, accounts, ROMs or arbitrary log strings.
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Cross-Origin-Resource-Policy: same-origin');
ini_set('display_errors', '0');
function crashReply(int $status): never { http_response_code($status); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') crashReply(405);
$origin = parse_url($_SERVER['HTTP_ORIGIN'] ?? '');
$host = parse_url('https://' . ($_SERVER['HTTP_HOST'] ?? ''));
$scheme = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http';
if (!$origin || !$host || isset($origin['user']) || isset($origin['pass']) || !empty($origin['path']) || isset($origin['query']) || isset($origin['fragment']) || ($origin['scheme'] ?? '') !== $scheme ||
    strtolower($origin['host'] ?? '') !== strtolower($host['host'] ?? '') ||
    ($origin['port'] ?? ($scheme === 'https' ? 443 : 80)) !== ($host['port'] ?? ($scheme === 'https' ? 443 : 80))) crashReply(403);
if (!preg_match('~^application/json(?:\s*;|$)~i', $_SERVER['CONTENT_TYPE'] ?? '')) crashReply(415);
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 4096) crashReply(413);
$body = file_get_contents('php://input', false, null, 0, 4097);
if ($body === false || strlen($body) > 4096) crashReply(413);
$value = json_decode($body, true, 8);
$phases = ['starting', 'playing', 'paused', 'saving state', 'loading state', 'closing', 'failed'];
$reasons = ['interrupted', 'gpu-device-lost', 'gpu-completion', 'core-abort', 'core-timeout',
    'no-frame-progress', 'worker-failure', 'unknown-runtime-failure', 'memory-failure', 'wasm-trap', 'gpu-validation', 'host-exception', 'verification'];
if (!is_array($value) || ($value['version'] ?? null) !== 1 ||
    !is_string($value['id'] ?? null) || !preg_match('/^[a-z0-9-]{1,64}$/D', $value['id']) ||
    !in_array($value['phase'] ?? null, $phases, true) || !in_array($value['reason'] ?? null, $reasons, true)) crashReply(400);
if (!is_string($value['system'] ?? null) || !preg_match('/^[a-z0-9-]{1,40}$/D', $value['system'])) crashReply(400);
$report = ['system' => $value['system'], 'schema' => 'cloudrcade.core.crash.v1', 'id' => $value['id'],
    'reason' => $value['reason'], 'phase' => $value['phase']];
foreach (['started', 'updated'] as $key) {
    if (is_int($value[$key] ?? null) && $value[$key] >= 0 && $value[$key] <= 8640000000000000) $report[$key] = $value[$key];
}
if (is_string($value['game'] ?? null) && preg_match('/^[A-Z0-9]{6}$/D', $value['game'])) $report['game'] = $value['game'];
foreach (['core', 'runtime'] as $key) {
    if (is_string($value[$key] ?? null) && preg_match('/^[a-f0-9]{12}$/D', $value[$key])) $report[$key] = $value[$key];
}
$sample = is_array($value['sample'] ?? null) ? $value['sample'] : [];
foreach (['frame', 'rendered', 'lastPresentMs', 'heapMiB', 'compiled', 'textures', 'bindings', 'shaders',
    'failedShaders', 'gpuPending', 'gpuCompleted', 'gpuFenceMs', 'backlog', 'discWaitMaxMs'] as $key) {
    $number = $sample[$key] ?? null;
    if ((is_int($number) || is_float($number)) && is_finite((float)$number) && $number >= 0 && $number <= 9007199254740991) $report['sample'][$key] = $number;
}
if (!error_log('[Core crash] ' . json_encode($report, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR))) crashReply(503);
crashReply(204);
