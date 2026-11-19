import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export type AdminAccess = 'active-admin' | 'inactive-session' | 'not-active-admin';

async function isCurrentSessionActive(supabase: SupabaseClient<Database>) {
  try {
    const { data, error } = await supabase
      .rpc('is_current_auth_session_active' as never)
      .returns<boolean>();
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function checkAdminAccess(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<AdminAccess> {
  if (!(await isCurrentSessionActive(supabase))) return 'inactive-session';

  const { data: role, error: roleError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();

  if (roleError || !role) return 'not-active-admin';

  const { data: accountStatus, error: accountStatusError } = await supabase
    .from('user_account_status')
    .select('account_status, disabled_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (accountStatusError || accountStatus?.account_status !== 'active' || accountStatus.disabled_at !== null) {
    return 'not-active-admin';
  }

  return 'active-admin';
}
