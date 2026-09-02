import { randomUUID } from 'node:crypto';

import {
  MAX_LICENSE_BYTES,
  RESTAURANT_CLAIM_CONFIRMATION_TEXT,
  RESTAURANT_CLAIM_DISPLAY_NAME,
  RESTAURANT_CLAIM_DOCUMENT_KIND,
  RESTAURANT_CLAIM_ERROR,
  RESTAURANT_CLAIM_PREVIEW_TTL_MS,
  adminListItem,
  buildRestaurantClaimPreviewHash,
  evidenceHash,
  isClaimFileName,
  isClaimMimeType,
  isIdempotencyKey,
  isSha256,
  isUuid,
  publicStatusFor,
  type RestaurantClaimAdminListItem,
  type RestaurantClaimApplyReceipt,
  type RestaurantClaimAuditEvent,
  type RestaurantClaimCatalogEntry,
  type RestaurantClaimEvidence,
  type RestaurantClaimPreviewTicket,
  type RestaurantClaimPublicStatus,
  type RestaurantClaimReadback,
  type RestaurantClaimRecord,
} from '@/lib/claim/contract';

type ClaimLedger = {
  restaurants: Map<string, RestaurantClaimCatalogEntry>;
  claims: Map<string, RestaurantClaimRecord>;
  claimsByRestaurant: Map<string, string>;
  previews: Map<string, RestaurantClaimPreviewTicket>;
  audits: Map<string, RestaurantClaimAuditEvent>;
  applyReceiptsByIdempotency: Map<string, RestaurantClaimApplyReceipt>;
};

export type ClaimStoreFailure = {
  ok: false;
  error: (typeof RESTAURANT_CLAIM_ERROR)[keyof typeof RESTAURANT_CLAIM_ERROR];
};

function nowIso() {
  return new Date().toISOString();
}

function createLedger(): ClaimLedger {
  return {
    restaurants: new Map(),
    claims: new Map(),
    claimsByRestaurant: new Map(),
    previews: new Map(),
    audits: new Map(),
    applyReceiptsByIdempotency: new Map(),
  };
}

const GLOBAL_LEDGER_KEY = '__tzudongRestaurantClaimLedger';

type GlobalClaimLedger = typeof globalThis & {
  [GLOBAL_LEDGER_KEY]?: ClaimLedger;
};

function getLedger(): ClaimLedger {
  const holder = globalThis as GlobalClaimLedger;
  const existing = holder[GLOBAL_LEDGER_KEY];
  if (existing) return existing;
  const created = createLedger();
  holder[GLOBAL_LEDGER_KEY] = created;
  return created;
}

export function resetRestaurantClaimLedgerForTests() {
  (globalThis as GlobalClaimLedger)[GLOBAL_LEDGER_KEY] = createLedger();
}

function getOrCreateRestaurant(restaurantId: string): RestaurantClaimCatalogEntry {
  const existing = getLedger().restaurants.get(restaurantId);
  if (existing) return existing;
  const created: RestaurantClaimCatalogEntry = {
    restaurantId,
    restaurantName: RESTAURANT_CLAIM_DISPLAY_NAME,
    verifiedOwnerUserId: null,
    verifiedClaimId: null,
  };
  getLedger().restaurants.set(restaurantId, created);
  return created;
}

function activeClaimForRestaurant(restaurantId: string): RestaurantClaimRecord | null {
  const claimId = getLedger().claimsByRestaurant.get(restaurantId);
  if (!claimId) return null;
  return getLedger().claims.get(claimId) ?? null;
}

export function readPublicClaimStatus(
  restaurantId: string,
  _actorUserId: string | null,
): RestaurantClaimPublicStatus | ClaimStoreFailure {
  if (!isUuid(restaurantId)) return { ok: false, error: RESTAURANT_CLAIM_ERROR.restaurantNotFound };
  const restaurant = getOrCreateRestaurant(restaurantId);
  return publicStatusFor(restaurant, activeClaimForRestaurant(restaurantId));
}

