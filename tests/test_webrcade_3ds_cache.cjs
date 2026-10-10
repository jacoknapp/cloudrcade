// Compile the actual core cache header and exercise process identity, code invalidation,
// cross-CPU aliases and bounded arena reuse. Requires c++ and a patched build.sh WORK tree.
const fs = require('fs'), os = require('os'), path = require('path');
const {execFileSync} = require('child_process');
const root = process.env.WEBRCADE_BUILD_ROOT || '/tmp/retro-azahar-build';
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'webrcade-cache-test-'));
try {
  const binary = path.join(output, 'cache-test');
  execFileSync(process.env.CXX || 'c++', ['-std=c++20', '-Wall', '-Wextra', '-Werror',
    '-I' + path.join(root, 'azahar/src'), path.join(__dirname, 'test_webrcade_3ds_cache.cpp'), '-o', binary], {stdio:'inherit'});
  execFileSync(binary, [], {stdio:'inherit'});
} finally { fs.rmSync(output, {recursive:true, force:true}); }
