import { commitSupabaseBrowserSession } from '@/integrations/supabase/client';
import { advanceBrowserAuthRevision, captureBrowserAuthState } from './browser-commit-state';
import { getAuthCookieContract, getBrowserAuthCookieOptions, migrateBrowserAuthCookies, withBrowserAuthCookieLock } from './session-cookies';
import { getSafeAuthNextPath } from './auth-redirect';
import { parseSignupPkceCookies } from './signup-pkce-handoff';
import { parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';

type Intent = { version: 1; id: string; digest: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const config = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) throw new Error('AUTH_CALLBACK_UNAVAILABLE');
  const contract = getAuthCookieContract(url);
  return { url, contract, intentKey: `tz-oauth-intent:${contract.key}` };
};
const digest = async (value: string) => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
)).map(byte => byte.toString(16).padStart(2, '0')).join('');

function readIntent(key: string): Intent {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value && typeof value === 'object' && Object.keys(value).length === 3
      && 'version' in value && value.version === 1 && 'id' in value && typeof value.id === 'string' && UUID.test(value.id)
      && 'digest' in value && typeof value.digest === 'string' && /^[0-9a-f]{64}$/.test(value.digest)) return value as Intent;
  } catch { /* Treat missing/blocked/malformed intent storage identically. */ }
  throw new Error('AUTH_CALLBACK_INTENT_REQUIRED');
}

export async function beginBrowserAuthIntent() {
  const { url, contract, intentKey } = config();
  const captured = await withBrowserAuthCookieLock(url, () => {
    migrateBrowserAuthCookies(url);
    const id = advanceBrowserAuthRevision(contract);
    return { id, state: captureBrowserAuthState(contract) };
  });
  const intent: Intent = { version: 1, id: captured.id, digest: await digest(captured.state) };
  await withBrowserAuthCookieLock(url, () => {
    if (captureBrowserAuthState(contract) !== captured.state) throw new Error('AUTH_CALLBACK_SUPERSEDED');
    try {
      // Email verification can open in a different tab. This record contains
      // only a random revision and a digest, never credentials or account data.
      localStorage.setItem(intentKey, JSON.stringify(intent));
      if (readIntent(intentKey).id !== intent.id) throw new Error();
    } catch { throw new Error('AUTH_CALLBACK_INTENT_REQUIRED'); }
  });
  return intent;
}

export const beginBrowserOAuthIntent = beginBrowserAuthIntent;

async function captureIntentPrecondition(intent: Intent, signal: AbortSignal) {
  const { url, contract, intentKey } = config();
  const state = await withBrowserAuthCookieLock(url, () => {
    if (signal.aborted || readIntent(intentKey).id !== intent.id) throw new Error('AUTH_CALLBACK_SUPERSEDED');
    return captureBrowserAuthState(contract);
  });
  if (await digest(state) !== intent.digest) throw new Error('AUTH_CALLBACK_SUPERSEDED');
  return withBrowserAuthCookieLock(url, () => {
    if (signal.aborted || readIntent(intentKey).id !== intent.id || captureBrowserAuthState(contract) !== state) {
      throw new Error('AUTH_CALLBACK_SUPERSEDED');
    }
    return state;
  });
}

export async function captureBrowserAuthIntent(signal = new AbortController().signal) {
  const { intentKey } = config();
  const intent = readIntent(intentKey);
  await captureIntentPrecondition(intent, signal);
  return {
    assertCurrent: () => captureIntentPrecondition(intent, signal),
    async consumeVerifiers(names: string[]) {
      const { url, contract } = config();
      const expected = await captureIntentPrecondition(intent, signal);
      await withBrowserAuthCookieLock(url, () => {
        if (signal.aborted || readIntent(intentKey).id !== intent.id || captureBrowserAuthState(contract) !== expected) {
          throw new Error('AUTH_CALLBACK_SUPERSEDED');
        }
        const verifier = `${contract.key}-code-verifier`;
        if (names.some(name => name !== verifier && !name.startsWith(`${verifier}-`) && !name.startsWith(`${verifier}.`))) {
          throw new Error('AUTH_CALLBACK_FAILED');
        }
        for (const name of names) document.cookie = serializeCookieHeader(name, '', { ...getBrowserAuthCookieOptions(), maxAge: 0 });
        if (parseCookieHeader(document.cookie).some(cookie => names.includes(cookie.name))) throw new Error('AUTH_COOKIE_WRITE_FAILED');
        localStorage.removeItem(intentKey);
        if (localStorage.getItem(intentKey) !== null) throw new Error('AUTH_CALLBACK_SUPERSEDED');
      });
    },
  };
}

