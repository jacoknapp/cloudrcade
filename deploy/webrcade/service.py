#!/usr/bin/env python3
"""Run the web server, CORS helper and scheduled feed builder as one app."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

HERE = Path(__file__).resolve().parent
SCAN = [sys.executable, str(HERE / 'refresh-feed.py')]
if sys.argv[1:] == ['scan']:
    raise SystemExit(subprocess.call(SCAN))
if sys.argv[1:]:
    raise SystemExit('Usage: service.py [scan]')

stop = threading.Event()
children = []
for sig in (signal.SIGTERM, signal.SIGINT):
    signal.signal(sig, lambda *_: stop.set())

enabled = os.getenv('WEBRCADE_SCAN_ENABLED', 'true').strip().lower() in {'1', 'true', 'yes', 'on'}
try:
    interval = int(os.getenv('WEBRCADE_SCAN_INTERVAL_SECONDS', '21600'))
    if interval < 1:
        raise ValueError()
except ValueError:
    raise SystemExit('WEBRCADE_SCAN_INTERVAL_SECONDS must be a positive integer')

state = Path(os.getenv('WEBRCADE_STATE_PATH', '/data'))
(state / 'feeds').mkdir(parents=True, exist_ok=True)
(state / 'derived').mkdir(parents=True, exist_ok=True)
feed = state / 'feeds/combined.json'
if enabled and not feed.exists():
    # A valid empty library is available while the initial scan runs.
    feed.write_text(json.dumps({'title': os.getenv('WEBRCADE_FEED_TITLE', 'CloudRcade'),
                               'description': 'Initial library scan in progress.',
                               'categories': []}) + '\n')

def spawn(argv):
    child = subprocess.Popen(argv, start_new_session=True)
    children.append(child)
    return child

def scans():
    while not stop.is_set():
        child = spawn(SCAN)
        code = child.wait()
        children.remove(child)
        if code:
            print(f'Feed scan failed ({code}); previous feed retained; retry in {interval}s.', flush=True)
        else:
            print(f'Feed scan complete; next scan in {interval}s.', flush=True)
        stop.wait(interval)

def terminate(child, sig):
    try:
        os.killpg(child.pid, sig)
    except ProcessLookupError:
        pass

exit_code = 0
worker = None
try:
    subprocess.run(['/usr/local/bin/generate-certificate.sh'], check=True)
    subprocess.run(['/usr/local/bin/setup-https.sh'], check=True)
    cors = spawn(['miniflare', '/var/www/cors.js'])
    apache = spawn(['apache2-foreground'])
    if enabled:
        worker = threading.Thread(target=scans, name='feed-builder')
        worker.start()
    while not stop.wait(0.5):
        for child in (cors, apache):
            code = child.poll()
            if code is not None:
                print(f'Web process exited ({code}); restarting the app is required.', flush=True)
                exit_code = code or 1
                stop.set()
finally:
    stop.set()
    for child in list(children):
        terminate(child, signal.SIGTERM)
    deadline = time.monotonic() + 8
    while any(child.poll() is None for child in list(children)) and time.monotonic() < deadline:
        time.sleep(0.1)
    for child in list(children):
        if child.poll() is None:
            terminate(child, signal.SIGKILL)
        child.wait()
    if worker is not None:
        worker.join(timeout=2)
raise SystemExit(exit_code)
