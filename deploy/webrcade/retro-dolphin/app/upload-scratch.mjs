// Borrow only for an immediate GPUQueue.writeTexture call. WebGPU snapshots
// its input on the content timeline before returning; retained uploads must
// continue to own their bytes. Share the existing 4 MiB buffer-upload scratch.
const MAX_BYTES = 4 * 1024 * 1024;

export function borrowTextureUpload(heap, pointer, bytes, copyImmediate) {
  if (!Number.isSafeInteger(pointer) || !Number.isSafeInteger(bytes) ||
      pointer < 0 || bytes < 0 || bytes > MAX_BYTES || pointer + bytes > heap.length) {
    return heap.slice(pointer, pointer + bytes);
  }
  // Buffer uploads pad to four bytes. Texture uploads retain their exact span.
  return copyImmediate(heap, pointer, bytes).subarray(0, bytes);
}
