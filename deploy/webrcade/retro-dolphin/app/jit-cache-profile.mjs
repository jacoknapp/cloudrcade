// Select once before boot. Tablet desktop UAs must retain the mobile budget.
// An absent memory hint is not a measurement of available RAM.
export function jitCacheProfile(navigator = {}) {
  const ua = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
      navigator.userAgentData?.mobile === true ||
      (/Mac|Linux/i.test(platform) && navigator.maxTouchPoints > 1)) return 'standard';
  if (!/^(Win32|Win64|Windows|MacIntel|macOS|Linux x86_64|Linux)$/i.test(platform))
    return 'standard';
  // The generic Linux UA-CH value also occurs on Android. Require its desktop
  // architecture when no platform string identifies x86_64 explicitly.
  if (platform === 'Linux' && !/X11; Linux x86_64|X11;.*Linux x86_64/i.test(ua))
    return 'standard';
  const memory = navigator.deviceMemory;
  if (typeof memory === 'number' && (!Number.isFinite(memory) || memory < 8))
    return 'standard';
  return 'desktop';
}
