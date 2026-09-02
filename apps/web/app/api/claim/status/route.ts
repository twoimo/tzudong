import { NextRequest } from 'next/server';

import { optionalClaimUserId } from '@/lib/claim/auth';
import { isUuid, RESTAURANT_CLAIM_ERROR } from '@/lib/claim/contract';
import { claimErrorResponse, noStoreJson } from '@/lib/claim/http';
import { readPublicClaimStatus } from '@/lib/claim/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const restaurantId = request.nextUrl.searchParams.get('restaurantId')?.trim() ?? '';
  if (!isUuid(restaurantId)) {
    return claimErrorResponse(RESTAURANT_CLAIM_ERROR.restaurantNotFound, 404);
  }

  const actorUserId = await optionalClaimUserId();
  const result = readPublicClaimStatus(restaurantId, actorUserId);
  if ('ok' in result && result.ok === false) {
    return claimErrorResponse(
      result.error,
      result.error === RESTAURANT_CLAIM_ERROR.restaurantNotFound ? 404 : 400,
    );
  }
  return noStoreJson({ ok: true, ...result });
}
