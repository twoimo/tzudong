import { DEFAULT_COOKIE_OPTIONS, clearAuthCookiesAtScopes, isChunkLike, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { beginBrowserAuthCookieBatch, finishBrowserAuthCookieBatch, getAuthCookieContract, withBrowserAuthCookieLock } from './session-cookies';
import { advanceBrowserAuthRevision, captureBrowserAuthState } from './browser-commit-state';

// This adapter follows our browser client's default host-only, path=/ cookie
// contract. The server has already revoked the captured session. Calling SDK
// signOut again would await another HTTP request, then unconditionally remove
// whichever session now occupies the same storage key.
export function captureBrowserLogout() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url || typeof document === 'undefined') throw new Error('AUTH_LOCAL_LOGOUT_UNAVAILABLE');
  const { key: storageKey, marker } = getAuthCookieContract(url);
  const contract = getAuthCookieContract(url);
  const belongsToSession = (name: string) => isChunkLike(name, storageKey)
    || isChunkLike(name, `${storageKey}-user`)
    || name === `${storageKey}-code-verifier` || name.startsWith(`${storageKey}-code-verifier-`)
    || name.startsWith(`${storageKey}-code-verifier.`);
  const read = () => parseCookieHeader(document.cookie).filter(cookie => belongsToSession(cookie.name));
  const snapshot = read();
  const fingerprint = (cookies: ReturnType<typeof read>) => JSON.stringify(
    cookies.map(({ name, value }) => [name, value]).sort(([a], [b]) => a.localeCompare(b)),
  );
  const expected = fingerprint(snapshot);
  const expectedState = captureBrowserAuthState(contract);
  const isCurrent = () => fingerprint(read()) === expected && captureBrowserAuthState(contract) === expectedState;

  return {
    isCurrent,
    isCleared: () => read().length === 0 && parseCookieHeader(document.cookie).some(cookie => cookie.name === marker && cookie.value === '1'),
    async clearIfCurrent(ownsRequest: () => boolean): Promise<boolean> {
      const keys = new Set([storageKey, `${storageKey}-user`, `${storageKey}-code-verifier`]);
      for (const cookie of snapshot) keys.add(cookie.name.replace(/\.\d+$/, ''));
      const mutations: Array<{ name: string; value: string; options: Parameters<typeof serializeCookieHeader>[2] }> = [];
      // Use the pinned SSR package's public chunk/scope cleanup API to prepare
      // mutations. No cookie is written across its asynchronous boundaries.
      await Promise.all([...keys].map(key => clearAuthCookiesAtScopes({
        storageKey: key,
        scopes: [{ path: '/' }],
        getAll: () => snapshot,
        setAll: cookies => { mutations.push(...cookies); },
      })));
      return withBrowserAuthCookieLock(url, () => {
        if (!ownsRequest() || !isCurrent()) return false;
        advanceBrowserAuthRevision(contract);
        // HTTP readers must reject a partially applied logout too.
        try { beginBrowserAuthCookieBatch(url); }
        catch { throw new Error('AUTH_LOCAL_LOGOUT_FAILED'); }
        // The ownership check runs after lock admission. Keep every deletion in
        // this same batch so another cooperating tab cannot read partial chunks.
        for (const cookie of mutations) {
          document.cookie = serializeCookieHeader(cookie.name, cookie.value, cookie.options);
        }
        if (read().length > 0) throw new Error('AUTH_LOCAL_LOGOUT_FAILED');
        try { finishBrowserAuthCookieBatch(url); }
        catch { throw new Error('AUTH_LOCAL_LOGOUT_FAILED'); }
        return true;
      });
    },
  };
}
