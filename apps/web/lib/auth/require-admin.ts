import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { checkAdminAccess } from '@/lib/auth/admin-access';
import {
  getDevAdminBypassCookieFromHeader,
  validateDevAdminBypassCookie,
} from '@/lib/auth/dev-admin-bypass-cookie';
import { isLoopbackHost } from '@/lib/auth/loopback-host';
import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
  getE2EAdminRouteBypassExpectedToken,
  isE2EAdminRouteBypassEnvEnabled,
} from '@/lib/e2e-admin-route-bypass';

type RequireAdminOk = {
  ok: true;
  userId: string;
};

type RequireAdminFail = {
  ok: false;
  response: NextResponse;
};

type RequireAdminOptions = {
  allowDevAdminBypassCookie?: boolean;
};


async function getE2EAdminApiBypassUserId(options: RequireAdminOptions = {}) {
  if (!isE2EAdminRouteBypassEnvEnabled()) return null;

  const requestHeaders = await headers();
  const requestToken = requestHeaders.get(E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER)?.trim();

  if (
    requestHeaders.get(E2E_ADMIN_ROUTE_BYPASS_HEADER) === '1' &&
    requestToken === getE2EAdminRouteBypassExpectedToken() &&
    isLoopbackHost(requestHeaders.get('host'))
  ) {
    return 'e2e-admin-route-bypass';
  }

  if (options.allowDevAdminBypassCookie) {
    const cookieValue = getDevAdminBypassCookieFromHeader(requestHeaders.get('cookie'));
    const validation = await validateDevAdminBypassCookie({
      cookieValue,
      host: requestHeaders.get('host'),
    });
    if (validation.ok) return 'dev-admin-thumbnail-bypass';
  }

  return null;
}


export async function requireAdmin(options: RequireAdminOptions = {}): Promise<RequireAdminOk | RequireAdminFail> {
  const e2eAdminUserId = await getE2EAdminApiBypassUserId(options);
  if (e2eAdminUserId) {
    return { ok: true, userId: e2eAdminUserId };
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  const adminAccess = await checkAdminAccess(supabase, user.id);

  if (adminAccess === 'inactive-session') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (adminAccess !== 'active-admin') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { ok: true, userId: user.id };
}
