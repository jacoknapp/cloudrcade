// Compile the native cache and ARM instruction regressions against the patched headers. Requires c++ and a patched build.sh WORK tree.
const fs = require('fs'), os = require('os'), path = require('path');
const {execFileSync} = require('child_process');
const root = process.env.WEBRCADE_BUILD_ROOT || '/tmp/retro-azahar-build';
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'webrcade-cache-test-'));
try {
  for (const test of ['test_webrcade_3ds_cache', 'test_webrcade_3ds_arm_ops', 'test_webrcade_3ds_arm_loop']) {
    const binary = path.join(output, test);
    const armSources = test === 'test_webrcade_3ds_arm_ops'
      ? ['-D__EMSCRIPTEN__', path.join(root, 'azahar/src/core/arm/dyncom/arm_dyncom_dec.cpp')]
      : [];
    execFileSync(process.env.CXX || 'c++', [
      '-std=c++20', '-Wall', '-Wextra', '-Werror',
      '-I' + path.join(root, 'azahar/src'),
      '-I' + path.join(root, 'azahar/externals/dynarmic/externals/robin-map/include'),
      ...armSources, path.join(__dirname, test + '.cpp'), '-o', binary,
    ], {stdio: 'inherit'});
    execFileSync(binary, [], {stdio: 'inherit'});
  }
} finally { fs.rmSync(output, {recursive:true, force:true}); }
