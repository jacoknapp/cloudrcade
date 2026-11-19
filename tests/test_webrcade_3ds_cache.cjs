// Run the native CPU regressions against a patched build.sh WORK tree.
const fs = require('fs'), os = require('os'), path = require('path');
const {execFileSync} = require('child_process');
const root = process.env.WEBRCADE_BUILD_ROOT || '/tmp/retro-azahar-build';
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'webrcade-cache-test-'));
function testVfp() {
  const src = path.join(root, 'azahar/src');
  const vfp = path.join(src, 'core/arm/skyeye_common/vfp');
  const args = ['-std=c++20', '-O2',
    '-I' + path.join(__dirname, 'fixtures/3ds-vfp'),
    '-I' + src, '-I' + path.join(root, 'azahar/externals/fmt/include')];
  const compile = extra => execFileSync(process.env.CXX || 'c++', [...args, ...extra], {stdio: 'inherit'});
  const reference = path.join(output, 'vfp-reference.o');
  const candidate = path.join(output, 'vfp-candidate.o');

  compile(['-Dvfp_single_cpdo=reference_single_cpdo',
    '-Dvfp_single_normaliseround=reference_single_normaliseround',
    '-Dvfp_estimate_sqrt_significand=reference_estimate_sqrt_significand',
    '-c', path.join(vfp, 'vfpsingle.cpp'), '-o', reference]);
  compile(['-D__EMSCRIPTEN__', '-c', path.join(vfp, 'vfpsingle.cpp'), '-o', candidate]);

  const binary = path.join(output, 'test_webrcade_3ds_vfp');
  compile([path.join(__dirname, 'test_webrcade_3ds_vfp.cpp'),
    path.join(vfp, 'vfp.cpp'), path.join(vfp, 'vfpdouble.cpp'), reference, candidate, '-o', binary]);
  execFileSync(binary, [], {stdio: 'inherit'});
}

function testVertexDraws() {
  const azahar = path.join(root, 'azahar');
  const binary = path.join(output, 'test_webrcade_3ds_vertex_draws');
  execFileSync(process.env.CXX || 'c++', [
    '-std=c++20', '-Wall', '-Wextra', '-Werror',
    '-I' + path.join(azahar, 'src'), '-I' + path.join(azahar, 'externals/boost'),
    '-I' + path.join(azahar, 'externals/fmt/include'),
    path.join(__dirname, 'test_webrcade_3ds_vertex_draws.cpp'),
    path.join(azahar, 'src/video_core/pica/primitive_assembly.cpp'), '-o', binary,
  ], {stdio: 'inherit'});
  execFileSync(binary, [], {stdio: 'inherit'});
}

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
  testVfp();
  testVertexDraws();
} finally { fs.rmSync(output, {recursive:true, force:true}); }
