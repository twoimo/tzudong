import {
  ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT,
  ADMIN_MAP_OVERLAY_PREVIEW_TTL_MS,
  buildAdminMapOverlayPreviewHash,
  buildCanonicalJsonSha256,
  mapAdminMapOverlayRouteActionToRpcAction,
  normalizeAdminMapOverlayPreviewRequest,
  type AdminMapOverlayType,
  type AdminRestaurantMapOverlay,
  type NormalizedAdminMapOverlayPreviewRequest,
} from '@/lib/admin-map-overlays';
import type { Json } from '@/integrations/supabase/types';

export const TREND_PROPOSAL_STATUSES = ['pending', 'approved', 'rejected', 'superseded', 'expired'] as const;
export const TREND_PROPOSAL_REVIEW_TRANSITIONS = ['rejected', 'superseded', 'expired'] as const;
export const TREND_PROPOSAL_LIST_DEFAULT_LIMIT = 25;
export const TREND_PROPOSAL_LIST_MAX_LIMIT = 100;
export const TREND_PROPOSAL_REJECT_REASON_MIN_LENGTH = 3;
export const TREND_PROPOSAL_REJECT_REASON_MAX_LENGTH = 500;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OVERLAY_TYPES = ['trend', 'seasonal'] as const;

export type TrendProposalStatus = (typeof TREND_PROPOSAL_STATUSES)[number];
export type TrendProposalReviewTransition = (typeof TREND_PROPOSAL_REVIEW_TRANSITIONS)[number];

export type TrendProposalCursor = {
  createdAt: string;
  id: string;
};

export type TrendProposalListQuery = {
  status: TrendProposalStatus;
  overlayType: AdminMapOverlayType | null;
  restaurantId: string | null;
  runId: string | null;
  limit: number;
  cursor: TrendProposalCursor | null;
};

export type TrendProposalEvidenceSummary = {
  sourceTypes: string[];
  observationCount: number;
  freshness: string;
};

export type TrendProposalRestaurantReadback = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  status: string | null;
};

export type TrendProposalConflictReadback = {
  hasActiveOverlay: boolean;
  overlay: Pick<AdminRestaurantMapOverlay, 'restaurantId' | 'overlayType' | 'label' | 'isActive' | 'updatedAt'> | null;
};

export type TrendProposalListItem = {
  id: string;
  proposalStatus: TrendProposalStatus;
  restaurant: TrendProposalRestaurantReadback;
  overlayType: AdminMapOverlayType;
  label: string;
  description: string | null;
  activeFrom: string | null;
  activeUntil: string | null;
  score: number;
  scoreBreakdown: Json;
  evidenceSummary: TrendProposalEvidenceSummary;
  evidence: Json;
  proposalHash: string;
  createdAt: string;
  review: {
    reviewedByAdminId: string | null;
    reviewedAt: string | null;
    reviewReason: string | null;
    overlayAuditId: string | null;
  };
  conflict: TrendProposalConflictReadback;
};

export type TrendProposalPreviewEdits = {
  label?: string;
  description?: string | null;
  activeFrom?: string | null;
  activeUntil?: string | null;
};

export type TrendProposalPreviewRequest = {
  edits: TrendProposalPreviewEdits;
};

export type NormalizedTrendProposalReviewRequest = {
  transition: TrendProposalReviewTransition;
  reason: string;
  expectedProposalHash: string;
  correlationId: string;
  idempotencyKey: string;
};

export type TrendProposalReviewHashInput = NormalizedTrendProposalReviewRequest & {
  proposalId: string;
};

