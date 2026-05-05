const SUPABASE_AUTH_STORAGE_KEY_PATTERN = /^sb-.+-auth-token(?:\.\d+)?$/;

type StorageLike = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
};

function isUsableSessionHintValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return Boolean(normalized && normalized !== 'null' && normalized !== 'undefined');
}

export function isSupabaseAuthSessionStorageKey(key: string) {
  return SUPABASE_AUTH_STORAGE_KEY_PATTERN.test(key);
}

export function hasSupabaseAuthLocalStorageSessionHint(storage?: StorageLike) {
  const resolvedStorage =
    storage ??
    (typeof window !== 'undefined' ? window.localStorage : undefined);

  if (!resolvedStorage) return false;

  try {
    for (let index = 0; index < resolvedStorage.length; index += 1) {
      const key = resolvedStorage.key(index) ?? '';
      if (!isSupabaseAuthSessionStorageKey(key)) continue;

      if (isUsableSessionHintValue(resolvedStorage.getItem(key))) {
        return true;
      }
    }
  } catch {
    // Storage may be unavailable in strict/private browser contexts.
  }

  return false;
}

export function hasSupabaseAuthCookieSessionHint(cookieHeader?: string) {
  const resolvedCookieHeader =
    cookieHeader ??
    (typeof document !== 'undefined' ? document.cookie : '');

  if (!resolvedCookieHeader) return false;

  try {
    return resolvedCookieHeader.split(';').some((cookiePart) => {
      const [rawName, ...rawValueParts] = cookiePart.trim().split('=');
      const name = decodeURIComponent(rawName ?? '').trim();
      const value = rawValueParts.join('=');

      return isSupabaseAuthSessionStorageKey(name) && isUsableSessionHintValue(value);
    });
  } catch {
    return false;
  }
}

export function hasSupabaseAuthSessionHint() {
  return hasSupabaseAuthLocalStorageSessionHint() || hasSupabaseAuthCookieSessionHint();
}
