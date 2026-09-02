import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import {
  hasExactKeys,
  isIdempotencyKey,
  isPlainObject,
  isSha256,
  isUuid,
  MAX_CLAIM_REQUEST_BYTES,
  RESTAURANT_CLAIM_ERROR,
} from '@/lib/claim/contract';
import { claimErrorResponse, claimStatusForError, noStoreJson } from '@/lib/claim/http';
import { applyRestaurantClaimApproval } from '@/lib/claim/store';
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
  if (
    !isPlainObject(bounded.value)
    || !hasExactKeys(bounded.value, [
      'claimId',
      'operationId',
      'previewHash',
      'confirmationText',
      'idempotencyKey',
    ])
  ) {
    return claimErrorResponse(RESTAURANT_CLAIM_ERROR.invalidRequest, 400);
  }

  const claimId = bounded.value.claimId;
  const operationId = bounded.value.operationId;
  const previewHash = bounded.value.previewHash;
  const confirmationText = bounded.value.confirmationText;
  const idempotencyKey = bounded.value.idempotencyKey;
  if (
    !isUuid(claimId)
    || !isUuid(operationId)
    || !isSha256(previewHash)
    || typeof confirmationText !== 'string'
    || !isIdempotencyKey(idempotencyKey)
  ) {
    return claimErrorResponse(RESTAURANT_CLAIM_ERROR.invalidRequest, 400);
  }

  const result = applyRestaurantClaimApproval({
    claimId,
    adminUserId: admin.userId,
    operationId,
    previewHash,
    confirmationText,
    idempotencyKey,
  });
  if (!result.ok) return claimErrorResponse(result.error, claimStatusForError(result.error));
  return noStoreJson({
    ok: true,
    claimId: result.receipt.claimId,
    restaurantId: result.receipt.restaurantId,
    ownerState: result.receipt.ownerState,
    replayed: result.receipt.replayed,
    auditId: result.receipt.auditId,
    readback: result.receipt.readback,
  });
}