export function startRestaurantClaim(input: {
  restaurantId: string;
  userId: string;
  idempotencyKey: string;
}): { ok: true; status: RestaurantClaimPublicStatus } | ClaimStoreFailure {
  if (!isUuid(input.restaurantId) || !isUuid(input.userId) || !isIdempotencyKey(input.idempotencyKey)) {
    return { ok: false, error: RESTAURANT_CLAIM_ERROR.invalidRequest };
  }

  const restaurant = getOrCreateRestaurant(input.restaurantId);
  const existing = activeClaimForRestaurant(input.restaurantId);
  if (existing) {
    if (existing.status === 'approved' || existing.claimantUserId !== input.userId) {
      return { ok: false, error: RESTAURANT_CLAIM_ERROR.duplicateClaimBlocked };
    }
    if (existing.idempotencyKey !== input.idempotencyKey) {
      return { ok: false, error: RESTAURANT_CLAIM_ERROR.idempotencyConflict };
    }
    return { ok: true, status: publicStatusFor(restaurant, existing) };
  }

  const timestamp = nowIso();
  const claim: RestaurantClaimRecord = {
    claimId: randomUUID(),
    restaurantId: input.restaurantId,
    claimantUserId: input.userId,
    status: 'started',
    idempotencyKey: input.idempotencyKey,
    evidence: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    approvedAt: null,
    approvedByAdminId: null,
  };
  getLedger().claims.set(claim.claimId, claim);
  getLedger().claimsByRestaurant.set(input.restaurantId, claim.claimId);
  return { ok: true, status: publicStatusFor(restaurant, claim) };
}

function parseEvidence(value: unknown): RestaurantClaimEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.documentKind !== RESTAURANT_CLAIM_DOCUMENT_KIND) return null;
  if (!isClaimFileName(record.fileName) || !isSha256(record.contentSha256) || !isClaimMimeType(record.mimeType)) {
    return null;
  }
  if (
    typeof record.byteLength !== 'number'
    || !Number.isInteger(record.byteLength)
    || record.byteLength < 1
    || record.byteLength > MAX_LICENSE_BYTES
  ) {
    return null;
  }
  return {
    documentKind: RESTAURANT_CLAIM_DOCUMENT_KIND,
    fileName: record.fileName,
    contentSha256: record.contentSha256,
    byteLength: record.byteLength,
    mimeType: record.mimeType,
  };
}

export function submitRestaurantClaimEvidence(input: {
  claimId: string;
  userId: string;
  evidence: unknown;
}): { ok: true; status: RestaurantClaimPublicStatus } | ClaimStoreFailure {
  if (!isUuid(input.claimId) || !isUuid(input.userId)) {
    return { ok: false, error: RESTAURANT_CLAIM_ERROR.invalidRequest };
  }
  const evidence = parseEvidence(input.evidence);
  if (!evidence) return { ok: false, error: RESTAURANT_CLAIM_ERROR.evidenceRequired };

  const claim = getLedger().claims.get(input.claimId);
  if (!claim) return { ok: false, error: RESTAURANT_CLAIM_ERROR.claimNotFound };
  if (claim.claimantUserId !== input.userId) return { ok: false, error: RESTAURANT_CLAIM_ERROR.forbidden };
  if (claim.status === 'approved') return { ok: false, error: RESTAURANT_CLAIM_ERROR.duplicateClaimBlocked };

  const restaurant = getOrCreateRestaurant(claim.restaurantId);
  if (claim.status === 'evidence_submitted' && claim.evidence) {
    const sameEvidence = evidenceHash(claim.evidence) === evidenceHash(evidence);
    return sameEvidence
      ? { ok: true, status: publicStatusFor(restaurant, claim) }
      : { ok: false, error: RESTAURANT_CLAIM_ERROR.idempotencyConflict };
  }

  const updated: RestaurantClaimRecord = {
    ...claim,
    status: 'evidence_submitted',
    evidence,
    updatedAt: nowIso(),
  };
  getLedger().claims.set(updated.claimId, updated);
  return { ok: true, status: publicStatusFor(restaurant, updated) };
}

export function listAdminRestaurantClaims(): RestaurantClaimAdminListItem[] {
  return [...getLedger().claims.values()]
    .filter((claim) => claim.status === 'evidence_submitted')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((claim) => adminListItem(getOrCreateRestaurant(claim.restaurantId), claim));
}

export function previewRestaurantClaimApproval(input: {
  claimId: string;
  adminUserId: string;
}): { ok: true; preview: RestaurantClaimPreviewTicket } | ClaimStoreFailure {
  if (!isUuid(input.claimId) || typeof input.adminUserId !== 'string' || input.adminUserId.length === 0) {
    return { ok: false, error: RESTAURANT_CLAIM_ERROR.invalidRequest };
  }
  const claim = getLedger().claims.get(input.claimId);
  if (!claim) return { ok: false, error: RESTAURANT_CLAIM_ERROR.claimNotFound };
  if (claim.status !== 'evidence_submitted' || !claim.evidence) {
    return { ok: false, error: RESTAURANT_CLAIM_ERROR.claimNotPending };
  }

  const hashedEvidence = evidenceHash(claim.evidence);
  const previewHash = buildRestaurantClaimPreviewHash({
    claimId: claim.claimId,
    restaurantId: claim.restaurantId,
    claimantUserId: claim.claimantUserId,
    evidenceHash: hashedEvidence,
    status: claim.status,
  });
  const preview: RestaurantClaimPreviewTicket = {
    operationId: randomUUID(),
    claimId: claim.claimId,
    restaurantId: claim.restaurantId,
    previewHash,
    evidenceHash: hashedEvidence,
    expiresAt: new Date(Date.now() + RESTAURANT_CLAIM_PREVIEW_TTL_MS).toISOString(),
    requiredConfirmation: RESTAURANT_CLAIM_CONFIRMATION_TEXT,
  };
  getLedger().previews.set(preview.operationId, preview);
  return { ok: true, preview };
}

