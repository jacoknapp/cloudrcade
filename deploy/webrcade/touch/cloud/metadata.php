<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Cross-Origin-Resource-Policy: same-origin');
$key = $_GET['key'] ?? '';
if (!is_string($key) || !preg_match('/^[a-f0-9]{64}$/D', $key)) {
    http_response_code(400);
    echo '{"available":false}';
    exit;
}
$process = proc_open(['python3', '/usr/local/share/cloudrcade/metadata_lookup.py', $key],
    [0 => ['file', '/dev/null', 'r'], 1 => ['pipe', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
if (!is_resource($process)) { echo '{"available":false}'; exit; }
$output = stream_get_contents($pipes[1], 32768);
fclose($pipes[1]);
$status = proc_close($process);
echo $status === 0 && is_array(json_decode($output, true)) ? $output : '{"available":false}';
