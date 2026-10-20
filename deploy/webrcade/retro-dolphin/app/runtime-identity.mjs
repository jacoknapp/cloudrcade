// Include native glue and every prepared host module, even when WASM is unchanged.
export async function runtimeFingerprint(info, subtle = globalThis.crypto?.subtle) {
  const fallback = /^[a-f0-9]{64}$/.test(info?.hostPatchSha256) ? info.hostPatchSha256 : null;
  try {
    const manifests = ['artifacts', 'adapterFilesSha256', 'hostPatchFilesSha256'].map(name =>
      [name, Object.entries(info?.[name] || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]);
    const bytes = new TextEncoder().encode(JSON.stringify([
      'cloudrcade.runtime.v1', info?.commit || '', fallback, ...manifests
    ]));
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return fallback; } // Diagnostic identity must never prevent a game boot.
}
