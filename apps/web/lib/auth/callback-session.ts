import { createClient, getConsumedPkceCookieNames } from '@/lib/supabase/server';

type CallbackClient = Awaited<ReturnType<typeof createClient>>;
type CapturedSession = Readonly<{
  tokens: { access_token: string; refresh_token: string };
  userId: string;
}>;
const exchangedSessions = new WeakMap<object, CapturedSession>();

export async function createCallbackSupabaseClient() {
  return createClient();
}

export async function exchangeCallbackCode(client: CallbackClient, code: string) {
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  const session = data?.session;
  if (error || !session?.access_token || !session.refresh_token || !session.user?.id) return null;
  const captured = {
    tokens: { access_token: session.access_token, refresh_token: session.refresh_token },
    userId: session.user.id,
  };
  exchangedSessions.set(client, captured);
  return { userId: captured.userId };
}

export async function getCallbackSessionTokens(client: CallbackClient) {
  const captured = exchangedSessions.get(client);
  if (!captured) throw new Error('AUTH_CALLBACK_SESSION_UNAVAILABLE');
  return { tokens: { ...captured.tokens }, consumedVerifiers: getConsumedPkceCookieNames(client) };
}

export async function revokeRejectedCallbackSession(client: CallbackClient) {
  const captured = exchangedSessions.get(client);
  exchangedSessions.delete(client);
  if (!captured) return;
  try {
    // A failed exchange can leave the incoming cookie session in the SDK.
    // Revoke only the session captured from this successful code exchange.
    await client.auth.admin.signOut(captured.tokens.access_token, 'local');
  } catch {
    // Rejection stays fail-closed and never exposes provider diagnostics.
  }
}
