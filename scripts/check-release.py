#!/usr/bin/env python3
"""Reject operator configuration, keys and personal hosts in release source."""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
for scope in ('deploy', 'integrations', 'scripts', 'tests', 'docs', '.github'):
    for path in (ROOT / scope).rglob('*'):
        if not path.is_file() or '__pycache__' in path.parts:
            continue
        if path.name in {'webrcade.env', 'handoff.env', 'aes_keys.txt', 'keys.txt',
                         'keys.bin', 'default_keys.h', 'boot9.bin', 'boot11.bin'}:
            raise SystemExit(f'Operator file in release source: {path.relative_to(ROOT)}')
        if path.suffix in {'.png', '.pyc'}:
            continue
        content = path.read_text()
        # Construct signatures so this checker does not match its own strings.
        forbidden = [r'https?://[^\s\"<>]*\.pro\b', r'192' + r'\.168\.',
                     r'[A-Za-z0-9_.+-]+@(?:gmail|hotmail|outlook|yahoo)\.com',
                     '/opt/' + 'Claude', '-----BEGIN ' + 'PRIVATE KEY-----', r'gh' + r'[opusr]_[A-Za-z0-9]{30,}']
        if any(re.search(pattern, content) for pattern in forbidden):
            raise SystemExit(f'Personal configuration or credential pattern: {path.relative_to(ROOT)}')
for path in (ROOT / 'deploy').rglob('*.php'):
    subprocess.run(['php', '-l', str(path)], check=True, capture_output=True)
for path in (ROOT / 'integrations').rglob('*.php'):
    subprocess.run(['php', '-l', str(path)], check=True, capture_output=True)
print('PASS release source excludes operator data; PHP syntax valid')
