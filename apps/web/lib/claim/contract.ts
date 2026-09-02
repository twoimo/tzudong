import { sha256Hex } from '@/lib/admin/sha256-hex';

export const RESTAURANT_CLAIM_AUDIT_SOURCE = 'restaurant_claim_audit';
export const RESTAURANT_CLAIM_AUDIT_DOMAIN = 'restaurant_claims';
export const RESTAURANT_CLAIM_CONFIRMATION_TEXT = '소유권 인증 승인';
export const RESTAURANT_CLAIM_DOCUMENT_KIND = 'business_license' as const;
export const RESTAURANT_CLAIM_PREVIEW_TTL_MS = 60_000;
export const RESTAURANT_CLAIM_DISPLAY_NAME = '쯔동 공개 맛집';
export const E2E_CLAIM_USER_ID_HEADER = 'x-e2e-claim-user-id';

export const RESTAURANT_CLAIM_ERROR = {
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  untrustedOrigin: 'untrusted_origin',
  invalidRequest: 'invalid_request',
  restaurantNotFound: 'restaurant_not_found',
  claimNotFound: 'claim_not_found',
  duplicateClaimBlocked: 'duplicate_claim_blocked',
  evidenceRequired: 'evidence_required',
  previewStale: 'preview_stale',
  confirmationRequired: 'confirmation_required',
  claimNotPending: 'claim_not_pending',
  idempotencyConflict: 'idempotency_conflict',
  readbackFailed: 'readback_failed',
} as const;

export type RestaurantClaimErrorCode =
  (typeof RESTAURANT_CLAIM_ERROR)[keyof typeof RESTAURANT_CLAIM_ERROR];

export const RESTAURANT_CLAIM_STATUSES = [
  'started',
  'evidence_submitted',
  'approved',
] as const;

export type RestaurantClaimStatus = (typeof RESTAURANT_CLAIM_STATUSES)[number];

export const RESTAURANT_CLAIM_OWNER_STATES = ['none', 'pending', 'verified'] as const;
export type RestaurantClaimOwnerState = (typeof RESTAURANT_CLAIM_OWNER_STATES)[number];

export const RESTAURANT_CLAIM_GUARD_STEPS = [
  'Preview',
  'Confirm',
  'Apply',
  'Readback',
  'Audit',
] as const;

export const RESTAURANT_CLAIM_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'application/pdf',
] as const;

export type RestaurantClaimMimeType = (typeof RESTAURANT_CLAIM_MIME_TYPES)[number];

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
export const FILE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export const MAX_CLAIM_REQUEST_BYTES = 4 * 1024;
export const MAX_LICENSE_BYTES = 5 * 1024 * 1024;

export type RestaurantClaimEvidence = {
  documentKind: typeof RESTAURANT_CLAIM_DOCUMENT_KIND;
  fileName: string;
  contentSha256: string;
  byteLength: number;
  mimeType: RestaurantClaimMimeType;
};

export type RestaurantClaimRecord = {
  claimId: string;
  restaurantId: string;
  claimantUserId: string;
  status: RestaurantClaimStatus;
  idempotencyKey: string;
  evidence: RestaurantClaimEvidence | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  approvedByAdminId: string | null;
};

export type RestaurantClaimCatalogEntry = {
  restaurantId: string;
  restaurantName: string;
  verifiedOwnerUserId: string | null;
  verifiedClaimId: string | null;
};

export type RestaurantClaimPublicStatus = {
  restaurantId: string;
  restaurantName: string;
  ownerState: RestaurantClaimOwnerState;
  claimId: string | null;
  canStart: boolean;
  duplicateBlocked: boolean;
};

export type RestaurantClaimAdminListItem = {
  claimId: string;
  restaurantId: string;
  restaurantName: string;
  status: RestaurantClaimStatus;
  evidenceKind: typeof RESTAURANT_CLAIM_DOCUMENT_KIND | null;
  createdAt: string;
};

export type RestaurantClaimPreviewTicket = {
  operationId: string;
  claimId: string;
  restaurantId: string;
  previewHash: string;
  evidenceHash: string;
  expiresAt: string;
  requiredConfirmation: typeof RESTAURANT_CLAIM_CONFIRMATION_TEXT;
};

export type RestaurantClaimReadback = {
  passed: boolean;
  checks: {
    claimApproved: boolean;
    ownerBound: boolean;
    evidencePresent: boolean;
    restaurantOwnerMatches: boolean;
  };
};

export type RestaurantClaimAuditEvent = {
  auditId: string;
  claimId: string;
  restaurantId: string;
  action: 'approve';
  actorAdminId: string;
  createdAt: string;
};

export type RestaurantClaimApplyReceipt = {
  claimId: string;
  restaurantId: string;
  ownerState: 'verified';
  replayed: boolean;
  auditId: string;
  readback: RestaurantClaimReadback;
};

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function isClaimFileName(value: unknown): value is string {
  return typeof value === 'string' && FILE_NAME_PATTERN.test(value) && !value.includes('..');
}

export function isClaimMimeType(value: unknown): value is RestaurantClaimMimeType {
  return typeof value === 'string'
    && (RESTAURANT_CLAIM_MIME_TYPES as readonly string[]).includes(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

export function ownerStateForClaim(
  restaurant: RestaurantClaimCatalogEntry,
  claim: RestaurantClaimRecord | null,
): RestaurantClaimOwnerState {
  if (restaurant.verifiedOwnerUserId && restaurant.verifiedClaimId) return 'verified';
  if (claim && claim.status !== 'approved') return 'pending';
  return 'none';
}

export function publicStatusFor(
  restaurant: RestaurantClaimCatalogEntry,
  claim: RestaurantClaimRecord | null,
): RestaurantClaimPublicStatus {
  const ownerState = ownerStateForClaim(restaurant, claim);
  return {
    restaurantId: restaurant.restaurantId,
    restaurantName: restaurant.restaurantName,
    ownerState,
    claimId: claim?.claimId ?? restaurant.verifiedClaimId,
    canStart: ownerState === 'none',
    duplicateBlocked: ownerState !== 'none',
  };
}

export function evidenceHash(evidence: RestaurantClaimEvidence) {
  return sha256Hex(JSON.stringify([
    evidence.documentKind,
    evidence.fileName,
    evidence.contentSha256,
    evidence.byteLength,
    evidence.mimeType,
  ]));
}

export function buildRestaurantClaimPreviewHash(input: {
  claimId: string;
  restaurantId: string;
  claimantUserId: string;
  evidenceHash: string;
  status: RestaurantClaimStatus;
}) {
  return sha256Hex(JSON.stringify([
    'restaurant-claim-preview-v1',
    input.claimId,
    input.restaurantId,
    input.claimantUserId,
    input.evidenceHash,
    input.status,
  ]));
}

export function adminListItem(
  restaurant: RestaurantClaimCatalogEntry,
  claim: RestaurantClaimRecord,
): RestaurantClaimAdminListItem {
  return {
    claimId: claim.claimId,
    restaurantId: claim.restaurantId,
    restaurantName: restaurant.restaurantName,
    status: claim.status,
    evidenceKind: claim.evidence?.documentKind ?? null,
    createdAt: claim.createdAt,
  };
}
