import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import {
  getDevAdminBypassCookieFromHeader,
  validateDevAdminBypassCookie,
} from '@/lib/auth/dev-admin-bypass-cookie';
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


function normalizeHostName(value: string) {
  const firstValue = value.split(',')[0]?.trim().toLowerCase() ?? '';

  if (firstValue.startsWith('[')) {
    const closingBracketIndex = firstValue.indexOf(']');
    return closingBracketIndex > 1 ? firstValue.slice(1, closingBracketIndex) : firstValue;
  }

  if (firstValue === '::1') return firstValue;
  if (firstValue.includes(':') && firstValue.split(':').length > 2) return firstValue;

  return firstValue.split(':')[0] ?? '';
}

function isLocalPlaywrightHost(value: string | null) {
  if (!value) return false;

  const normalizedHostName = normalizeHostName(value);
  return normalizedHostName === 'localhost' || normalizedHostName === '127.0.0.1' || normalizedHostName === '::1';
}

async function getE2EAdminApiBypassUserId(options: RequireAdminOptions = {}) {
  if (!isE2EAdminRouteBypassEnvEnabled()) return null;

  const requestHeaders = await headers();
  const requestToken = requestHeaders.get(E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER)?.trim();

  if (
    requestHeaders.get(E2E_ADMIN_ROUTE_BYPASS_HEADER) === '1' &&
    requestToken === getE2EAdminRouteBypassExpectedToken() &&
    isLocalPlaywrightHost(requestHeaders.get('host'))
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
