import { isChunkLike, parseCookieHeader, stringFromBase64URL } from '@supabase/ssr';
import { getAuthCookieContract, migrateBrowserAuthCookies, withBrowserAuthCookieLock } from './session-cookies';
import { advanceBrowserAuthRevision, captureBrowserAuthState } from './browser-commit-state';

type CookieMutation = { name: string; value: string; options: { maxAge?: number } };

// The SDK's post-response storage read and its later save are separate awaits.
// Retain the refresh's ownership precondition until the cookie adapter commits.
// This fences cooperating browser batches, not native HTTP Set-Cookie writers.
export function createBrowserRefreshGuard(url: string) {
  const contract = getAuthCookieContract(url);
  const { key } = contract;
  const tokenUrl = new URL(`${url.replace(/\/$/, '')}/auth/v1/token`);
  const pending = new Map<string, { expected: string; ambiguous: boolean; ownsRequest(): boolean; cleanup?(): void }>();
  const fingerprint = () => captureBrowserAuthState(contract);
  function currentTokens() {
    const all = parseCookieHeader(document.cookie);
    const parts = all.filter(cookie => isChunkLike(cookie.name, key))
      .sort((a, b) => Number(a.name.slice(key.length + 1)) - Number(b.name.slice(key.length + 1)));
    const encoded = all.find(cookie => cookie.name === key)?.value
      ?? (parts.every((part, index) => part.name === `${key}.${index}`) ? parts.map(part => part.value).join('') : '');
    try {
      const session = JSON.parse(encoded.startsWith('base64-') ? stringFromBase64URL(encoded.slice(7)) : encoded);
      return typeof session?.access_token === 'string' && typeof session?.refresh_token === 'string' ? session : null;
    } catch { return null; }
  }
  function registerCommit(token: string, expected: string, ownsRequest = () => true, cleanup?: () => void) {
    if (pending.size >= 32 && !pending.has(token)) throw new Error('AUTH_REFRESH_GUARD_CAPACITY');
    const previous = pending.get(token);
    pending.set(token, { expected, cleanup: cleanup ?? previous?.cleanup, ownsRequest: () => ownsRequest() && (!previous || previous.ownsRequest()),
      ambiguous: !!previous && (previous.ambiguous || previous.expected !== expected) });
  }

  const guardedFetch: typeof fetch = async (input, init) => {
    const requestUrl = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const tokenRequest = method.toUpperCase() === 'POST' && requestUrl.pathname === tokenUrl.pathname
      && ['refresh_token', 'password'].includes(requestUrl.searchParams.get('grant_type') ?? '');
    const userRequest = ['GET', 'PUT'].includes(method.toUpperCase())
      && requestUrl.pathname === tokenUrl.pathname.replace(/\/token$/, '/user');
    if (typeof document === 'undefined' || requestUrl.origin !== tokenUrl.origin || (!tokenRequest && !userRequest)) {
      return globalThis.fetch(input, init);
    }
    // Never evict an uncommitted guard: a suspended renderer may still resume
    // with that response. Exhaustion is retryable after reloading the document.
    if (pending.size >= 32) throw new Error('AUTH_REFRESH_GUARD_CAPACITY');
    let inherited: ReturnType<typeof pending.get>;
    try {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (body && typeof body.refresh_token === 'string') inherited = pending.get(body.refresh_token);
    } catch { /* Request parsing remains the SDK/provider's responsibility. */ }
    const captured = await withBrowserAuthCookieLock(url, () => {
      migrateBrowserAuthCookies(url);
      if (requestUrl.searchParams.get('grant_type') === 'password') advanceBrowserAuthRevision(contract);
      const tokens = currentTokens();
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
      const currentUserRequest = userRequest && tokens?.access_token
        && headers.get('Authorization') === `Bearer ${tokens.access_token}`;
      if (userRequest && method.toUpperCase() === 'PUT' && !currentUserRequest) throw new Error('AUTH_REFRESH_SUPERSEDED');
      return { state: fingerprint(), token: currentUserRequest ? tokens.refresh_token as string : null };
    });
    const expected = inherited?.expected ?? captured.state;
    const response = await globalThis.fetch(input, init);
    if (response.ok) {
      // updateUser and SDK initialization may save the session they read before
      // /user completed. The response does not carry a new refresh token.
      if (userRequest) {
        if (captured.token) registerCommit(captured.token, expected);
        return response;
      }
      let body: unknown;
      try { body = await response.clone().json(); }
      // Preserve SDK response validation. Throwing here would turn a malformed
      // response into a retryable network error and repeat the refresh request.
      catch { return response; }
      if (!body || typeof body !== 'object' || !('refresh_token' in body)
        || typeof body.refresh_token !== 'string' || !body.refresh_token) {
        return response;
      }
      registerCommit(body.refresh_token, expected, inherited?.ownsRequest, inherited?.cleanup);
    }
    return response;
  };

  // Called inside the same Web Lock as migration, writes and persistence
  // readback. No network request or asynchronous parsing occurs in this batch.
  function prepareCommit(cookies: CookieMutation[]) {
    const credentials = cookies.filter(cookie => isChunkLike(cookie.name, key) || isChunkLike(cookie.name, `${key}-user`));
    if (!credentials.length) {
      if (cookies.some(cookie => cookie.name.startsWith(`${key}-code-verifier`))) throw new Error('AUTH_PKCE_WRITE_UNOWNED');
      return () => {};
    }
    // SDK error paths remove whichever session occupies its shared storage key.
    // Only captureBrowserLogout's owned, atomic batch may remove credentials.
    if (credentials.every(cookie => cookie.options.maxAge === 0)) throw new Error('AUTH_SESSION_REMOVAL_REQUIRES_OWNER');
    const writes = cookies.filter(cookie => cookie.options.maxAge !== 0);
    let encoded = writes.find(cookie => cookie.name === key)?.value;
    if (encoded === undefined) {
      const parts = writes.filter(cookie => isChunkLike(cookie.name, key))
        .sort((a, b) => Number(a.name.slice(key.length + 1)) - Number(b.name.slice(key.length + 1)));
      if (!parts.length) throw new Error('AUTH_SESSION_WRITE_UNOWNED');
      if (parts.some((part, index) => part.name !== `${key}.${index}`)) {
        throw new Error('AUTH_REFRESH_COOKIE_INVALID');
      }
      encoded = parts.map(part => part.value).join('');
    }
    let session: unknown;
    try {
      session = JSON.parse(encoded.startsWith('base64-') ? stringFromBase64URL(encoded.slice(7)) : encoded);
    } catch {
      throw new Error('AUTH_REFRESH_COOKIE_INVALID');
    }
    if (!session || typeof session !== 'object' || !('refresh_token' in session)
      || typeof session.refresh_token !== 'string') throw new Error('AUTH_REFRESH_COOKIE_INVALID');
    const token = session.refresh_token;
    const guard = pending.get(token);
    if (!guard) throw new Error('AUTH_SESSION_WRITE_UNOWNED');
    if (!guard.ownsRequest() || guard.ambiguous || fingerprint() !== guard.expected) {
      // Keep rejected guards, and throw a plain error so the SDK does not
      // interpret it as an invalid credential and remove a newer session.
      throw new Error('AUTH_REFRESH_SUPERSEDED');
    }
    return () => { guard.cleanup?.(); pending.delete(token); };
  }

  return { fetch: guardedFetch, prepareCommit, registerCommit };
}
