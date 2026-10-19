// Validate Wii containers with bounded metadata reads. Dolphin reads the original
// container through WORKERFS/HTTP ranges; no conversion or whole-disc buffering.
const WII_BYTES = 143432 * 2 * 0x8000;
function invalid(message) { throw new Error(message); }
async function read(file, first, length) {
  if (!Number.isSafeInteger(file.size) || first < 0 || first + length > file.size)
    invalid('Truncated Wii disc image.');
  const bytes = new Uint8Array(await file.slice(first, first + length).arrayBuffer());
  if (bytes.length !== length) invalid('Short read of Wii disc metadata.');
  return bytes;
}
export async function inspectDisc(file) {
  const format = /\.(iso|wbfs|ciso)$/i.exec(file?.name || '')?.[1].toLowerCase();
  if (!format) invalid('Choose a Wii ISO, WBFS or CISO disc image.');
  let bytes = await read(file, 0, 32);
  if (format === 'wbfs') {
    if (new DataView(bytes.buffer).getUint32(0) !== 0x57424653 ||
        bytes[8] < 9 || bytes[8] > 16 || bytes[9] < 15 || bytes[9] > 26 || bytes[9] < bytes[8])
      invalid('Invalid WBFS container header.');
    const sector = 2 ** bytes[8], block = 2 ** bytes[9];
    if (new DataView(bytes.buffer).getUint32(4) * sector !== file.size)
      invalid('Incomplete or split WBFS image. Choose a complete single-file WBFS image.');
    const slots = (await read(file, 0, 512)).subarray(12);
    if (!slots[0] || slots.subarray(1).some(value => value !== 0))
      invalid('Choose a WBFS container containing one game in its first slot.');
    const table = await read(file, sector + 256, Math.ceil(WII_BYTES / block) * 2);
    const map = new DataView(table.buffer);
    for (let at = 0; at < table.length; at += 2)
      if ((map.getUint16(at) + 1) * block > file.size)
        invalid('WBFS block map points outside the image.');
    if (!map.getUint16(0)) invalid('WBFS image has no Wii disc header block.');
    bytes = await read(file, map.getUint16(0) * block, 32);
  } else if (format === 'ciso') {
    const header = await read(file, 0, 0x8000), view = new DataView(header.buffer);
    const block = view.getUint32(4, true), map = header.subarray(8);
    if (view.getUint32(0) !== 0x4349534f || block < 0x8000 || block > 2 ** 26 ||
        !Number.isInteger(Math.log2(block)) || map[0] !== 1 || map.some(value => value > 1))
      invalid('Invalid Wii CISO container header.');
    if (0x8000 + map.reduce((sum, value) => sum + value, 0) * block !== file.size)
      invalid('Truncated Wii CISO image.');
    bytes = await read(file, 0x8000, 32);
  }
  if (new DataView(bytes.buffer).getUint32(0x18) !== 0x5d1c9ea3)
    invalid('This image has no Wii disc header.');
  const gameId = String.fromCharCode(...bytes.subarray(0, 6));
  if (!/^[A-Z0-9]{6}$/.test(gameId)) invalid('Invalid Wii disc identity.');
  return {gameId, size:file.size, format};
}
