import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
  getE2EAdminRouteBypassExpectedToken,
  isE2EAdminRouteBypassEnvEnabled,
} from '@/lib/e2e-admin-route-bypass';
import { E2E_CLAIM_USER_ID_HEADER, isUuid, RESTAURANT_CLAIM_ERROR } from '@/lib/claim/contract';
import { createClient } from '@/lib/supabase/server';

type RequireClaimUserOk = { ok: true; userId: string };
type RequireClaimUserFail = { ok: false; response: NextResponse };

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

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: RESTAURANT_CLAIM_ERROR.unauthorized },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function getE2EClaimUserId() {
  if (!isE2EAdminRouteBypassEnvEnabled()) return null;
  const requestHeaders = await headers();
  const requestToken = requestHeaders.get(E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER)?.trim();
  const claimUserId = requestHeaders.get(E2E_CLAIM_USER_ID_HEADER)?.trim() ?? '';
  if (
    requestHeaders.get(E2E_ADMIN_ROUTE_BYPASS_HEADER) === '1'
    && requestToken === getE2EAdminRouteBypassExpectedToken()
    && isLocalPlaywrightHost(requestHeaders.get('host'))
    && isUuid(claimUserId)
  ) {
    return claimUserId;
  }
  return null;
}

export async function requireClaimUser(): Promise<RequireClaimUserOk | RequireClaimUserFail> {
  const e2eClaimUserId = await getE2EClaimUserId();
  if (e2eClaimUserId) return { ok: true, userId: e2eClaimUserId };

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id || !isUuid(user.id)) {
    return { ok: false, response: unauthorized() };
  }
  return { ok: true, userId: user.id };
}

export async function optionalClaimUserId(): Promise<string | null> {
  const e2eClaimUserId = await getE2EClaimUserId();
  if (e2eClaimUserId) return e2eClaimUserId;
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user?.id || !isUuid(user.id)) return null;
    return user.id;
  } catch {
    return null;
  }
}
