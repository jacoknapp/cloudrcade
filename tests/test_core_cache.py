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
        self.assertEqual(self.changed('deploy/webrcade/touch/assets/controller.css'), {'gamecube', 'ps2'})
        self.assertEqual(self.changed('deploy/webrcade/retro-play/native/CloudRcade.cpp'), {'ps2', 'ps2-native'})
        # Newly added native patch helpers must invalidate both the compiler
        # receipt and the adapter package; otherwise old binaries can be reused.
        before = cache.ps2_native_key(self.root)
        self.assertEqual(self.changed('deploy/webrcade/retro-play/patch-extra-native.py'), {'ps2', 'ps2-native'})
        self.assertNotEqual(before, cache.ps2_native_key(self.root))
        prepare = runpy.run_path(str(self.root / cache.BASE / 'retro-play/prepare.py'))
        self.assertEqual(prepare['native_key'](), cache.ps2_native_key(self.root))
        self.assertEqual(self.changed('deploy/webrcade/retro-dolphin/sdk/pause.jsx'), {'gamecube', 'ps2'})
        self.assertEqual(self.changed('deploy/webrcade/touch/cloud/bridge.js'), set())
        self.assertEqual(self.changed('README.md'), set())
        self.assertEqual(self.changed('.github/workflows/docker.yml'), set())
        self.assertEqual(self.changed('scripts/core-cache.py'), set())
        self.assertEqual(self.changed('scripts/restore-qualified-cores.py'), set())
        self.assertEqual(self.changed('deploy/webrcade/retro-azahar/README.md'), set())
        self.assertEqual(self.changed('deploy/webrcade/retro-ppsspp/README.md'), set())
        self.assertEqual(self.changed('deploy/webrcade/retro-dolphin/README.md'), {'gamecube'})

    def test_effective_toolchain_and_per_core_command_changes(self):
        workflow = self.root / '.github/workflows/docker.yml'
        original = workflow.read_text()
        before = self.keys()
        def changed(text):
            workflow.write_text(text)
            return {core for core, key in self.keys().items() if key != before[core]}
        self.assertEqual(changed(original.replace("node-version: '22'", "node-version: '24'")), {'gamecube', 'ps2'})
        self.assertEqual(changed(original.replace('runs-on: ubuntu-24.04', 'runs-on: ubuntu-26.04')), set(cache.COMMANDS))
        self.assertEqual(changed(original.replace('permissions:', '# release scheduling\npermissions:', 1)), set())
        self.assertEqual(changed(original.replace('actions/cache/restore@v4', 'actions/cache/restore@v5')), set())
        self.assertEqual(changed(original.replace('Prepare PSP (reuse unchanged builds)', 'PSP label only')), set())
        self.assertEqual(changed(original.replace('run: python3 scripts/core-cache.py prepare psp', 'env:\n          CXXFLAGS: changed\n        run: python3 scripts/core-cache.py prepare psp')), {'psp'})
        self.assertEqual(changed(original.replace('    env:\n', '    env:\n      CXXFLAGS: changed\n', 1)), set(cache.INPUTS))
        workflow.write_text(original)
        with patch.dict(cache.COMMANDS, {'psp': ['bash', 'different-recipe.sh']}):
            self.assertEqual({core for core, key in self.keys().items() if key != before[core]}, {'psp'})

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


    def test_ps2_adapter_reuses_locked_native_and_force_or_corruption_builds(self):
        native = self.root / 'release/ps2-native'
        native.mkdir(parents=True)
        lockpath = self.root / cache.BASE / 'retro-play/native-build.json'
        lock = json.loads(lockpath.read_text())
        for name in lock['artifacts']:
            (native / name).write_bytes(b'fixture native ' + name.encode())
            lock['artifacts'][name] = cache.sha(native / name)
        lock['nativeInputSha256'] = cache.ps2_native_key(self.root)
        lockpath.write_text(json.dumps(lock))
        prepare = runpy.run_path(str(self.root / cache.BASE / 'retro-play/prepare.py'))
        self.assertEqual(prepare['native_key'](), cache.ps2_native_key(self.root))
        builds = []
        run = subprocess.run
        def fake_build(command, **kwargs):
            if command != cache.COMMANDS['ps2']: return run(command, **kwargs)
            builds.append(kwargs['env'].get('PS2_NATIVE_CACHE'))
            app = self.root / 'release/ps2/app'
            (app / 'core').mkdir(parents=True)
            source = app.parent / 'sources/ps2-source.tar.gz'
            source.parent.mkdir()
            source.write_bytes(b'source fixture')
            (app / 'index.html').write_text('fixture')
            for name in lock['artifacts']:
                (app / 'core' / name).write_bytes(b'fixture native ' + name.encode())
            (app / 'core-info.json').write_text(json.dumps({'nativeBuild':lock,'sourceSha256':cache.sha(source)}))
            return subprocess.CompletedProcess(command, 0)
        with patch.dict(os.environ, {'FORCE_CORE_REBUILD':'false','PS2_NATIVE_CACHE':'/invalid'}), patch.object(cache.subprocess,'run',side_effect=fake_build):
            cache.prepare('ps2', self.root)
            cache.prepare('ps2', self.root)
            self.assertEqual(builds, [str(native)])
            self.changed('deploy/webrcade/retro-play/app/index.html')
            cache.prepare('ps2', self.root)
            self.assertEqual(builds, [str(native),str(native)])
            (native / 'Play.wasm').write_bytes(b'corrupt')
            self.changed('deploy/webrcade/retro-play/app/index.html')
            cache.prepare('ps2', self.root)
            self.assertIsNone(builds[-1])
            with patch.dict(os.environ, {'FORCE_CORE_REBUILD':'true'}): cache.prepare('ps2', self.root)
            self.assertIsNone(builds[-1])
            self.assertEqual(len(builds), 4)
        # Matching artifact bytes alone cannot authorize reuse after source edits.
        self.changed('deploy/webrcade/retro-play/native/CloudRcade.cpp')
        self.assertFalse(cache.native_valid(native, self.root, 'ps2'))

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
