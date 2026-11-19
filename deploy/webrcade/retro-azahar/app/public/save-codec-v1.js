// A worker handles one bounded save entry, then its caller terminates it.
async function inflate(stream, expectedSize) {
  const bytes = new Uint8Array(expectedSize);
  const reader = stream.getReader();
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > bytes.length) throw new Error('Invalid ZIP entry size');
    bytes.set(value, offset);
    offset += value.length;
  }
  if (offset !== bytes.length) throw new Error('Incomplete ZIP entry');
  return bytes;
}

self.onmessage = async ({ data: { bytes, compress, size } }) => {
  let codec;
  try {
    codec = compress ? new CompressionStream('gzip') : new DecompressionStream('deflate-raw');
  } catch (_) {
    self.postMessage({ unsupported: true });
    return;
  }

  try {
    const stream = new Response(bytes).body.pipeThrough(codec);
    if (!compress) {
      const payload = await inflate(stream, size);
      self.postMessage({ payload }, [payload.buffer]);
      return;
    }

    // Gzip supplies both the raw deflate payload and the CRC-32 required
    // by ZIP. Let the original codec handle a browser using optional headers.
    const output = await new Response(stream).arrayBuffer();
    const header = new Uint8Array(output, 0, 10);
    const trailer = new DataView(output, output.byteLength - 8);
    if (header[0] !== 31 || header[1] !== 139 || header[2] !== 8 || header[3] !== 0 ||
        trailer.getUint32(4, true) !== bytes.byteLength) {
      self.postMessage({ unsupported: true });
      return;
    }
    const payload = new Uint8Array(output, 10, output.byteLength - 18);
    self.postMessage({ payload, crc: trailer.getUint32(0, true) }, [output]);
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  }
};
