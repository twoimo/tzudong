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

  return { ok: true, userId: user.id };
}
