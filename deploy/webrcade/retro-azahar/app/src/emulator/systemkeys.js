/* Operator key material is fetched from the mounted BIOS at runtime only. */
export async function installSystemKeys(FS, directory, config, transport = fetch) {
  if (!config?.n3dsKeysUrl) return false;
  const response = await transport(config.n3dsKeysUrl, {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error',
  });
  if (!response.ok) throw new Error('The configured 3DS key file is unavailable. Check the BIOS mount.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 262144) throw new Error('Invalid 3DS key file size.');
  let text;
  try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
  catch (_) { throw new Error('3DS keys must be a keys.txt or aes_keys.txt text file.'); }
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  let entries = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^:(AES|RSA|ECC)$/.test(lines[i])) continue;
    const parts = lines[i].split('=').map(part => part.trim());
    if (parts.length !== 2 || !/^[A-Za-z0-9_]{1,64}$/.test(parts[0]) ||
        !/^(?:[a-fA-F0-9]{2})+$/.test(parts[1])) throw new Error('Invalid 3DS key file format.');
    lines[i] = parts.join('=');
    entries++;
  }
  if (!entries) throw new Error('Invalid 3DS key file format.');
  text = lines.join('\n');
  // Citra AES files have no section header; Azahar keys.txt uses :AES/:RSA sections.
  if (!text.startsWith(':')) text = ':AES\n' + text;
  let current = '';
  for (const part of directory.split('/').filter(Boolean)) {
    current += '/' + part;
    try { FS.mkdir(current); } catch (_) {}
  }
  FS.writeFile(directory + '/keys.txt', new TextEncoder().encode(text + '\n'));
  return true;
}
