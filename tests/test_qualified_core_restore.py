"""Only unchanged effective source/toolchain inputs may use qualified outputs."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('qualified', ROOT / 'scripts/restore-qualified-cores.py')
qualified = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qualified)


class QualifiedRestoreTest(unittest.TestCase):
    def test_snapshot_checks_sources_commands_and_effective_environment(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            subprocess.run(['git','init','-q',str(root)],check=True)
            for name in ['scripts/core-cache.py','.github/workflows/docker.yml']:
                target=root/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,target)
            path=root/'deploy/webrcade/retro-ppsspp/build.sh'
            path.parent.mkdir(parents=True);path.write_text('pinned compiler recipe')
            ps2=root/'deploy/webrcade/retro-play/build-linux.sh';ps2.parent.mkdir(parents=True);ps2.write_text('pinned compiler')
            native_patch=ps2.with_name('patch-native.py');native_patch.write_text('pinned native patch')
            subprocess.run(['git','add','.'],cwd=root,check=True)
            subprocess.run(['git','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','qualified snapshot'],cwd=root,check=True)
            source=qualified.git(root,'rev-parse','HEAD').decode().strip()
            self.assertTrue(qualified.unchanged('ps2-native',root,source),'historical wildcard inputs match working inputs')
            native_patch.write_text('changed native patch')
            self.assertFalse(qualified.unchanged('ps2-native',root,source),'changed native patches cannot reuse qualified binaries')
            native_patch.write_text('pinned native patch')
            self.assertTrue(qualified.unchanged('psp',root,source))
            (root/'README.md').write_text('unrelated docs')
            path.with_name('README.md').write_text('unused operator guide')
            self.assertTrue(qualified.unchanged('psp',root,source))
            workflow=root/'.github/workflows/docker.yml';original=workflow.read_text()
            workflow.write_text(original.replace('Prepare PSP (reuse unchanged builds)','Changed label')+'\n# scheduling change\n')
            self.assertTrue(qualified.unchanged('psp',root,source))
            workflow.write_text(original.replace("node-version: '22'","node-version: '24'"))
            self.assertTrue(qualified.unchanged('psp',root,source)) # PSP uses Docker's pinned Node.
            self.assertFalse(qualified.unchanged('ps2',root,source))
            workflow.write_text(original.replace('    env:\n','    env:\n      CXXFLAGS: changed\n',1))
            self.assertFalse(qualified.unchanged('psp',root,source))
            workflow.write_text(original)
            with patch.dict(qualified.cache.COMMANDS,{'psp':['different compiler command']}):
                self.assertFalse(qualified.unchanged('psp',root,source))
            path.write_text('changed recipe');self.assertFalse(qualified.unchanged('psp',root,source))
            path.write_text('pinned compiler recipe')
            added=path.with_name('new.patch');added.write_text('new input');self.assertFalse(qualified.unchanged('psp',root,source))
            added.unlink();path.unlink();self.assertFalse(qualified.unchanged('psp',root,source))

    def test_latest_successful_publication_requires_ancestry_and_provenance(self):
        source='a'*40;head='b'*40;digest='sha256:'+'f'*64
        env={'GITHUB_REPOSITORY':'example/arcade','GITHUB_REF_NAME':'beta/test','GITHUB_SHA':head,'GH_TOKEN':'fixture-token'}
        runs={'workflow_runs':[{'event':'pull_request','head_sha':source},{'event':'push','head_sha':source}]}
        provenance={'SLSA':{'args':{'vcs:revision':source,'vcs:source':'https://github.com/example/arcade'}}}
        with patch.dict(os.environ,env,clear=True),patch.object(qualified,'read_json',side_effect=[runs,{'status':'ahead'},{'digest':digest},provenance]):
            self.assertEqual(qualified.qualified_release(),(source,'ghcr.io/example/arcade@'+digest))
        for args in [{'vcs:revision':head,'vcs:source':'https://github.com/example/arcade'},
                     {'vcs:revision':source,'vcs:source':'https://github.com/untrusted/arcade'}]:
            with patch.dict(os.environ,env,clear=True),patch.object(qualified,'read_json',side_effect=[runs,{'status':'ahead'},{'digest':digest},{'SLSA':{'args':args}}]):
                self.assertEqual(qualified.qualified_release(),(qualified.SOURCE,qualified.IMAGE))
        with patch.dict(os.environ,env,clear=True),patch.object(qualified,'read_json',side_effect=[runs,{'status':'diverged'}]):
            self.assertEqual(qualified.qualified_release(),(qualified.SOURCE,qualified.IMAGE))

    def test_force_bypasses_inspection_and_docker(self):
        with patch.dict(os.environ,{'FORCE_CORE_REBUILD':'true'}),patch.object(qualified,'git',side_effect=AssertionError('must not inspect')),patch.object(qualified.subprocess,'run',side_effect=AssertionError('must not restore')):
            qualified.restore()

    def test_main_promotion_reuses_only_ancestor_publications(self):
        source='a'*40;unrelated='c'*40;head='b'*40;digest='sha256:'+'f'*64
        env={'GITHUB_REPOSITORY':'example/arcade','GITHUB_REF_NAME':'main','GITHUB_SHA':head,'GH_TOKEN':'fixture-token'}
        runs={'workflow_runs':[{'event':'push','head_sha':unrelated},{'event':'push','head_sha':source}]}
        provenance={'SLSA':{'args':{'vcs:revision':source,'vcs:source':'https://github.com/example/arcade'}}}
        with patch.dict(os.environ,env,clear=True),patch.object(qualified,'read_json',side_effect=[runs,{'status':'diverged'},{'status':'ahead'},{'digest':digest},provenance]) as reader:
            self.assertEqual(qualified.qualified_release(),(source,'ghcr.io/example/arcade@'+digest))
            self.assertNotIn('branch=',reader.call_args_list[0].args[-1])


if __name__=='__main__':unittest.main()
