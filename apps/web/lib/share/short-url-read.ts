export type ShortUrlReadResult =
  | { kind: 'redirect'; target: string }
  | { kind: 'not-found' }
  | { kind: 'unavailable' };

export function isValidShortUrlCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9]{6}$/.test(value);
}

/** Expected lookup failures are values; provider diagnostics never leave this boundary. */
export function resolveShortUrlRead(
  data: unknown,
  error: unknown,
  isSafeTarget: (target: string) => boolean,
): ShortUrlReadResult {
  if (error) return { kind: 'unavailable' };
  if (data === null) return { kind: 'not-found' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { kind: 'unavailable' };
  const target = (data as { target_url?: unknown }).target_url;
  if (typeof target !== 'string' || target.length > 2048) return { kind: 'unavailable' };
  const trimmed = target.trim();
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return { kind: 'unavailable' };
  return { kind: 'redirect', target: isSafeTarget(trimmed) ? trimmed : '/' };
}
