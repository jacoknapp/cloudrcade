const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
(async () => {
  const {borrowTextureUpload} = await import(pathToFileURL(path.resolve(__dirname,
    '../deploy/webrcade/retro-dolphin/app/upload-scratch.mjs')));
  for (const BufferType of [ArrayBuffer, SharedArrayBuffer]) {
    const heap = new Uint8Array(new BufferType(128));
    heap.set([11,22,33,44,55,66,77], 17);
    const scratch = new Uint8Array(256);
    const borrow = (source, pointer, bytes) => {
      scratch.set(source.subarray(pointer, pointer + bytes));
      return scratch.subarray(0, Math.ceil(bytes / 4) * 4);
    };
    const first = borrowTextureUpload(heap, 17, 7, borrow);
    assert.equal(first.buffer, scratch.buffer);
    assert.equal(first.byteLength, 7, 'texture payload excludes buffer padding');
    assert.deepEqual([...first], [11,22,33,44,55,66,77]);
    const submitted = first.slice(); // GPUQueue snapshots on each immediate call.
    heap.fill(99);
    const second = borrowTextureUpload(heap, 17, 4, borrow);
    assert.equal(second.buffer, first.buffer, 'repeated uploads reuse backing storage');
    assert.deepEqual([...second], [99,99,99,99]);
    assert.deepEqual([...submitted], [11,22,33,44,55,66,77]);
    const neverBorrow = () => assert.fail('invalid/oversize spans must use the original copy');
    for (const [pointer,bytes] of [[127,8],[-3,2],[0,-1]]) {
      assert.deepEqual(borrowTextureUpload(heap,pointer,bytes,neverBorrow),heap.slice(pointer,pointer+bytes));
    }
    const large = new Uint8Array(new BufferType(4*1024*1024+8));
    const owned = borrowTextureUpload(large,0,large.length,neverBorrow);
    assert.equal(owned.byteLength,large.length);assert.notEqual(owned.buffer,large.buffer);
    large.fill(8);assert.equal(owned[0],0);
  }
  console.log('PASS exact texture spans, shared-heap copies, bounded scratch reuse, independent submissions and oversize fallback');
})().catch(error => {console.error(error);process.exitCode=1;});
