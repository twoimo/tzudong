import { NextResponse } from 'next/server';

import {
  RESTAURANT_CLAIM_ERROR,
  type RestaurantClaimErrorCode,
} from '@/lib/claim/contract';

export function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export function claimErrorResponse(error: RestaurantClaimErrorCode, status: number) {
  return noStoreJson({ ok: false, error }, { status });
}

export function claimStatusForError(error: RestaurantClaimErrorCode) {
  if (error === RESTAURANT_CLAIM_ERROR.unauthorized) return 401;
  if (error === RESTAURANT_CLAIM_ERROR.forbidden || error === RESTAURANT_CLAIM_ERROR.untrustedOrigin) return 403;
  if (
    error === RESTAURANT_CLAIM_ERROR.duplicateClaimBlocked
    || error === RESTAURANT_CLAIM_ERROR.previewStale
    || error === RESTAURANT_CLAIM_ERROR.idempotencyConflict
    || error === RESTAURANT_CLAIM_ERROR.claimNotPending
    || error === RESTAURANT_CLAIM_ERROR.readbackFailed
  ) return 409;
  if (error === RESTAURANT_CLAIM_ERROR.claimNotFound || error === RESTAURANT_CLAIM_ERROR.restaurantNotFound) return 404;
  return 400;
}
