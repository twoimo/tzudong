const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

function resolveSafeExternalUrl(rawUrl: string | null | undefined): string | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return null;

  try {
    const resolved = new URL(trimmed, typeof window !== 'undefined' ? window.location.origin : undefined);
    if (!SAFE_EXTERNAL_PROTOCOLS.has(resolved.protocol)) {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

export function openExternalUrl(rawUrl: string | null | undefined): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const safeUrl = resolveSafeExternalUrl(rawUrl);
  if (!safeUrl) {
    return false;
  }

  const popup = window.open(safeUrl, '_blank', 'noopener,noreferrer');
  if (popup) {
    popup.opener = null;
  }

  return Boolean(popup);
}
