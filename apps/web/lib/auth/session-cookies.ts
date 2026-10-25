import { DEFAULT_COOKIE_OPTIONS, isChunkLike, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';

type Cookie = { name: string; value: string };

export function getAuthCookieContract(url: string) {
  const project = new URL(url).hostname.split('.')[0];
  return {
    legacyKey: `sb-${project}-auth-token`,
    previousKey: `sb-${project}-v2-auth-token`,
    previousMarker: `tz-auth-v2-${project}`,
    key: `sb-${project}-v3-auth-token`,
    marker: `tz-auth-v3-${project}`,
  };
}

function belongsToKey(name: string, key: string) {
  return isChunkLike(name, key) || isChunkLike(name, `${key}-user`)
    || name === `${key}-code-verifier` || name.startsWith(`${key}-code-verifier-`)
    || name.startsWith(`${key}-code-verifier.`);
}

function isSessionCredential(name: string, key: string) {
  return isChunkLike(name, key) || isChunkLike(name, `${key}-user`);
}

function isPreviousCredential(name: string, contract: ReturnType<typeof getAuthCookieContract>) {
  return isSessionCredential(name, contract.legacyKey) || isSessionCredential(name, contract.previousKey);
}

// Serializes cooperating browser cookie batches, including the migration that
// reads can trigger. The SDK's default coordination does not acquire Web Locks.
// Native legacy Set-Cookie responses and older clients do not participate. The
// v3 namespace is browser-published only, so those writers cannot overwrite it.
export async function withBrowserAuthCookieLock<T>(url: string, batch: () => T): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    throw new Error('AUTH_COOKIE_LOCK_UNAVAILABLE');
  }
  const signal = AbortSignal.timeout(10_000);
  try {
    return await navigator.locks.request(
      `tz-auth-cookies:${getAuthCookieContract(url).key}`,
      { mode: 'exclusive', signal },
      batch,
    );
  } catch (error) {
    if (signal.aborted) throw new Error('AUTH_COOKIE_LOCK_TIMEOUT');
    if (error instanceof DOMException && error.name === 'SecurityError') {
      throw new Error('AUTH_COOKIE_LOCK_UNAVAILABLE');
    }
    throw error;
  }
}

function writeAuthMarker(url: string, value: 'pending' | '1') {
  const { marker } = getAuthCookieContract(url);
  document.cookie = serializeCookieHeader(marker, value, DEFAULT_COOKIE_OPTIONS);
  if (!parseCookieHeader(document.cookie).some(cookie => cookie.name === marker && cookie.value === value)) {
    throw new Error('AUTH_COOKIE_WRITE_FAILED');
  }
}

export function beginBrowserAuthCookieBatch(url: string) { writeAuthMarker(url, 'pending'); }
export function finishBrowserAuthCookieBatch(url: string) { writeAuthMarker(url, '1'); }

// The v3 cutover requires one fresh login. Native HTTP writers from older
// releases cannot join this browser lock, so credentials are never imported.
export function migrateBrowserAuthCookies(url: string) {
  const contract = getAuthCookieContract(url);
  const { key, marker } = contract;
  const all = parseCookieHeader(document.cookie);
  const complete = all.some(cookie => cookie.name === marker && cookie.value === '1');
  if (!complete) beginBrowserAuthCookieBatch(url);
  // An interrupted v3 batch is discarded, never interpreted as a saved login.
  // Cleanup is within the shared cookie lock; older HTTP writers use other keys.
  for (const cookie of all.filter(cookie => (!complete && belongsToKey(cookie.name, key))
      || belongsToKey(cookie.name, contract.legacyKey) || belongsToKey(cookie.name, contract.previousKey))) {
    document.cookie = serializeCookieHeader(cookie.name, '', { ...DEFAULT_COOKIE_OPTIONS, maxAge: 0 });
  }
  const stored = parseCookieHeader(document.cookie);
  if (stored.some(cookie => isPreviousCredential(cookie.name, contract))
    || (!complete && stored.some(cookie => belongsToKey(cookie.name, key)))) {
    throw new Error('AUTH_COOKIE_MIGRATION_FAILED');
  }
  if (!complete) finishBrowserAuthCookieBatch(url);
}

export function readServerAuthCookies(all: Cookie[], url: string): Cookie[] {
  const contract = getAuthCookieContract(url);
  const complete = all.some(cookie => cookie.name === contract.marker && cookie.value === '1');
  // An old tab can receive another HTTP credential after browser cleanup.
  // Deny mixed/incomplete generations instead of serving a new account to it.
  const mixed = all.some(cookie => isPreviousCredential(cookie.name, contract));
  return all.filter(cookie => !isPreviousCredential(cookie.name, contract)
    && !((!complete || mixed) && isSessionCredential(cookie.name, contract.key)));
}
