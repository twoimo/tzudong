import { DEFAULT_COOKIE_OPTIONS, isChunkLike, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';

type Cookie = { name: string; value: string };

export function getAuthCookieContract(url: string) {
  const project = new URL(url).hostname.split('.')[0];
  return {
    legacyKey: `sb-${project}-auth-token`,
    key: `sb-${project}-v2-auth-token`,
    marker: `tz-auth-v2-${project}`,
  };
}

function belongsToKey(name: string, key: string) {
  return isChunkLike(name, key) || isChunkLike(name, `${key}-user`)
    || name === `${key}-code-verifier` || name.startsWith(`${key}-code-verifier-`)
    || name.startsWith(`${key}-code-verifier.`);
}

// Serializes cooperating browser cookie batches, including the migration that
// reads can trigger. The SDK's default coordination does not acquire Web Locks.
// Native Set-Cookie responses and already-loaded older clients do not participate.
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

// Only the first upgraded browser read may import legacy cookies. The marker
// survives logout so a dormant old tab cannot resurrect its later writes.
export function migrateBrowserAuthCookies(url: string) {
  const { key, legacyKey, marker } = getAuthCookieContract(url);
  let all = parseCookieHeader(document.cookie);
  const state = all.find(cookie => cookie.name === marker)?.value;
  if (state === '1') return;
  if ((state !== undefined && state !== 'pending')
      || (state === undefined && all.some(cookie => belongsToKey(cookie.name, key)))) {
    throw new Error('AUTH_COOKIE_MIGRATION_INCOMPLETE');
  }
  const read = () => parseCookieHeader(document.cookie);
  const committed = () => read().some(cookie => cookie.name === marker && cookie.value === '1');
  if (state === undefined) {
    // The first snapshot can precede another response's login/logout commit.
    // Never reset its completed marker to pending using that older snapshot.
    const live = read();
    if (live.some(cookie => cookie.name === marker && cookie.value === '1')) return;
    if (live.some(cookie => cookie.name === marker || belongsToKey(cookie.name, key))) {
      throw new Error('AUTH_COOKIE_MIGRATION_INCOMPLETE');
    }
    all = live;
    document.cookie = serializeCookieHeader(marker, 'pending', DEFAULT_COOKIE_OPTIONS);
    if (!read().some(cookie => cookie.name === marker && cookie.value === 'pending')) {
      throw new Error('AUTH_COOKIE_MIGRATION_FAILED');
    }
  }
  const expected = all.filter(cookie => belongsToKey(cookie.name, legacyKey))
    .map(cookie => ({ name: key + cookie.name.slice(legacyKey.length), value: cookie.value }));
  // Only pending migration artifacts may be retried. An established session or
  // logout tombstone is never reset to make legacy credentials readable again.
  for (const cookie of all.filter(cookie => belongsToKey(cookie.name, key)
      && !expected.some(candidate => candidate.name === cookie.name))) {
    if (committed()) return;
    document.cookie = serializeCookieHeader(cookie.name, '', { ...DEFAULT_COOKIE_OPTIONS, maxAge: 0 });
  }
  for (const cookie of expected) {
    if (committed()) return;
    document.cookie = serializeCookieHeader(cookie.name, cookie.value, DEFAULT_COOKIE_OPTIONS);
  }
  if (committed()) return;
  const copied = read().filter(cookie => belongsToKey(cookie.name, key));
  if (copied.length !== expected.length
      || expected.some(cookie => !copied.some(actual => actual.name === cookie.name && actual.value === cookie.value))) {
    throw new Error('AUTH_COOKIE_MIGRATION_FAILED');
  }
  document.cookie = serializeCookieHeader(marker, '1', DEFAULT_COOKIE_OPTIONS);
  if (!committed()) throw new Error('AUTH_COOKIE_MIGRATION_FAILED');
}

export function readServerAuthCookies(all: Cookie[], url: string): Cookie[] {
  const { key, legacyKey, marker } = getAuthCookieContract(url);
  if (all.some(cookie => cookie.name === marker || belongsToKey(cookie.name, key))) return all;
  // A navigation can precede hydration of the first upgraded browser tab.
  // Read the old session for that request without emitting migration cookies.
  return [...all, ...all.filter(cookie => belongsToKey(cookie.name, legacyKey))
    .map(cookie => ({ name: key + cookie.name.slice(legacyKey.length), value: cookie.value }))];
}
