"""Qualified release reuse must reject changed source/flags and forced builds."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('qualified', ROOT / 'scripts/restore-qualified-cores.py')
qualified = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qualified)


class QualifiedRestoreTest(unittest.TestCase):
    def test_snapshot_rejects_modified_added_and_missing_core_inputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            path = root / 'deploy/webrcade/retro-ppsspp/build.sh'
            path.parent.mkdir(parents=True)
            path.write_text('pinned compiler recipe')
            subprocess.run(['git', 'add', '.'], cwd=root, check=True)
            subprocess.run(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                            'commit', '-qm', 'qualified snapshot'], cwd=root, check=True)
            source = qualified.git(root, 'rev-parse', 'HEAD').decode().strip()
            self.assertTrue(qualified.unchanged('psp', root, source))
            # Unrelated UI/release scheduling changes don't rebuild this core.
            (root / 'README.md').write_text('release metadata')
            self.assertTrue(qualified.unchanged('psp', root, source))
            path.write_text('changed compiler recipe')
            self.assertFalse(qualified.unchanged('psp', root, source))
            path.write_text('pinned compiler recipe')
            added = path.with_name('new.patch')
            added.write_text('added build input')
            self.assertFalse(qualified.unchanged('psp', root, source))
            added.unlink()
            path.unlink()
            self.assertFalse(qualified.unchanged('psp', root, source))

    def test_toolchain_and_environment_changes_reject_reuse(self):
        workflow = 'runs-on: ubuntu-24.04\nenv:\n  FORCE_CORE_REBUILD: false\nsteps:\n  - uses: actions/setup-node@v4\n    node-version: 22\n'
        self.assertEqual(qualified.toolchain(workflow), qualified.toolchain(workflow + 'branches: [main]\n'))
        for changed in [workflow.replace('22', '24'), workflow.replace('ubuntu-24.04', 'ubuntu-26.04'),
                        workflow.replace('setup-node@v4', 'setup-node@v5'),
                        workflow.replace('env:\n', 'env:\n  CXXFLAGS: changed\n')]:
            self.assertNotEqual(qualified.toolchain(workflow), qualified.toolchain(changed))

    def test_force_bypasses_even_source_inspection_and_docker(self):
        with patch.dict(os.environ, {'FORCE_CORE_REBUILD': 'true'}), \
                patch.object(qualified, 'git', side_effect=AssertionError('must not inspect old inputs')), \
                patch.object(qualified.subprocess, 'run', side_effect=AssertionError('must not restore')):
            qualified.restore()


if __name__ == '__main__':
    unittest.main()