export type TrendProposalRowInput = {
  id: string;
  run_id: string;
  restaurant_id: string;
  overlay_type: AdminMapOverlayType;
  proposal_status: TrendProposalStatus;
  label: string;
  description: string | null;
  active_from: string | null;
  active_until: string | null;
  score: number;
  score_breakdown: Json;
  evidence: Json;
  proposal_hash: string;
  supersedes_proposal_id?: string | null;
  reviewed_by_admin_id: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  overlay_audit_id: string | null;
  created_at: string;
  updated_at?: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function isUuid(value: string | null): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

function isSha256(value: string | null): value is string {
  return Boolean(value && SHA256_PATTERN.test(value));
}

function readStatus(value: string | null): TrendProposalStatus {
  if (!value) return 'pending';
  if ((TREND_PROPOSAL_STATUSES as readonly string[]).includes(value)) return value as TrendProposalStatus;
  throw new Error('invalid_trend_proposal_status');
}

function readOverlayType(value: string | null): AdminMapOverlayType | null {
  if (!value) return null;
  if ((OVERLAY_TYPES as readonly string[]).includes(value)) return value as AdminMapOverlayType;
  throw new Error('invalid_trend_proposal_overlay_type');
}

function readUuidFilter(value: string | null, errorCode: string): string | null {
  if (!value) return null;
  if (!isUuid(value)) throw new Error(errorCode);
  return value;
}

function normalizeLimit(value: string | null): number {
  if (!value) return TREND_PROPOSAL_LIST_DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('invalid_trend_proposal_limit');
  return Math.min(parsed, TREND_PROPOSAL_LIST_MAX_LIMIT);
}

function normalizeOptionalTimestamp(value: unknown, errorCode: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(errorCode);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(errorCode);
  return parsed.toISOString();
}

function normalizeOptionalText(value: unknown, maxLength: number, errorCode: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = readString(value);
  if (normalized === null || normalized.length > maxLength) throw new Error(errorCode);
  return normalized.length > 0 ? normalized : null;
}

function normalizeReason(value: unknown): string {
  const normalized = readString(value);
  if (
    normalized === null ||
    normalized.length < TREND_PROPOSAL_REJECT_REASON_MIN_LENGTH ||
    normalized.length > TREND_PROPOSAL_REJECT_REASON_MAX_LENGTH
  ) {
    throw new Error('trend_proposal_review_reason_required');
  }
  return normalized;
}

function normalizeCursorTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid_trend_proposal_cursor');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('invalid_trend_proposal_cursor');
  return parsed.toISOString();
}

function parseTrendProposalCursor(value: string | null): TrendProposalCursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!isPlainRecord(decoded)) throw new Error('invalid-cursor');
    const createdAt = normalizeCursorTimestamp(decoded.createdAt);
    const id = readString(decoded.id);
    if (!isUuid(id)) throw new Error('invalid-cursor');
    return { createdAt, id };
  } catch {
    throw new Error('invalid_trend_proposal_cursor');
  }
}

export function encodeTrendProposalCursor(cursor: TrendProposalCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id }), 'utf8').toString('base64url');
}

export function parseTrendProposalListQuery(searchParams: URLSearchParams): TrendProposalListQuery {
  return {
    status: readStatus(searchParams.get('status')),
    overlayType: readOverlayType(searchParams.get('overlayType')),
    restaurantId: readUuidFilter(searchParams.get('restaurantId'), 'invalid_trend_proposal_restaurant_id'),
    runId: readUuidFilter(searchParams.get('runId'), 'invalid_trend_proposal_run_id'),
    limit: normalizeLimit(searchParams.get('limit')),
    cursor: parseTrendProposalCursor(searchParams.get('cursor')),
  };
}

export function normalizeTrendProposalPreviewRequest(body: unknown): TrendProposalPreviewRequest {
  const record = isPlainRecord(body) ? body : {};
  const editsRecord = isPlainRecord(record.edits) ? record.edits : {};
  const activeFrom = normalizeOptionalTimestamp(editsRecord.activeFrom ?? editsRecord.active_from, 'invalid_trend_proposal_preview_request');
  const activeUntil = normalizeOptionalTimestamp(editsRecord.activeUntil ?? editsRecord.active_until, 'invalid_trend_proposal_preview_request');
  if (activeFrom && activeUntil && new Date(activeFrom).getTime() > new Date(activeUntil).getTime()) {
    throw new Error('invalid_trend_proposal_preview_request');
  }

  return {
    edits: {
      label: normalizeOptionalText(editsRecord.label, 80, 'invalid_trend_proposal_preview_request') ?? undefined,
      description: normalizeOptionalText(editsRecord.description, 500, 'invalid_trend_proposal_preview_request'),
      activeFrom,
      activeUntil,
    },
  };
}

