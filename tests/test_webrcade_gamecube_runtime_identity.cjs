const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
(async()=>{
  const {runtimeFingerprint}=await import('../deploy/webrcade/retro-dolphin/app/runtime-identity.mjs');
  const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
  const info={commit:'upstream',hostPatchSha256:a,artifacts:{'core.js':a,'core.wasm':b},adapterFilesSha256:{'lab.mjs':a,'session.mjs':b},hostPatchFilesSha256:{'patch-runtime.py':a}};
  const original=await runtimeFingerprint(info,webcrypto.subtle);
  assert.match(original,/^[a-f0-9]{64}$/);
  const reordered={...info,artifacts:{'core.wasm':b,'core.js':a},adapterFilesSha256:{'session.mjs':b,'lab.mjs':a}};
  assert.equal(await runtimeFingerprint(reordered,webcrypto.subtle),original,'manifest insertion order is not a runtime change');
  assert.notEqual(await runtimeFingerprint({...info,artifacts:{...info.artifacts,'core.js':c}},webcrypto.subtle),original,'native JS-only changes must be distinguishable with the same WASM and host patch');
  assert.notEqual(await runtimeFingerprint({...info,adapterFilesSha256:{...info.adapterFilesSha256,'lab.mjs':c}},webcrypto.subtle),original,'host module changes must be distinguishable with the same native core');
  assert.notEqual(await runtimeFingerprint({...info,commit:'another-upstream'},webcrypto.subtle),original);
  assert.equal(await runtimeFingerprint(info,{digest:async()=>{throw Error('Unavailable');}}),a,'diagnostic hashing failures preserve the previous identity without failing boot');
  console.log('PASS complete runtime identity, stable manifest ordering and diagnostic fallback');
})().catch(error=>{console.error(error);process.exitCode=1;});
