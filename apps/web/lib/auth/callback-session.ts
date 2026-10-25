import { createClient, getConsumedPkceCookieNames } from '@/lib/supabase/server';

export async function createCallbackSupabaseClient() {
  return createClient();
}

export async function getCallbackSessionTokens(client: Awaited<ReturnType<typeof createCallbackSupabaseClient>>) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token || !data.session.refresh_token) throw new Error('AUTH_CALLBACK_SESSION_UNAVAILABLE');
  return { tokens: { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
    consumedVerifiers: getConsumedPkceCookieNames(client) };
}

type CallbackAuthClient = {
  auth: {
    signOut: (args: { scope: 'global' | 'local' }) => Promise<unknown>;
  };
};

export async function revokeRejectedCallbackSession(supabase: CallbackAuthClient) {
  try {
    await supabase.auth.signOut({ scope: 'global' });
  } catch {
    // A rejected callback still revokes its captured server session.
  }

  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // The rejection redirect clears onboarding cookies; no auth mutations are committed.
  }
}