function readbackFor(
  claim: RestaurantClaimRecord,
  restaurant: RestaurantClaimCatalogEntry,
): RestaurantClaimReadback {
  const checks = {
    claimApproved: claim.status === 'approved',
    ownerBound: claim.approvedByAdminId !== null && claim.approvedAt !== null,
    evidencePresent: claim.evidence !== null,
    restaurantOwnerMatches:
      restaurant.verifiedOwnerUserId === claim.claimantUserId
      && restaurant.verifiedClaimId === claim.claimId,
  };
  return {
    passed: checks.claimApproved && checks.ownerBound && checks.evidencePresent && checks.restaurantOwnerMatches,
    checks,
  };
}

export function applyRestaurantClaimApproval(input: {
  claimId: string;
  adminUserId: string;
  operationId: string;
  previewHash: string;
  confirmationText: string;
  idempotencyKey: string;
}): { ok: true; receipt: RestaurantClaimApplyReceipt } | ClaimStoreFailure {
  if (
    !isUuid(input.claimId)
    || !isUuid(input.operationId)
    || !isSha256(input.previewHash)
    || !isIdempotencyKey(input.idempotencyKey)
    || typeof input.adminUserId !== 'string'
    || input.adminUserId.length === 0
  ) {
    return { ok: false, error: RESTAURANT_CLAIM_ERROR.invalidRequest };
  }
  if (input.confirmationText !== RESTAURANT_CLAIM_CONFIRMATION_TEXT) {
    return { ok: false, error: RESTAURANT_CLAIM_ERROR.confirmationRequired };
  }

  const replayed = getLedger().applyReceiptsByIdempotency.get(input.idempotencyKey);
  if (replayed) {
    if (replayed.claimId !== input.claimId) {
      return { ok: false, error: RESTAURANT_CLAIM_ERROR.idempotencyConflict };
    }
    return { ok: true, receipt: { ...replayed, replayed: true } };
  }

  const ticket = getLedger().previews.get(input.operationId);
  if (
    !ticket
    || ticket.claimId !== input.claimId
    || ticket.previewHash !== input.previewHash
    || Date.parse(ticket.expiresAt) <= Date.now()
  ) {
    return { ok: false, error: RESTAURANT_CLAIM_ERROR.previewStale };
  }

  const claim = getLedger().claims.get(input.claimId);
  if (!claim) return { ok: false, error: RESTAURANT_CLAIM_ERROR.claimNotFound };
  if (claim.status !== 'evidence_submitted' || !claim.evidence) {
    return { ok: false, error: RESTAURANT_CLAIM_ERROR.claimNotPending };
  }
  if (evidenceHash(claim.evidence) !== ticket.evidenceHash) {
    return { ok: false, error: RESTAURANT_CLAIM_ERROR.previewStale };
  }

  const timestamp = nowIso();
  const approved: RestaurantClaimRecord = {
    ...claim,
    status: 'approved',
    updatedAt: timestamp,
    approvedAt: timestamp,
    approvedByAdminId: input.adminUserId,
  };
  const restaurant: RestaurantClaimCatalogEntry = {
    ...getOrCreateRestaurant(claim.restaurantId),
    verifiedOwnerUserId: claim.claimantUserId,
    verifiedClaimId: claim.claimId,
  };
  getLedger().claims.set(approved.claimId, approved);
  getLedger().restaurants.set(restaurant.restaurantId, restaurant);
  getLedger().previews.delete(input.operationId);

  const readback = readbackFor(approved, restaurant);
  if (!readback.passed) return { ok: false, error: RESTAURANT_CLAIM_ERROR.readbackFailed };

  const audit: RestaurantClaimAuditEvent = {
    auditId: randomUUID(),
    claimId: approved.claimId,
    restaurantId: approved.restaurantId,
    action: 'approve',
    actorAdminId: input.adminUserId,
    createdAt: timestamp,
  };
  getLedger().audits.set(audit.auditId, audit);

  const receipt: RestaurantClaimApplyReceipt = {
    claimId: approved.claimId,
    restaurantId: approved.restaurantId,
    ownerState: 'verified',
    replayed: false,
    auditId: audit.auditId,
    readback,
  };
  getLedger().applyReceiptsByIdempotency.set(input.idempotencyKey, receipt);
  return { ok: true, receipt };
}
