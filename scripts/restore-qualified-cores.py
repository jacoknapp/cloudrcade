#!/usr/bin/env python3
"""Restore unchanged core artifacts and corresponding source from qualified CI.

Prefer the branch's last successful published release, pinned by OCI digest and
verified source provenance. The recorded qualified release is an offline/API
fallback. Only matching effective inputs can be resealed for current cache keys.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import quote

spec = importlib.util.spec_from_file_location('core_cache', Path(__file__).with_name('core-cache.py'))
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)
SOURCE = '2106cfe3e4b0958fbe63307cd48b1ca042e7e67c'
IMAGE = 'ghcr.io/jacoknapp/cloudrcade@sha256:0d0bcf6d39615657edce98440add4647f591fa0384ac834f7394637cc9ba4a85'


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, timeout=120, stderr=subprocess.DEVNULL)


def unchanged(core, root, source=SOURCE):
    try:
        return cache.input_records(core, root, source) == cache.input_records(core, root)
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError):
        return False


def read_json(*args):
    return json.loads(subprocess.check_output(args, text=True, timeout=120, stderr=subprocess.DEVNULL))


def provenance_args(value):
    if isinstance(value, dict):
        if 'vcs:revision' in value and 'vcs:source' in value:
            return value
        for child in value.values():
            found = provenance_args(child)
            if found: return found
    elif isinstance(value, list):
        for child in value:
            found = provenance_args(child)
            if found: return found
    return None


def qualified_release():
    """Resolve a prior successful CI publication, never a mutable alias alone."""
    repo = os.environ.get('GITHUB_REPOSITORY', '')
    branch = os.environ.get('GITHUB_BASE_REF') or os.environ.get('GITHUB_REF_NAME', '')
    head = os.environ.get('GITHUB_SHA', '')
    if not (re.fullmatch(r'[\w.-]+/[\w.-]+', repo) and branch and
            re.fullmatch(r'[a-f0-9]{40}', head) and os.environ.get('GH_TOKEN')):
        return SOURCE, IMAGE
    try:
        # Stable promotions can inherit qualified cores published on beta.
        # Ancestry/provenance below and exact inputs in restore still apply.
        branch_filter = '' if branch == 'main' else f'branch={quote(branch, safe="")}&'
        runs = read_json('gh', 'api', f'repos/{repo}/actions/workflows/docker.yml/runs?{branch_filter}status=success&per_page=10')
        for run in runs['workflow_runs']:
            source = run['head_sha']
            if run['event'] not in ('push', 'workflow_dispatch') or not re.fullmatch(r'[a-f0-9]{40}', source):
                continue
            comparison = read_json('gh', 'api', f'repos/{repo}/compare/{source}...{head}')
            if comparison['status'] not in ('ahead', 'identical'):
                continue
            tag = f'ghcr.io/{repo.lower()}:sha-{source}'
            manifest = read_json('docker', 'buildx', 'imagetools', 'inspect', tag, '--format', '{{json .Manifest}}')
            if not re.fullmatch(r'sha256:[a-f0-9]{64}', manifest['digest']):
                raise ValueError('Invalid published digest')
            image = f'ghcr.io/{repo.lower()}@{manifest["digest"]}'
            provenance = read_json('docker', 'buildx', 'imagetools', 'inspect', image, '--format', '{{json .Provenance}}')
            args = provenance_args(provenance)
            if not args or args['vcs:revision'] != source or args['vcs:source'].lower() != f'https://github.com/{repo.lower()}':
                raise ValueError('Qualified publication provenance mismatch')
            print('Using prior successful CI publication ' + source[:12], flush=True)
            return source, image
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        print('Prior branch publication unavailable; checking pinned qualified release', flush=True)
    return SOURCE, IMAGE


def restore(root=cache.ROOT):
    if os.environ.get('FORCE_CORE_REBUILD') == 'true':
        print('Forced source build: qualified release cache bypassed', flush=True)
        return
    pending = [core for core in cache.COMMANDS
               if not cache.reusable(core, root / 'release' / core, cache.identity(core, root), root)]
    if not pending:
        print('All core packages already have verified exact-input caches', flush=True)
        return
    source, image = qualified_release()
    try:
        git(root, 'cat-file', '-e', source)
    except subprocess.CalledProcessError:
        subprocess.run(['git', 'fetch', '--depth', '1', 'origin', source], cwd=root, check=True, timeout=120)
    selected = [core for core in pending if unchanged(core, root, source)]
    natives = [core for core in ('gamecube', 'ps2', 'wii') if core in pending and
               not cache.native_valid(root / 'release' / (core + '-native'), root, core) and
               unchanged(core + '-native', root, source)]
    if not selected and not natives:
        print('Only changed core inputs need builds; no qualified packages to restore', flush=True)
        return
    subprocess.run(['docker', 'pull', '--platform', 'linux/amd64', image], check=True)
    container = subprocess.check_output(['docker', 'create', '--platform', 'linux/amd64', image], text=True).strip()
    apps = {'3ds': '/var/www/touch/apps/retro-azahar', 'psp': '/var/www/touch/apps/retro-ppsspp',
            'gamecube': '/var/www/html/experimental/gamecube', 'ps2': '/var/www/html/experimental/ps2',
            'wii': '/var/www/html/experimental/wii'}
    def copy(path, output):
        output.mkdir(parents=True, exist_ok=True)
        subprocess.run(['docker', 'cp', container + ':' + path, str(output)], check=True)
    try:
        for core in selected:
            output = root / 'release' / core
            if output.exists(): shutil.rmtree(output)
            copy(apps[core] + '/.', output / 'app')
            if core not in ('gamecube', 'wii'):
                copy('/var/www/html/licenses/sources/' + core + '-source.tar.gz', output / 'sources')
            cache.seal(core, output, cache.identity(core, root), root)
            print('Restored verified unchanged ' + core + ' runtime and corresponding source', flush=True)
        for core in natives:
            native = root / 'release' / (core + '-native')
            if native.exists(): shutil.rmtree(native)
            copy(apps[core] + ('/core/.' if core == 'ps2' else '/cores/dolphin/.'), native)
            if not cache.native_valid(native, root, core):
                shutil.rmtree(native)
                raise ValueError('Qualified ' + core + ' native artifact/source lock mismatch')
            print('Restored verified unchanged ' + core + ' native artifacts', flush=True)
    finally:
        subprocess.run(['docker', 'rm', container], check=True)


if __name__ == '__main__':
    restore()