export function normalizeTrendProposalReviewRequest(body: unknown): NormalizedTrendProposalReviewRequest {
  if (!isPlainRecord(body)) throw new Error('invalid_trend_proposal_review_request');
  const transition = readString(body.transition);
  if (!transition || !(TREND_PROPOSAL_REVIEW_TRANSITIONS as readonly string[]).includes(transition)) {
    throw new Error('invalid_trend_proposal_review_request');
  }
  const expectedProposalHash = readString(body.expectedProposalHash ?? body.expected_proposal_hash);
  const correlationId = readString(body.correlationId ?? body.correlation_id);
  const idempotencyKey = readString(body.idempotencyKey ?? body.idempotency_key);
  if (!isSha256(expectedProposalHash) || !isUuid(correlationId)) {
    throw new Error('invalid_trend_proposal_review_request');
  }
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new Error('invalid_trend_proposal_review_request');
  }

  return {
    transition: transition as TrendProposalReviewTransition,
    reason: normalizeReason(body.reason),
    expectedProposalHash,
    correlationId,
    idempotencyKey,
  };
}

export function buildTrendProposalReviewRequestHash(input: TrendProposalReviewHashInput): string {
  return buildCanonicalJsonSha256({
    proposalId: input.proposalId,
    transition: input.transition,
    reason: input.reason,
    expectedProposalHash: input.expectedProposalHash,
    correlationId: input.correlationId,
  });
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []));
}

function readEvidenceRecord(evidence: Json): Record<string, unknown> {
  return isPlainRecord(evidence) ? evidence : {};
}

export function summarizeTrendProposalEvidence(evidence: Json): TrendProposalEvidenceSummary {
  const record = readEvidenceRecord(evidence);
  const observations = Array.isArray(record.observations) ? record.observations : [];
  const sourceTypes = new Set<string>([
    ...readStringArray(record.sourceTypes),
    ...readStringArray(record.source_types),
  ]);
  for (const observation of observations) {
    if (!isPlainRecord(observation)) continue;
    const sourceType = readString(observation.sourceType ?? observation.source_type);
    if (sourceType) sourceTypes.add(sourceType);
  }

  const observationIds = readStringArray(record.observationIds ?? record.observation_ids);
  const observationCount = typeof record.observationCount === 'number' && Number.isFinite(record.observationCount)
    ? Math.max(0, Math.trunc(record.observationCount))
    : observationIds.length || observations.length;
  const freshness = readString(record.freshness) ?? readString(record.freshnessStatus ?? record.freshness_status) ?? 'unknown';

  return {
    sourceTypes: [...sourceTypes].sort(),
    observationCount,
    freshness,
  };
}

