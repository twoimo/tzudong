import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import {
  hasExactKeys,
  isPlainObject,
  isUuid,
  MAX_CLAIM_REQUEST_BYTES,
  RESTAURANT_CLAIM_ERROR,
} from '@/lib/claim/contract';
import { claimErrorResponse, claimStatusForError, noStoreJson } from '@/lib/claim/http';
import { previewRestaurantClaimApproval } from '@/lib/claim/store';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }

  if (!isTrustedSameOriginMutation(request)) {
    return claimErrorResponse(RESTAURANT_CLAIM_ERROR.untrustedOrigin, 403);
  }

  const bounded = await readBoundedJsonRequest(request, MAX_CLAIM_REQUEST_BYTES);
  if (!bounded.ok) {
    return claimErrorResponse(RESTAURANT_CLAIM_ERROR.invalidRequest, 400);
  }
  if (!isPlainObject(bounded.value) || !hasExactKeys(bounded.value, ['claimId']) || !isUuid(bounded.value.claimId)) {
    return claimErrorResponse(RESTAURANT_CLAIM_ERROR.invalidRequest, 400);
  }

  const result = previewRestaurantClaimApproval({
    claimId: bounded.value.claimId,
    adminUserId: admin.userId,
  });
  if (!result.ok) return claimErrorResponse(result.error, claimStatusForError(result.error));
  return noStoreJson({
    ok: true,
    operationId: result.preview.operationId,
    previewHash: result.preview.previewHash,
    expiresAt: result.preview.expiresAt,
    requiredConfirmation: result.preview.requiredConfirmation,
    claimId: result.preview.claimId,
    restaurantId: result.preview.restaurantId,
  });
}