export async function publishBrowserSignupPkce(intent: Intent, input: unknown, signal = new AbortController().signal) {
  const { url, contract, intentKey } = config();
  const verifier = `${contract.key}-code-verifier`;
  const mutations = parseSignupPkceCookies(input, contract.key);
  if (!mutations) throw new Error('AUTH_CALLBACK_FAILED');
  const expected = await captureIntentPrecondition(intent, signal);
  await withBrowserAuthCookieLock(url, () => {
    if (signal.aborted || readIntent(intentKey).id !== intent.id || captureBrowserAuthState(contract) !== expected) {
      throw new Error('AUTH_CALLBACK_SUPERSEDED');
    }
    // The request-local signup client has no incoming cookie jar. Remove an
    // older verifier shape before publishing its replacement under this lock.
    const stale = parseCookieHeader(document.cookie).filter(cookie =>
      cookie.name === verifier || cookie.name.startsWith(`${verifier}.`) || cookie.name.startsWith(`${verifier}-`));
    for (const cookie of stale) {
      document.cookie = serializeCookieHeader(cookie.name, '', { ...getBrowserAuthCookieOptions(), maxAge: 0 });
    }
    for (const item of mutations) {
      document.cookie = serializeCookieHeader(item.name, item.value,
        item.remove ? { ...getBrowserAuthCookieOptions(), maxAge: 0 } : getBrowserAuthCookieOptions());
    }
    const actual = parseCookieHeader(document.cookie);
    if (mutations.some(item => item.remove ? actual.some(cookie => cookie.name === item.name)
      : !actual.some(cookie => cookie.name === item.name && cookie.value === item.value))) {
      throw new Error('AUTH_COOKIE_WRITE_FAILED');
    }
  });
}

export async function completeBrowserOAuthCallback(code: string, next: string, signal: AbortSignal) {
  const { url, intentKey, contract } = config();
  const intent = readIntent(intentKey);
  await captureIntentPrecondition(intent, signal);
  const verifier = `${contract.key}-code-verifier`;
  const isVerifier = (name: string) => name === verifier || name.startsWith(`${verifier}-`) || name.startsWith(`${verifier}.`);
  const verifiers = await withBrowserAuthCookieLock(url, () => parseCookieHeader(document.cookie).filter(cookie => isVerifier(cookie.name)));
  // Code exchange is deliberately one attempt. A lost response is uncertain;
  // retrying the one-use code cannot safely recreate the accepted operation.
  const response = await fetch('/auth/callback', {
    method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, next: getSafeAuthNextPath(next) }),
    signal,
  });
  if (!response.ok) throw new Error('AUTH_CALLBACK_FAILED');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true
    || !('next' in body) || typeof body.next !== 'string' || !('tokens' in body)
    || !body.tokens || typeof body.tokens !== 'object' || !('access_token' in body.tokens)
    || typeof body.tokens.access_token !== 'string' || !body.tokens.access_token
    || !('refresh_token' in body.tokens) || typeof body.tokens.refresh_token !== 'string' || !body.tokens.refresh_token) {
    throw new Error('AUTH_CALLBACK_FAILED');
  }
  const tokens = { access_token: body.tokens.access_token, refresh_token: body.tokens.refresh_token };
  try {
    if (!('consumedVerifiers' in body) || !Array.isArray(body.consumedVerifiers)
      || body.consumedVerifiers.some(name => typeof name !== 'string' || !isVerifier(name))) throw new Error('AUTH_CALLBACK_FAILED');
    const consumed = new Set<string>(body.consumedVerifiers);
    const expected = await captureIntentPrecondition(intent, signal);
    // Finish fallible verifier cleanup before publishing credentials. Failure
    // must not leave a persisted session whose tokens were then revoked.
    await withBrowserAuthCookieLock(url, () => {
      if (signal.aborted || readIntent(intentKey).id !== intent.id || captureBrowserAuthState(contract) !== expected) {
        throw new Error('AUTH_CALLBACK_SUPERSEDED');
      }
      for (const cookie of verifiers) {
        if (!consumed.has(cookie.name) || !parseCookieHeader(document.cookie).some(current => current.name === cookie.name && current.value === cookie.value)) continue;
        document.cookie = serializeCookieHeader(cookie.name, '', { path: '/', maxAge: 0 });
        if (parseCookieHeader(document.cookie).some(current => current.name === cookie.name && current.value === cookie.value)) throw new Error('AUTH_COOKIE_WRITE_FAILED');
      }
    });
    const result = await commitSupabaseBrowserSession(tokens, expected,
      () => !signal.aborted && readIntent(intentKey).id === intent.id);
    if (!result.committed) throw new Error('AUTH_CALLBACK_FAILED');
  } catch {
    // Revoke only the unused session delivered to this attempt. Never call SDK
    // signOut against whatever account another tab has since committed.
    try {
      await fetch(`${url.replace(/\/$/, '')}/auth/v1/logout?scope=local`, {
        method: 'POST', headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch { /* The generic failure UI does not claim revocation succeeded. */ }
    throw new Error('AUTH_CALLBACK_FAILED');
  }
  try {
    await withBrowserAuthCookieLock(url, () => {
      if (readIntent(intentKey).id === intent.id) localStorage.removeItem(intentKey);
    });
  }
  catch { /* A committed session does not depend on intent cleanup. */ }
  return getSafeAuthNextPath(body.next);
}
