import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

export async function revokeCurrentUserSessions(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  supabaseAdmin: SupabaseClient;
  request: Request;
}) {
  const {
    data: { session },
  } = await input.supabase.auth.getSession();
  const bearerToken = input.request.headers.get('Authorization')?.startsWith('Bearer ')
    ? input.request.headers.get('Authorization')?.slice('Bearer '.length).trim()
    : null;
  const accessToken = session?.access_token ?? bearerToken;
  if (!accessToken) return;

  const { error } = await input.supabaseAdmin.auth.admin.signOut(accessToken, 'global');
  if (error) {
    console.warn('[account/delete] failed to revoke current user sessions before deletion:', error);
  }
}
