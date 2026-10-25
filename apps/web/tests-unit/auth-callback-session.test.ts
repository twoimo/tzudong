import { afterEach, describe, expect, mock, test } from 'bun:test';

let instance = 0;
async function load(createClient: () => Promise<unknown> = async () => ({})) {
  mock.module('@/lib/supabase/server', () => ({ createClient, getConsumedPkceCookieNames: () => ['synthetic-verifier'] }));
  try { return await import(`../lib/auth/callback-session.ts?test=${++instance}`); }
  finally { mock.restore(); }
}
afterEach(() => mock.restore());
const session = { access_token: 'new-callback-access', refresh_token: 'new-callback-refresh', user: { id: 'callback-user' }, provider_token: 'private-provider-token' };
function client(result = { data: { session }, error: null }) {
  const calls: unknown[] = [];
  return { calls, auth: {
    exchangeCodeForSession: async () => result,
    // This represents a different account from the request's existing cookies.
    getSession: async () => { calls.push('read-incoming'); return { data: { session: { access_token: 'incoming-access' } }, error: null }; },
    signOut: async () => { calls.push('sign-out-current'); },
    admin: { signOut: async (token: string, scope: string) => { calls.push({ token, scope }); } },
  } };
}

describe('callback session ownership', () => {
  test('uses the request-local server factory', async () => {
    const sentinel = {}; const m = await load(async () => sentinel);
    expect(await m.createCallbackSupabaseClient()).toBe(sentinel);
  });
  test('failed exchange cannot revoke an existing incoming account', async () => {
    const m = await load(), c = client({ data: { session: null }, error: new Error('provider rejected') } as never);
    expect(await m.exchangeCallbackCode(c as never, 'invalid-code')).toBeNull();
    await m.revokeRejectedCallbackSession(c as never);
    expect(c.calls).toEqual([]);
    await expect(m.getCallbackSessionTokens(c as never)).rejects.toThrow('AUTH_CALLBACK_SESSION_UNAVAILABLE');
  });
  test('malformed success cannot publish the incoming account', async () => {
    const m = await load(), c = client({ data: { session: null }, error: null } as never);
    expect(await m.exchangeCallbackCode(c as never, 'invalid-response')).toBeNull();
    await m.revokeRejectedCallbackSession(c as never);
    expect(c.calls).toEqual([]);
    await expect(m.getCallbackSessionTokens(c as never)).rejects.toThrow('AUTH_CALLBACK_SESSION_UNAVAILABLE');
  });
  test('handoff contains only this exchange token pair and consumed verifier names', async () => {
    const m = await load(), c = client();
    expect(await m.exchangeCallbackCode(c as never, 'valid-code')).toEqual({ userId: 'callback-user' });
    expect(await m.getCallbackSessionTokens(c as never)).toEqual({ tokens: { access_token: session.access_token, refresh_token: session.refresh_token }, consumedVerifiers: ['synthetic-verifier'] });
    expect(c.calls).toEqual([]);
  });
  test('rejection revokes only the captured session once with local scope', async () => {
    const m = await load(), c = client();
    await m.exchangeCallbackCode(c as never, 'valid-code');
    await m.revokeRejectedCallbackSession(c as never);
    await m.revokeRejectedCallbackSession(c as never);
    expect(c.calls).toEqual([{ token: session.access_token, scope: 'local' }]);
  });
  test('revocation failure cannot fall back to global or incoming-account logout', async () => {
    const m = await load(), c = client();
    c.auth.admin.signOut = async (token, scope) => { c.calls.push({ token, scope }); throw new Error('unavailable'); };
    await m.exchangeCallbackCode(c as never, 'valid-code');
    await expect(m.revokeRejectedCallbackSession(c as never)).resolves.toBeUndefined();
    await m.revokeRejectedCallbackSession(c as never);
    expect(c.calls).toEqual([{ token: session.access_token, scope: 'local' }]);
  });
});
