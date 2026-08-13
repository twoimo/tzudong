import { NextRequest, NextResponse } from 'next/server';

import {
  mapAdminProfileSummaryRpcRows,
  parseAdminProfileSummaryRequest,
} from '@/lib/admin/profile-summaries';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PROFILE_SUMMARIES_REQUEST_BYTES = 8 * 1024;

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }

  if (!isTrustedSameOriginMutation(request)) {
    return noStoreJson(
      { code: 'ADMIN_PROFILE_SUMMARIES_FORBIDDEN', error: 'Forbidden' },
      { status: 403 },
    );
  }

  const requestBody = await readBoundedJsonRequest(request, MAX_PROFILE_SUMMARIES_REQUEST_BYTES);
  const userIds = requestBody.ok ? parseAdminProfileSummaryRequest(requestBody.value) : null;
  if (!userIds) {
    return noStoreJson(
      { code: 'ADMIN_PROFILE_SUMMARIES_INVALID_REQUEST', error: 'Invalid request' },
      { status: 400 },
    );
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.rpc(
      'read_admin_user_management_metadata',
      { p_user_ids: userIds },
    );
    if (error) throw new Error('admin-profile-summaries-rpc-failed');

    const rows = mapAdminProfileSummaryRpcRows(data, userIds);
    if (!rows) throw new Error('admin-profile-summaries-readback-invalid');

    return noStoreJson({ rows });
  } catch {
    console.error('[admin/profile-summaries] read failed');
    return noStoreJson(
      { code: 'ADMIN_PROFILE_SUMMARIES_UNAVAILABLE', error: 'Profile summaries unavailable' },
      { status: 502 },
    );
  }
}
