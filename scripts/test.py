#!/usr/bin/env python3
"""Run portable, synthetic regression tests without ROMs, keys or accounts."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
# These tests require actual patched build sources; retain them for core
# maintainers but do not pretend a standard overlay build exercises native code.
# The GameCube texture-decode test needs GAMECUBE_PATCHED_WORKER from prepare.py.
native = {'test_webrcade_3ds_cache.cjs', 'test_webrcade_3ds_keyboard.cjs',
          'test_webrcade_3ds_state_info.cjs', 'test_webrcade_gamecube_texture_decode.cjs'}
for path in sorted((ROOT / 'tests').glob('test_webrcade*.cjs')):
    if path.name not in native:
        subprocess.run(['node', str(path)], cwd=ROOT, check=True)
for name in ['test_core_cache.py', 'test_qualified_core_restore.py', 'test_webrcade_3ds_deploy.py', 'test_webrcade_refresh.py', 'test_webrcade_metadata.py',
             'test_webrcade_cloud_config.py', 'test_webrcade_login_recovery.py', 'test_webrcade_ps2_source_archive.py']:
    subprocess.run([sys.executable, str(ROOT / 'tests' / name)], cwd=ROOT, check=True)
subprocess.run(['php', str(ROOT / 'integrations/nextcloud/tests/connect-controller.php')],
               cwd=ROOT, check=True)
print('PASS portable regression suite')
