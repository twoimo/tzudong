import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

export async function revokeCurrentUserSessions(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  supabaseAdmin: SupabaseClient;
  request: Request;
  verifiedBearerToken?: string;
}) {
  const {
    data: { session },
  } = await input.supabase.auth.getSession();
  const accessToken = input.verifiedBearerToken ?? session?.access_token;
  if (!accessToken) return;

  const { error } = await input.supabaseAdmin.auth.admin.signOut(accessToken, 'global');
  if (error) {
    console.warn('[account/deletion-worker] failed to revoke current user sessions:', error);
  }
}