function readNestedRecord(row: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = row[key];
  if (Array.isArray(value)) return isPlainRecord(value[0]) ? value[0] : null;
  return isPlainRecord(value) ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readRequiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function readOptionalString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

export function mapTrendProposalRow(
  row: Record<string, unknown>,
  conflict: TrendProposalConflictReadback = { hasActiveOverlay: false, overlay: null },
): TrendProposalListItem {
  const restaurant = readNestedRecord(row, 'restaurants');
  const evidence = (row.evidence ?? {}) as Json;
  const restaurantName =
    readOptionalString(restaurant ?? {}, 'approved_name') ??
    readOptionalString(restaurant ?? {}, 'name') ??
    '이름 확인 필요';

  return {
    id: readRequiredString(row, 'id'),
    proposalStatus: readRequiredString(row, 'proposal_status') as TrendProposalStatus,
    restaurant: {
      id: readRequiredString(row, 'restaurant_id'),
      name: restaurantName,
      lat: readNumber(restaurant?.lat),
      lng: readNumber(restaurant?.lng),
      status: readOptionalString(restaurant ?? {}, 'status'),
    },
    overlayType: readRequiredString(row, 'overlay_type') as AdminMapOverlayType,
    label: readRequiredString(row, 'label'),
    description: readOptionalString(row, 'description'),
    activeFrom: readOptionalString(row, 'active_from'),
    activeUntil: readOptionalString(row, 'active_until'),
    score: readNumber(row.score) ?? 0,
    scoreBreakdown: (row.score_breakdown ?? {}) as Json,
    evidenceSummary: summarizeTrendProposalEvidence(evidence),
    evidence,
    proposalHash: readRequiredString(row, 'proposal_hash'),
    createdAt: readRequiredString(row, 'created_at'),
    review: {
      reviewedByAdminId: readOptionalString(row, 'reviewed_by_admin_id'),
      reviewedAt: readOptionalString(row, 'reviewed_at'),
      reviewReason: readOptionalString(row, 'review_reason'),
      overlayAuditId: readOptionalString(row, 'overlay_audit_id'),
    },
    conflict,
  };
}

export function buildTrendProposalOverlayPreviewPayload(
  proposal: TrendProposalRowInput,
  edits: TrendProposalPreviewEdits = {},
): NormalizedAdminMapOverlayPreviewRequest {
  return normalizeAdminMapOverlayPreviewRequest({
    action: 'upsert',
    restaurantId: proposal.restaurant_id,
    overlayType: proposal.overlay_type,
    label: edits.label ?? proposal.label,
    description: edits.description !== undefined ? edits.description : proposal.description,
    activeFrom: edits.activeFrom !== undefined ? edits.activeFrom : proposal.active_from,
    activeUntil: edits.activeUntil !== undefined ? edits.activeUntil : proposal.active_until,
    evidence: {
      source: 'proposal',
      proposalId: proposal.id,
      runId: proposal.run_id,
      proposalHash: proposal.proposal_hash,
      score: proposal.score,
      scoreBreakdown: proposal.score_breakdown,
      evidence: proposal.evidence,
    },
    reason: '트렌드 제안 승인',
  });
}

export function buildTrendProposalPreviewHash(normalized: NormalizedAdminMapOverlayPreviewRequest): string {
  return buildAdminMapOverlayPreviewHash(normalized);
}

export function buildTrendProposalPreviewPayloadHash(input: {
  proposalId: string;
  normalized: NormalizedAdminMapOverlayPreviewRequest;
  previewHash: string;
}): string {
  const rpcAction = mapAdminMapOverlayRouteActionToRpcAction(input.normalized.action);
  return buildCanonicalJsonSha256({
    proposalId: input.proposalId,
    action: rpcAction,
    previewHash: input.previewHash,
    confirmationText: ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT,
    restaurantId: input.normalized.restaurantId,
    overlayType: input.normalized.overlayType,
    label: input.normalized.label,
    description: input.normalized.description,
    activeFrom: input.normalized.activeFrom,
    activeUntil: input.normalized.activeUntil,
    evidence: input.normalized.evidence,
    reason: input.normalized.reason,
  });
}

export function buildTrendProposalPreviewConfirmation(input: {
  proposalId: string;
  normalized: NormalizedAdminMapOverlayPreviewRequest;
}) {
  const previewHash = buildTrendProposalPreviewHash(input.normalized);
  return {
    requiredText: ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT,
    previewHash,
    payloadHash: buildTrendProposalPreviewPayloadHash({
      proposalId: input.proposalId,
      normalized: input.normalized,
      previewHash,
    }),
    expiresAt: new Date(Date.now() + ADMIN_MAP_OVERLAY_PREVIEW_TTL_MS).toISOString(),
  };
}
