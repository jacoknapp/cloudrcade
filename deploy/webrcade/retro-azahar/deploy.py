#!/usr/bin/env python3
"""Build changed 3DS sources and publish a validated app; see README.md.

Run on the Docker host after syncing the source tree. Failed builds leave the
active app untouched. Old versioned assets remain available to existing clients.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import uuid

HERE = Path(__file__).resolve().parent
MANIFEST = 'deployment.json'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def files_under(root):
    return sorted(p for p in root.rglob('*') if p.is_file())


def inputs(source):
    paths = [source / 'build.sh']
    for directory in ('app', 'patches'):
        paths.extend(files_under(source / directory))
    if not (source / 'app/src/emulator/index.js').is_file():
        raise ValueError('Missing 3DS app source')
    records = {str(p.relative_to(source)): digest(p) for p in paths}
    stamp = hashlib.sha256(json.dumps(records, sort_keys=True).encode()).hexdigest()
    return stamp, records


def overlay_inputs(root):
    return {name: digest(root / name) for name in (
        'prepare-touch.py', 'patch-clock-core.py', 'touch/assets/controller.js',
        'touch/assets/controller.css', 'touch/cloud/bridge.js', 'touch/cloud/runtime.js')}


def inventory(root):
    return {str(p.relative_to(root)): digest(p) for p in files_under(root)}


def immutable(name):
    path = Path(name)
    return path.parts[0] in ('js', 'static') or path.name.startswith('cloud-main.')


def matches(root, records):
    return bool(records) and all((root / name).is_file() and digest(root / name) == value
                                 for name, value in records.items())


def atomic_copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.with_name(destination.name + '.deploy-new')
    try:
        shutil.copyfile(source, temp)
        temp.chmod(0o644)
        temp.replace(destination)
    finally:
        temp.unlink(missing_ok=True)


def validate_app(app, revision):
    html = (app / 'index.html').read_text()
    mains = re.findall(r'<script[^>]+src="([^"]*/main\.[^"]+\.js)"', html)
    if len(mains) != 1:
        raise ValueError('Built entry point must reference one main bundle')
    main = (app / mains[0]).resolve()
    if not main.is_relative_to(app.resolve()) or not main.is_file():
        raise ValueError('Built entry point references a missing/outside bundle')
    if revision not in main.read_text():
        raise ValueError('Main bundle does not reference the expected core revision')
    core = app / 'js' / revision
    if (core / 'azahar_libretro.wasm').read_bytes()[:8] != b'\0asm\x01\0\0\0':
        raise ValueError('Missing or invalid WASM core')
    if (core / 'azahar_libretro.js').stat().st_size == 0:
        raise ValueError('Empty core loader')
    for name in re.findall(r'(?:src|href)="([^"]+)"', html):
        if name.startswith('./static/') and not (app / name).is_file():
            raise ValueError(f'Missing entry point asset: {name}')


def build(source, work, output, revision):
    env = dict(os.environ, WORK=str(work), OUT=str(output), WEBRCADE_CORE_REVISION=revision)
    subprocess.run(['bash', str(source / 'build.sh')], env=env, check=True)


def make_overlay(root, app, staging):
    extras = staging / 'apps'
    extras.mkdir()
    (extras / 'retro-azahar').symlink_to(app.resolve(), target_is_directory=True)
    pages = staging / 'pages'
    subprocess.run(['python3', str(root / 'prepare-touch.py')], check=True, env=dict(
        os.environ, WEBRCADE_EXTRA_ONLY='1', WEBRCADE_EXTRA_APPS=str(extras),
        WEBRCADE_TOUCH_ROOT=str(pages)))
    overlay = pages / 'app/retro-azahar'
    html = (overlay / 'index.html').read_text()
    bundles = list(overlay.glob('cloud-main.*.js'))
    if len(bundles) != 1 or bundles[0].name not in html or 'WrcadCloud.install' not in bundles[0].read_text():
        raise ValueError('3DS cloud overlay validation failed')
    if '/touch-controls/controller.js?v=' not in html:
        raise ValueError('3DS controller overlay is missing')
    return overlay


def publish(app, overlay, target, target_overlay, manifest, state):
    """Write assets before entry points; restore entry points if activation fails."""
    activation = [target / 'index.html', target_overlay / 'index.html', state / MANIFEST]
    before = {p: p.read_bytes() if p.is_file() else None for p in activation}
    old_manifest = json.loads(before[state / MANIFEST] or b'{}')
    retired = [target / name for name in old_manifest.get('files', {})
               if name not in manifest['files'] and not immutable(name) and (target / name).is_file()]
    before.update({p: p.read_bytes() for p in retired})
    # Keep a durable rollback record for the last successfully replaced entry points.
    backup = state / 'previous'
    backup.mkdir(exist_ok=True)
    for index, path in enumerate(before):
        saved = backup / str(index)
        if before[path] is not None:
            saved.write_bytes(before[path])
        else:
            saved.unlink(missing_ok=True)
    (backup / 'paths.json').write_text(json.dumps([str(p) for p in before]))
    try:
        for source_root, dest_root, records in ((app, target, manifest['files']),
                                               (overlay, target_overlay, manifest['overlayFiles'])):
            for filename in records:
                name = Path(filename)
                source = source_root / name
                if str(name) == 'index.html':
                    continue
                dest = dest_root / name
                if dest.is_file() and digest(dest) == digest(source):
                    continue
                # Hashed bundles and versioned cores must never change beneath open clients.
                if immutable(name) and dest.exists():
                    raise ValueError(f'Refusing to overwrite a versioned asset: {dest}')
                atomic_copy(source, dest)
        atomic_copy(app / 'index.html', target / 'index.html')
        atomic_copy(overlay / 'index.html', target_overlay / 'index.html')
        for path in retired:
            path.unlink()
        temp = state / (MANIFEST + '.new')
        temp.write_text(json.dumps(manifest, indent=2) + '\n')
        temp.replace(state / MANIFEST)
    except BaseException:
        for path, content in before.items():
            if content is None:
                path.unlink(missing_ok=True)
            else:
                temp = path.with_name(path.name + '.rollback')
                temp.write_bytes(content)
                temp.chmod(0o644)
                temp.replace(path)
        raise


def save_candidate(app, overlay, manifest, state):
    candidate = state / 'candidate'
    with tempfile.TemporaryDirectory(prefix='candidate-', dir=state) as temporary:
        staging = Path(temporary)
        for folder, source, records in (('app', app, manifest['files']),
                                        ('overlay', overlay, manifest['overlayFiles'])):
            for name in records:
                atomic_copy(source / name, staging / folder / name)
        (staging / MANIFEST).write_text(json.dumps(manifest, indent=2) + '\n')
        if candidate.exists():
            shutil.rmtree(candidate)
        shutil.copytree(staging, candidate)


def activate_candidate(state, target, target_overlay, stamp, overlay_records):
    candidate = state / 'candidate'
    manifest = json.loads((candidate / MANIFEST).read_text())
    if manifest['sourceSha256'] != stamp or manifest['overlayInputs'] != overlay_records:
        raise ValueError('Staged candidate does not match current source/overlay inputs')
    app, overlay = candidate / 'app', candidate / 'overlay'
    if inventory(app) != manifest['files'] or inventory(overlay) != manifest['overlayFiles']:
        raise ValueError('Staged candidate is incomplete or has changed')
    validate_app(app, manifest['coreRevision'])
    publish(app, overlay, target, target_overlay, manifest, state)
    print(f"Activated staged 3DS revision {manifest['coreRevision']}", flush=True)


def deploy(root, source, work, stage_only=False, activate=False):
    state = root / '.3ds-deploy'
    state.mkdir(parents=True, exist_ok=True)
    with (state / 'deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        stamp, records = inputs(source)
        overlay_records = overlay_inputs(root)
        target = root / 'touch/apps/retro-azahar'
        target_overlay = root / 'touch/pages/app/retro-azahar'
        if activate:
            activate_candidate(state, target, target_overlay, stamp, overlay_records)
            return True
        try:
            previous = json.loads((state / MANIFEST).read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            previous = {}
        reuse = previous.get('sourceSha256') == stamp and matches(target, previous.get('files', {}))
        if (reuse and previous.get('overlayInputs') == overlay_records
                and matches(target_overlay, previous.get('overlayFiles', {}))):
            print('3DS source and deployed assets match; no build needed', flush=True)
            return False
        with tempfile.TemporaryDirectory(prefix='stage-', dir=state) as temporary:
            stage = Path(temporary)
            if reuse:
                app, revision = target, previous['coreRevision']
                print('3DS core/app unchanged; regenerating page overlay', flush=True)
            else:
                revision = 'build-' + stamp[:12] + '-' + uuid.uuid4().hex[:8]
                snapshot = stage / 'source'
                for name in records:
                    atomic_copy(source / name, snapshot / name)
                if inputs(snapshot)[0] != stamp:
                    raise ValueError('Source changed during deployment snapshot')
                app = stage / 'dist'
                print(f'Building 3DS revision {revision}', flush=True)
                build(snapshot, work, app, revision)
            validate_app(app, revision)
            overlay = make_overlay(root, app, stage)
            if inputs(source)[0] != stamp or overlay_inputs(root) != overlay_records:
                raise ValueError('Deployment inputs changed during build; retry with the new inputs')
            # Only the current release files belong in the manifest, not retained old assets.
            artifact_records = previous['files'] if reuse else inventory(app)
            manifest = dict(sourceSha256=stamp, buildInputs=records, coreRevision=revision,
                            files=artifact_records, overlayInputs=overlay_records,
                            overlayFiles=inventory(overlay))
            if stage_only:
                save_candidate(app, overlay, manifest, state)
                print(f'Staged 3DS revision {revision}; live entry point unchanged', flush=True)
                return True
            publish(app, overlay, target, target_overlay, manifest, state)
        print(f'Deployed 3DS revision {revision}', flush=True)
        return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=HERE.parent)
    parser.add_argument('--work', type=Path, help='Dedicated scratch checkout/build directory')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--stage-only', action='store_true', help='Build a candidate without publishing')
    mode.add_argument('--activate', action='store_true', help='Validate and publish the staged candidate')
    args = parser.parse_args()
    root = args.root.resolve()
    work = (args.work or root / '.3ds-deploy/work').resolve()
    deploy(root, HERE, work, stage_only=args.stage_only, activate=args.activate)


if __name__ == '__main__':
    main()
