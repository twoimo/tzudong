import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

type RequireAdminOk = {
  ok: true;
  userId: string;
};

type RequireAdminFail = {
  ok: false;
  response: NextResponse;
};

function isMissingOptionalAdminStatusStoreError(error: unknown) {
  if (!error || typeof error !== 'object') return false;

  const code = 'code' in error ? String(error.code) : '';
  if (code === 'PGRST205' || code === '42P01') return true;

  const message = 'message' in error ? String(error.message).toLowerCase() : '';
  return message.includes('user_account_status') && (
    message.includes('could not find the table') ||
    message.includes('does not exist') ||
    message.includes('schema cache')
  );
}

export async function requireAdmin(): Promise<RequireAdminOk | RequireAdminFail> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const { data: role, error: roleError } = await supabase
    .from('user_roles' as never)
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'admin')
    .maybeSingle()
    .returns<{ role: string }>();

  if (roleError || !role) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  const { data: accountStatus, error: accountStatusError } = await supabase
    .from('user_account_status' as never)
    .select('account_status')
    .eq('user_id', user.id)
    .maybeSingle()
    .returns<{ account_status: string }>();

  if (accountStatus?.account_status === 'disabled') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  if (accountStatusError && !isMissingOptionalAdminStatusStoreError(accountStatusError)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { ok: true, userId: user.id };
}
