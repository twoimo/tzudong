import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { Database } from '@/integrations/supabase/types';
import { beginBrowserAuthIntent, captureBrowserAuthIntent, publishBrowserSignupPkce } from './browser-oauth-commit';
import { getAuthCookieContract, withBrowserAuthCookieLock } from './session-cookies';

type Cookie = { name: string; value: string };
const config = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) throw new Error('AUTH_CALLBACK_UNAVAILABLE');
  return { url, key, cookieKey: getAuthCookieContract(url).key };
};
const isVerifier = (name: string, key: string) => name === `${key}-code-verifier`
  || name.startsWith(`${key}-code-verifier.`) || name.startsWith(`${key}-code-verifier-`);

// The SSR adapter supplies PKCE encoding/chunking, but its entire jar is in
// memory. A unique storage key also isolates the SDK's BroadcastChannel.
export function createMemoryPkceClient(initial: Cookie[] = []) {
  const { url, key, cookieKey } = config();
  const isolatedKey = `${cookieKey}-isolated-${crypto.randomUUID()}`;
  const jar = new Map(initial.filter(cookie => isVerifier(cookie.name, cookieKey))
    .map(cookie => [isolatedKey + cookie.name.slice(cookieKey.length), cookie.value]));
  const mutations: Array<{ name: string; value: string; remove: boolean }> = [];
  const client = createServerClient<Database>(url, key, {
    cookieOptions: { name: isolatedKey },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll(cookies) {
        for (const cookie of cookies) {
          if (cookie.options.maxAge === 0) jar.delete(cookie.name);
          else jar.set(cookie.name, cookie.value);
          if (isVerifier(cookie.name, isolatedKey)) mutations.push({
            name: cookieKey + cookie.name.slice(isolatedKey.length), value: cookie.value, remove: cookie.options.maxAge === 0,
          });
        }
      },
    },
  });
  return { client, mutations };
}

export async function requestBrowserPasswordRecovery(email: string) {
  const intent = await beginBrowserAuthIntent();
  const { client, mutations } = createMemoryPkceClient();
  try {
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) throw new Error('AUTH_RECOVERY_REQUEST_FAILED');
    await publishBrowserSignupPkce(intent, mutations);
  } finally { await client.auth.dispose(); }
}

export async function startBrowserGoogleOAuth(redirectTo: string) {
  const intent = await beginBrowserAuthIntent();
  const { client, mutations } = createMemoryPkceClient();
  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google', options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data.url) throw new Error('AUTH_CALLBACK_FAILED');
    await publishBrowserSignupPkce(intent, mutations);
    window.location.assign(data.url);
  } finally { await client.auth.dispose(); }
}

export function parsePasswordRecoveryQuery(search: string) {
  const query = new URLSearchParams(search);
  const keys = [...query.keys()];
  if (new Set(keys).size !== keys.length || keys.some(key => !['code', 'token', 'token_hash', 'type', 'sb_flow_id'].includes(key))) return null;
  const value = query.get('code') || query.get('token');
  const hash = query.get('token_hash');
  const flowId = query.get('sb_flow_id');
  if (['code', 'token', 'token_hash'].filter(key => query.has(key)).length !== 1) return null;
  if (flowId !== null && !/^[A-Za-z0-9_-]{8,128}$/.test(flowId)) return null;
  if (value && !hash && value.length <= 2048 && (query.get('type') === null || query.get('type') === 'recovery')
    && !(query.has('code') && query.has('token'))) return { kind: 'code' as const, code: value, flowId };
  if (hash && !value && hash.length <= 2048 && query.get('type') === 'recovery' && !flowId) return { kind: 'hash' as const, hash };
  return null;
}

export async function openBrowserPasswordRecovery(search: string) {
  const query = parsePasswordRecoveryQuery(search);
  if (!query) throw new Error('AUTH_RECOVERY_LINK_REQUIRED');
  const intent = await captureBrowserAuthIntent();
  const { url, cookieKey } = config();
  const verifiers = await withBrowserAuthCookieLock(url, () => parseCookieHeader(document.cookie)
    .filter(cookie => isVerifier(cookie.name, cookieKey)));
  await intent.assertCurrent();
  const { client } = createMemoryPkceClient(verifiers);
  let recoveryObserved = false;
  let token: string | null = null;
  let disposed = false;
  let disposal: Promise<boolean> | null = null;
  const { data: { subscription } } = client.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY') recoveryObserved = true; });
  const dispose = () => {
    if (disposal) return disposal;
    disposed = true;
    subscription.unsubscribe();
    const capturedToken = token;
    token = null;
    disposal = (async () => {
      try { return !capturedToken || !(await client.auth.admin.signOut(capturedToken, 'local')).error; }
      catch { return false; }
      finally { await client.auth.dispose(); }
    })();
    return disposal;
  };
  try {
    const result = query.kind === 'code'
      ? await client.auth.exchangeCodeForSession(query.code, query.flowId ? { flowId: query.flowId } : undefined)
      : await client.auth.verifyOtp({ type: 'recovery', token_hash: query.hash });
    token = result.data.session?.access_token ?? null;
    if (result.error || !token || !recoveryObserved) throw new Error('AUTH_RECOVERY_LINK_REQUIRED');
    await intent.assertCurrent();
    return {
      dispose,
      async updatePassword(password: string) {
        if (disposed) throw new Error('AUTH_RECOVERY_LINK_REQUIRED');
        let revoked = false;
        try {
          await intent.assertCurrent();
          const { error } = await client.auth.updateUser({ password });
          if (error) throw new Error('AUTH_PASSWORD_UPDATE_FAILED');
          await intent.assertCurrent();
          await intent.consumeVerifiers(verifiers.map(cookie => cookie.name));
        } finally { revoked = await dispose(); }
        if (!revoked) throw new Error('AUTH_ISOLATED_SESSION_CLEANUP_FAILED');
      },
    };
  } catch {
    await dispose();
    throw new Error('AUTH_RECOVERY_LINK_REQUIRED');
  }
}
