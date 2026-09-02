import { NextRequest } from 'next/server';

import { requireClaimUser } from '@/lib/claim/auth';
import {
  hasExactKeys,
  isIdempotencyKey,
  isPlainObject,
  isUuid,
  MAX_CLAIM_REQUEST_BYTES,
  RESTAURANT_CLAIM_ERROR,
} from '@/lib/claim/contract';
import { claimErrorResponse, claimStatusForError, noStoreJson } from '@/lib/claim/http';
import { startRestaurantClaim } from '@/lib/claim/store';
import { PrivacyUnsafeValueError, assertPrivacySafe } from '@/lib/privacy/sanitize';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireClaimUser();
  if (!auth.ok) return auth.response;

  if (!isTrustedSameOriginMutation(request)) {
    return claimErrorResponse(RESTAURANT_CLAIM_ERROR.untrustedOrigin, 403);
  }

  const bounded = await readBoundedJsonRequest(request, MAX_CLAIM_REQUEST_BYTES);
  if (!bounded.ok) {
    return claimErrorResponse(RESTAURANT_CLAIM_ERROR.invalidRequest, 400);
  }
  if (!isPlainObject(bounded.value) || !hasExactKeys(bounded.value, ['restaurantId', 'idempotencyKey'])) {
    return claimErrorResponse(RESTAURANT_CLAIM_ERROR.invalidRequest, 400);
  }
  const restaurantId = bounded.value.restaurantId;
  const idempotencyKey = bounded.value.idempotencyKey;
  if (!isUuid(restaurantId) || !isIdempotencyKey(idempotencyKey)) {
    return claimErrorResponse(RESTAURANT_CLAIM_ERROR.invalidRequest, 400);
  }

  try {
    assertPrivacySafe({ restaurantId, idempotencyKey });
  } catch (error) {
    if (error instanceof PrivacyUnsafeValueError) {
      return claimErrorResponse(RESTAURANT_CLAIM_ERROR.invalidRequest, 400);
    }
    return claimErrorResponse(RESTAURANT_CLAIM_ERROR.invalidRequest, 400);
  }

  const result = startRestaurantClaim({
    restaurantId,
    userId: auth.userId,
    idempotencyKey,
  });
  if (!result.ok) return claimErrorResponse(result.error, claimStatusForError(result.error));
  return noStoreJson({ ok: true, ...result.status });
}
