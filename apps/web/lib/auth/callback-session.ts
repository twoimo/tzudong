import { createClient } from '@/lib/supabase/server';

export async function createCallbackSupabaseClient() {
  return createClient();
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
    // A rejected callback must still attempt local cookie cleanup.
  }

  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // The rejection redirect clears onboarding and browser auth cookies.
  }
}
