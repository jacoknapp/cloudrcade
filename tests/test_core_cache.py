"""Exercise input isolation, corruption recovery and forced source rebuilds."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('core_cache', ROOT / 'scripts/core-cache.py')
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


class CoreCacheTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        # Use the real dependency graph, including tracked and added input files.
        names = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others',
                                         '--exclude-standard'], cwd=ROOT).split(b'\0')
        scopes = cache.SHARED + sum(cache.INPUTS.values(), [])
        for encoded in names:
            if not encoded:
                continue
            name = encoded.decode()
            if any(name == scope or name.startswith(scope + '/') for scope in scopes):
                path = self.root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / name, path)

    def keys(self):
        return {name: cache.identity(name, self.root) for name in cache.INPUTS}

    def changed(self, name):
        before = self.keys()
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(path.read_bytes() + b'\n# test change' if path.exists() else b'new input')
        return {key for key, value in self.keys().items() if value != before[key]}

    def test_input_isolation_and_shared_dependencies(self):
        self.assertEqual(self.changed('deploy/webrcade/retro-dolphin/app/host.mjs'), {'gamecube'})
        self.assertEqual(self.changed('deploy/webrcade/retro-dolphin/native-patches/new.patch'),
                         {'gamecube', 'gamecube-native'})
        self.assertEqual(self.changed(cache.READER), {'3ds', 'psp', 'gamecube'})
        self.assertEqual(self.changed('deploy/webrcade/retro-ppsspp/build.sh'), {'psp'})
        self.assertEqual(self.changed('deploy/webrcade/retro-azahar/patches/new.patch'), {'3ds'})
        self.assertEqual(self.changed('deploy/webrcade/touch/assets/controller.css'), {'gamecube'})
        self.assertEqual(self.changed('deploy/webrcade/touch/cloud/bridge.js'), set())
        self.assertEqual(self.changed('README.md'), set())
        self.assertEqual(self.changed('.github/workflows/docker.yml'), set(cache.INPUTS))

    def package(self):
        out = self.root / 'release/psp'
        (out / 'app').mkdir(parents=True, exist_ok=True)
        (out / 'sources').mkdir(exist_ok=True)
        (out / 'app/index.html').write_text('<html>fixture</html>')
        (out / 'app/core.wasm').write_bytes(b'\0asm\x01\0\0\0')
        (out / 'sources/psp-source.tar.gz').write_bytes(b'source fixture')
        return out

    def test_inventory_rejects_corruption_missing_added_and_stale_files(self):
        out = self.package()
        key = cache.identity('psp', self.root)
        cache.seal('psp', out, key, self.root)
        self.assertTrue(cache.reusable('psp', out, key, self.root))
        self.assertFalse(cache.reusable('psp', out, 'different input', self.root))
        source = out / 'sources/psp-source.tar.gz'
        source.write_bytes(b'corrupt')
        self.assertFalse(cache.reusable('psp', out, key, self.root))
        cache.seal('psp', out, key, self.root)
        source.unlink()
        self.assertFalse(cache.reusable('psp', out, key, self.root))
        self.package()
        cache.seal('psp', out, key, self.root)
        (out / 'app/stale.js').write_text('extra')
        self.assertFalse(cache.reusable('psp', out, key, self.root))
        (out / 'app/stale.js').unlink()
        (out / 'app/link').symlink_to('/etc/passwd')
        self.assertFalse(cache.reusable('psp', out, key, self.root))

    def test_cold_warm_corrupt_and_forced_execution(self):
        # Keep real git hashing; intercept only the expensive compiler command.
        run = subprocess.run
        builds = []
        def fake_build(command, **kwargs):
            if command == cache.COMMANDS['psp']:
                builds.append(command)
                self.assertNotIn('GAMECUBE_NATIVE_CACHE', kwargs['env'])
                self.package()
                return subprocess.CompletedProcess(command, 0)
            return run(command, **kwargs)
        with patch.dict(os.environ, {'FORCE_CORE_REBUILD': 'false', 'GAMECUBE_NATIVE_CACHE': '/invalid'}), \
                patch.object(cache.subprocess, 'run', side_effect=fake_build):
            cache.prepare('psp', self.root)
            cache.prepare('psp', self.root)
            self.assertEqual(len(builds), 1)
            (self.root / 'release/psp/app/core.wasm').write_bytes(b'broken')
            cache.prepare('psp', self.root)
            self.assertEqual(len(builds), 2)
            with patch.dict(os.environ, {'FORCE_CORE_REBUILD': 'true'}):
                cache.prepare('psp', self.root)
            self.assertEqual(len(builds), 3)

    def test_gamecube_adapter_reuses_native_but_corruption_and_force_compile(self):
        native = self.root / 'release/gamecube-native'
        native.mkdir(parents=True)
        lockpath = self.root / cache.BASE / 'retro-dolphin/native-build.json'
        lock = json.loads(lockpath.read_text())
        for name in lock['artifacts']:
            (native / name).write_bytes(b'test native')
            lock['artifacts'][name] = cache.sha(native / name)
        lockpath.write_text(json.dumps(lock))
        builds = []
        run = subprocess.run
        def fake_build(command, **kwargs):
            if command != cache.COMMANDS['gamecube']:
                return run(command, **kwargs)
            builds.append(kwargs['env'].get('GAMECUBE_NATIVE_CACHE'))
            app = self.root / 'release/gamecube/app'
            (app / 'cores/dolphin').mkdir(parents=True)
            (app / 'adapter-source').mkdir()
            (app / 'index.html').write_text('fixture')
            (app / 'gamecube-source.tar.gz').write_bytes(b'source fixture')
            (app / 'adapter-source/native-build.json').write_text(json.dumps(lock))
            for name in lock['artifacts']:
                (app / 'cores/dolphin' / name).write_bytes(b'test native')
            (app / 'core-info.json').write_text(json.dumps({
                'nativeBuild': lock, 'sourceSha256': cache.sha(app / 'gamecube-source.tar.gz')}))
            return subprocess.CompletedProcess(command, 0)
        with patch.dict(os.environ, {'FORCE_CORE_REBUILD': 'false'}), \
                patch.object(cache.subprocess, 'run', side_effect=fake_build):
            cache.prepare('gamecube', self.root)
            cache.prepare('gamecube', self.root)
            self.assertEqual(builds, [str(native)])
            self.changed('deploy/webrcade/retro-dolphin/app/index.html')
            cache.prepare('gamecube', self.root)
            self.assertEqual(builds, [str(native), str(native)])
            self.changed('deploy/webrcade/retro-dolphin/app/index.html')
            (native / next(iter(lock['artifacts']))).write_bytes(b'corrupt')
            cache.prepare('gamecube', self.root)
            self.assertIsNone(builds[-1])
            with patch.dict(os.environ, {'FORCE_CORE_REBUILD': 'true'}):
                cache.prepare('gamecube', self.root)
            self.assertIsNone(builds[-1])
            self.assertEqual(len(builds), 4)


    def test_force_3ds_also_bypasses_legacy_pinned_release_download(self):
        deploy = runpy.run_path(str(self.root / cache.BASE / 'retro-azahar/deploy.py'))
        stamp, _ = deploy['inputs'](self.root / cache.BASE / 'retro-azahar')
        lockpath = self.root / 'core-release.json'
        lock = json.loads(lockpath.read_text())
        lock['sourceHash'] = stamp
        lockpath.write_text(json.dumps(lock))
        commands = []
        def fake_build(command, **kwargs):
            commands.append(command)
            out = self.root / 'release/3ds'
            (out / 'app').mkdir(exist_ok=True)
            (out / 'app/index.html').write_text('fixture')
            (out / 'sources').mkdir(exist_ok=True)
            (out / 'sources/3ds-source.tar.gz').write_bytes(b'source fixture')
            return subprocess.CompletedProcess(command, 0)
        with patch.dict(os.environ, {'FORCE_CORE_REBUILD': 'true'}), \
                patch('urllib.request.urlopen', side_effect=AssertionError('Must compile, not download')), \
                patch('subprocess.run', side_effect=fake_build):
            runpy.run_path(str(self.root / 'scripts/prepare-core.py'))
        self.assertEqual(len(commands), 2)
        self.assertEqual(commands[0][:2], ['bash', str(self.root / cache.BASE / 'retro-azahar/build.sh')])


    def test_native_artifact_lock_rejects_wrong_bytes(self):
        native = self.root / 'release/gamecube-native'
        native.mkdir(parents=True)
        lockpath = self.root / cache.BASE / 'retro-dolphin/native-build.json'
        lock = json.loads(lockpath.read_text())
        for name in lock['artifacts']:
            (native / name).write_bytes(b'test native')
            lock['artifacts'][name] = cache.sha(native / name)
        lockpath.write_text(json.dumps(lock))
        self.assertTrue(cache.native_valid(native, self.root))
        (native / next(iter(lock['artifacts']))).write_bytes(b'corrupt')
        self.assertFalse(cache.native_valid(native, self.root))


if __name__ == '__main__':
    unittest.main()
