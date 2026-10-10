"""Publication failures must never activate an incomplete 3DS build."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'deploy/webrcade/retro-azahar/deploy.py'
SPEC = importlib.util.spec_from_file_location('deploy_3ds', SCRIPT)
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'retro-azahar'
        self.write(self.source / 'build.sh', 'builder')
        self.write(self.source / 'app/src/emulator/index.js', 'app')
        self.write(self.source / 'patches/core.patch', 'patch')
        for name in ('prepare-touch.py', 'patch-clock-core.py', 'touch/assets/controller.js',
                     'touch/assets/controller.css', 'touch/cloud/bridge.js', 'touch/cloud/runtime.js'):
            self.write(self.root / name, name)
        self.target = self.root / 'touch/apps/retro-azahar'
        self.overlay = self.root / 'touch/pages/app/retro-azahar'
        self.builder = patch.object(deploy, 'build', side_effect=self.build).start()
        self.overlayer = patch.object(deploy, 'make_overlay', side_effect=self.make_overlay).start()
        self.addCleanup(patch.stopall)

    @staticmethod
    def write(path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def build(self, source, work, output, revision):
        self.assertEqual(deploy.inputs(source)[0], deploy.inputs(self.source)[0])
        main = f'./static/js/main.{revision}.js'
        self.write(output / 'index.html', f'<html><head></head><script src="{main}"></script></html>')
        self.write(output / main, revision)
        self.write(output / 'js' / revision / 'azahar_libretro.js', 'loader')
        (output / 'js' / revision / 'azahar_libretro.wasm').write_bytes(b'\0asm\x01\0\0\0')

    def make_overlay(self, root, app, stage):
        output = stage / 'pages/app/retro-azahar'
        name = 'cloud-main.' + deploy.digest(app / 'index.html')[:16] + '.js'
        self.write(output / name, 'WrcadCloud.install')
        controls = (root / 'touch/assets/controller.js').read_text()
        self.write(output / 'index.html', f'<script src="{name}"></script>' + controls)
        return output

    def run_deploy(self):
        return deploy.deploy(self.root, self.source, self.root / 'work')

    def manifest(self):
        return json.loads((self.root / '.3ds-deploy/deployment.json').read_text())

    def active(self):
        return ((self.target / 'index.html').read_bytes(),
                (self.overlay / 'index.html').read_bytes(), self.manifest())

    def test_fresh_deploy_and_noop(self):
        self.assertTrue(self.run_deploy())
        self.assertFalse(self.run_deploy())
        self.assertEqual(self.builder.call_count, 1)
        self.assertTrue(deploy.matches(self.target, self.manifest()['files']))

    def test_source_change_preserves_previous_assets(self):
        self.run_deploy()
        old = self.manifest()['coreRevision']
        self.write(self.source / 'patches/core.patch', 'updated patch')
        self.run_deploy()
        self.assertNotEqual(old, self.manifest()['coreRevision'])
        self.assertTrue((self.target / 'js' / old / 'azahar_libretro.wasm').is_file())

    def test_overlay_change_does_not_recompile(self):
        self.run_deploy()
        revision = self.manifest()['coreRevision']
        self.write(self.root / 'touch/assets/controller.js', 'new controls')
        self.assertTrue(self.run_deploy())
        self.assertEqual(self.builder.call_count, 1)
        self.assertEqual(self.manifest()['coreRevision'], revision)
        self.assertIn('new controls', (self.overlay / 'index.html').read_text())
        self.assertFalse(self.run_deploy())

    def test_failed_build_keeps_active_release(self):
        self.run_deploy()
        before = self.active()
        self.write(self.source / 'patches/core.patch', 'bad patch')
        self.builder.side_effect = RuntimeError('compiler failed')
        with self.assertRaisesRegex(RuntimeError, 'compiler failed'):
            self.run_deploy()
        self.assertEqual(self.active(), before)

    def test_missing_core_triggers_rebuild(self):
        self.run_deploy()
        (self.target / 'js' / self.manifest()['coreRevision'] / 'azahar_libretro.wasm').unlink()
        self.assertTrue(self.run_deploy())
        self.assertEqual(self.builder.call_count, 2)

    def test_source_change_during_build_aborts(self):
        self.run_deploy()
        before = self.active()
        self.write(self.source / 'patches/core.patch', 'first change')
        def changing_build(*args):
            self.build(*args)
            self.write(self.source / 'patches/core.patch', 'second change')
        self.builder.side_effect = changing_build
        with self.assertRaisesRegex(ValueError, 'inputs changed'):
            self.run_deploy()
        self.assertEqual(self.active(), before)

    def test_overlay_failure_keeps_active_release(self):
        self.run_deploy()
        before = self.active()
        self.write(self.root / 'touch/assets/controller.js', 'updated')
        self.overlayer.side_effect = RuntimeError('overlay failed')
        with self.assertRaisesRegex(RuntimeError, 'overlay failed'):
            self.run_deploy()
        self.assertEqual(self.active(), before)

    def test_activation_failure_restores_entrypoints(self):
        self.run_deploy()
        before = self.active()
        self.write(self.source / 'patches/core.patch', 'new patch')
        original = deploy.atomic_copy
        def fail_activation(source, target):
            if target == self.overlay / 'index.html':
                raise OSError('injected activation failure')
            original(source, target)
        with patch.object(deploy, 'atomic_copy', side_effect=fail_activation):
            with self.assertRaisesRegex(OSError, 'activation failure'):
                self.run_deploy()
        self.assertEqual(self.active(), before)

    def test_stage_then_activate_without_second_build(self):
        deploy.deploy(self.root, self.source, self.root / 'work', stage_only=True)
        self.assertFalse((self.target / 'index.html').exists())
        deploy.deploy(self.root, self.source, self.root / 'work', activate=True)
        self.assertEqual(self.builder.call_count, 1)
        self.assertFalse(self.run_deploy())

    def test_changed_candidate_cannot_activate(self):
        deploy.deploy(self.root, self.source, self.root / 'work', stage_only=True)
        self.write(self.root / '.3ds-deploy/candidate/app/index.html', 'corrupted')
        with self.assertRaisesRegex(ValueError, 'candidate is incomplete or has changed'):
            deploy.deploy(self.root, self.source, self.root / 'work', activate=True)
        self.assertFalse((self.target / 'index.html').exists())

    def test_stale_candidate_cannot_activate(self):
        deploy.deploy(self.root, self.source, self.root / 'work', stage_only=True)
        self.write(self.source / 'patches/core.patch', 'changed since staging')
        with self.assertRaisesRegex(ValueError, 'does not match current'):
            deploy.deploy(self.root, self.source, self.root / 'work', activate=True)

    def test_invalid_wasm_cannot_publish(self):
        def broken_build(source, work, output, revision):
            self.build(source, work, output, revision)
            (output / 'js' / revision / 'azahar_libretro.wasm').write_bytes(b'invalid')
        self.builder.side_effect = broken_build
        with self.assertRaisesRegex(ValueError, 'invalid WASM'):
            self.run_deploy()
        self.assertFalse((self.target / 'index.html').exists())

    def test_deleted_unversioned_file_is_retired(self):
        def with_diagnostic(*args):
            self.build(*args)
            self.write(args[2] / 'diag.html', 'old diagnostic')
        self.builder.side_effect = with_diagnostic
        self.run_deploy()
        old_revision = self.manifest()['coreRevision']
        self.assertTrue((self.target / 'diag.html').exists())
        self.builder.side_effect = self.build
        self.write(self.source / 'patches/core.patch', 'new source without diagnostic')
        self.run_deploy()
        self.assertFalse((self.target / 'diag.html').exists())
        self.assertTrue((self.target / 'js' / old_revision / 'azahar_libretro.wasm').exists())
        paths = json.loads((self.root / '.3ds-deploy/previous/paths.json').read_text())
        self.assertIn(str(self.target / 'diag.html'), paths)

    def test_added_candidate_file_is_rejected(self):
        deploy.deploy(self.root, self.source, self.root / 'work', stage_only=True)
        self.write(self.root / '.3ds-deploy/candidate/app/unexpected.html', 'extra')
        with self.assertRaisesRegex(ValueError, 'candidate is incomplete or has changed'):
            deploy.deploy(self.root, self.source, self.root / 'work', activate=True)

    def test_retirement_failure_restores_deleted_files_and_entrypoints(self):
        def with_diagnostics(*args):
            self.build(*args)
            self.write(args[2] / 'diag-a.html', 'first')
            self.write(args[2] / 'diag-b.html', 'second')
        self.builder.side_effect = with_diagnostics
        self.run_deploy()
        before = self.active()
        self.builder.side_effect = self.build
        self.write(self.source / 'patches/core.patch', 'remove diagnostics')
        original = Path.unlink
        def fail_second(path, *args, **kwargs):
            if path == self.target / 'diag-b.html':
                raise OSError('injected retirement failure')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'unlink', fail_second):
            with self.assertRaisesRegex(OSError, 'retirement failure'):
                self.run_deploy()
        self.assertEqual(self.active(), before)
        self.assertEqual((self.target / 'diag-a.html').read_text(), 'first')
        self.assertEqual((self.target / 'diag-b.html').read_text(), 'second')

    def test_real_build_cleanup_removes_deleted_source_and_public_files(self):
        scratch = self.root / 'scratch/webrcade-app-retro-azahar'
        scratch.mkdir(parents=True)
        subprocess.run(['git', 'init', '-q', str(scratch)], check=True)
        for name in ('src/index.js', 'public/manifest.json'):
            self.write(scratch / name, 'pinned scaffold')
        subprocess.run(['git', '-C', str(scratch), 'add', '.'], check=True)
        self.write(scratch / 'src/old-component.js', 'deleted custom source')
        self.write(scratch / 'public/diag.html', 'deleted custom page')
        self.write(scratch / 'public/js/old/core.wasm', 'old generated core')
        text = SCRIPT.with_name('build.sh').read_text()
        cleanup = text[text.index('APP="$WORK/webrcade-app-retro-azahar"'):text.index('for stale in ')]
        subprocess.run(['bash', '-ec', cleanup], env=dict(os.environ, WORK=str(scratch.parent)), check=True)
        self.assertTrue((scratch / 'src/index.js').is_file())
        self.assertTrue((scratch / 'public/manifest.json').is_file())
        self.assertFalse((scratch / 'src/old-component.js').exists())
        self.assertFalse((scratch / 'public/diag.html').exists())
        self.assertFalse((scratch / 'public/js').exists())


if __name__ == '__main__':
    unittest.main()
