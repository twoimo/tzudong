import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { handleMarketingCampaignRequest } from '@/lib/privacy/marketing-campaigns';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 16_384;

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: NextRequest) {
  const initialAdmin = await requireAdmin();
  if (!initialAdmin.ok) {
    initialAdmin.response.headers.set('Cache-Control', 'no-store');
    return initialAdmin.response;
  }
  if (!isTrustedSameOriginMutation(request)) {
    return noStoreJson({ error: 'marketing_request_invalid', message: '요청 형식이 올바르지 않습니다.' }, { status: 403 });
  }

  const bodyResult = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
  if (!bodyResult.ok) {
    return noStoreJson({ error: 'marketing_request_invalid', message: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  return handleMarketingCampaignRequest(initialAdmin.userId, bodyResult.value);
}
