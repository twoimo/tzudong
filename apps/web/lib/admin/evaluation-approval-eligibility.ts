import { RESTAURANT_CATEGORIES } from '@/constants/categories';
import type { LocationMatchEvidenceFamily } from '@/types/evaluation';

export const APPROVAL_ELIGIBILITY_REASONS = [
  'INVALID_RAW_RECORD', 'DETAIL_REQUIRED', 'INPUT_LIMIT_EXCEEDED', 'STATUS_UNKNOWN',
  'STATUS_NOT_APPROVABLE', 'NOT_A_TARGET', 'DATABASE_OR_IDENTITY_CONFLICT',
  'NAME_REQUIRES_REVIEW', 'NAME_TOO_LONG', 'LOCATION_REQUIRES_REVIEW',
  'LOCATION_EVIDENCE_INCOMPLETE', 'LOCATION_IDENTITY_MISMATCH',
  'INDEPENDENT_LOCATION_EVIDENCE_REQUIRED', 'MISSING_EVALUATION', 'MISSING_BASIS',
  'EVALUATION_FAILED', 'CATEGORIES_INVALID', 'SOURCE_INCOMPLETE', 'CANONICAL_YOUTUBE_URL_REQUIRED',
] as const;
export type ApprovalEligibilityReason = typeof APPROVAL_ELIGIBILITY_REASONS[number];

export type ApprovalEligibility = {
  state: 'blocked' | 'unknown' | 'local_checks_passed';
  reasons: readonly ApprovalEligibilityReason[];
  requiresFinalServerValidation: true;
};

const METRICS = [
  ['visit_authenticity', 'number', true],
  ['rb_inference_score', 'number', true],
  ['rb_grounding_TF', 'boolean', true],
  ['review_faithfulness_score', 'number', true],
  ['category_validity_TF', 'boolean', false],
  ['category_TF', 'boolean', false],
] as const;
const INDEPENDENT_FAMILIES: ReadonlySet<LocationMatchEvidenceFamily> = new Set([
  'provider_candidate', 'source_geo', 'cross_provider', 'browser_verification', 'geocode_provider',
]);
const CATEGORIES: ReadonlySet<string> = new Set(RESTAURANT_CATEGORIES);
const BASIS_SENTINELS = new Set(['', '-', '근거 내용 없음', '평가 근거 없음', '평가근거없음']);
const KNOWN_STATUSES = new Set([
  'pending', 'hold', 'approved', 'rejected', 'deleted', 'missing', 'not_selected',
  'db_conflict', 'geocoding_failed', 'address_review_geocode_recovered',
]);
// These are local work budgets, not extra SQL rejection thresholds. Exceeding a
// budget returns unknown; the server still owns the actual approval decision.
const MAX_CHECKED_TEXT_LENGTH = 65_536;
const MAX_EVIDENCE_FAMILIES = 256;

function isObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// PostgreSQL btrim(text) removes U+0020 only. JS trim() would silently accept
// mismatches containing tabs, newlines or NBSP. No NFKC/branch/fuzzy matching.
function btrim(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 32) start++;
  while (end > start && value.charCodeAt(end - 1) === 32) end--;
  return value.slice(start, end);
}

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && btrim(value) !== '';
}

function optionalText(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function emptyObject(value: unknown): boolean {
  if (!isObject(value)) return false;
  for (const key in value) if (Object.hasOwn(value, key)) return false;
  return true;
}

function result(state: ApprovalEligibility['state'], reasons: readonly ApprovalEligibilityReason[]): ApprovalEligibility {
  return { state, reasons, requiresFinalServerValidation: true };
}

function unknown(reason: ApprovalEligibilityReason): ApprovalEligibility {
  return result('unknown', [reason]);
}

const UNKNOWN_REASONS: ReadonlySet<string> = new Set(['INVALID_RAW_RECORD', 'DETAIL_REQUIRED', 'INPUT_LIMIT_EXCEEDED', 'STATUS_UNKNOWN']);
const REASON_CODES: ReadonlySet<string> = new Set(APPROVAL_ELIGIBILITY_REASONS);

/** Strict transport DTO parser. This validates shape, not server authenticity. */
export function parseApprovalEligibility(value: unknown): ApprovalEligibility | null {
  try {
    if (!isObject(value) || Reflect.ownKeys(value).length !== 3
      || !['state', 'reasons', 'requiresFinalServerValidation'].every(key => Object.hasOwn(value, key))
      || value.requiresFinalServerValidation !== true
      || (value.state !== 'blocked' && value.state !== 'unknown' && value.state !== 'local_checks_passed')
      || !Array.isArray(value.reasons) || value.reasons.length > APPROVAL_ELIGIBILITY_REASONS.length
      || Array.from(value.reasons).some(reason => typeof reason !== 'string' || reason.length > 64 || !REASON_CODES.has(reason))
      || new Set(value.reasons).size !== value.reasons.length) return null;
    if (value.state === 'local_checks_passed' ? value.reasons.length !== 0
      : value.state === 'unknown' ? value.reasons.length !== 1 || !UNKNOWN_REASONS.has(value.reasons[0])
        : value.reasons.length === 0 || value.reasons.some(reason => UNKNOWN_REASONS.has(reason))) return null;
    return result(value.state, [...value.reasons] as ApprovalEligibilityReason[]);
  } catch {
    return null;
  }
}

/**
 * Use on a raw transport record, before any lossy parsing. A complete raw row
 * is always recomputed; only projections may carry an already validated DTO.
 * DTO validation is not authorization. The authenticated parent transport and
 * final guarded SQL retain their existing trust/approval boundaries.
 */
export function getRecordApprovalEligibility(raw: unknown): ApprovalEligibility {
  try {
    if (!isObject(raw)) return unknown('INVALID_RAW_RECORD');
    const attached = parseApprovalEligibility(raw.approval_eligibility);
    if (Object.hasOwn(raw, 'approval_eligibility') && !attached) return unknown('DETAIL_REQUIRED');
    if (Object.hasOwn(raw, 'read_summary') || ['evaluation_results', 'tzuyang_review', 'trace_id', 'db_error_details']
      .some(key => !Object.hasOwn(raw, key))) return attached ?? unknown('DETAIL_REQUIRED');
    return evaluateApprovalEligibility(raw);
  } catch {
    return unknown('INVALID_RAW_RECORD');
  }
}

function tooLong(value: unknown): boolean {
  return typeof value === 'string' && value.length > MAX_CHECKED_TEXT_LENGTH;
}

function exceedsNameLimit(value: string): boolean {
  // SQL length(text) counts Unicode code points, not UTF-16 code units.
  let length = 0;
  for (const unused of value) {
    void unused;
    if (++length > 160) return true;
  }
  return false;
}

/**
 * Pure, bounded preflight for a complete raw restaurants JSON row, BEFORE
 * normalization/summary projection. Missing raw-only fields require detail;
 * explicit DB nulls remain checkable. No private text is returned.
 *
 * Sources: 20261004190259_admin_record_guarded_actions.sql:421-431 and its
 * validate_restaurant; 20261003081915 classifier plus 20261004010334 identity
 * and 20261004045404 category wrappers. Manual composition resolves a blank
 * approved_name as approved -> origin -> naver -> google and classifies a COPY
 * with status=pending, updated_by_admin_id=NULL, created_by=NULL,
 * source_type=crawler. Thus ownership/source markers are deliberately ignored.
 * The compact Korean basis sentinel is additionally treated as unusable.
 *
 * local_checks_passed NEVER asserts approval or duplicate freedom: guarded SQL
 * must re-read/recompose/revalidate, including all database duplicate checks.
 * JS lowercasing is not a proof of PostgreSQL locale/collation equivalence.
 */
export function evaluateApprovalEligibility(raw: unknown): ApprovalEligibility {
  try {
    return evaluateRaw(raw);
  } catch {
    // Non-JSON objects/accessors must not throw or expose arbitrary diagnostics.
    return unknown('INVALID_RAW_RECORD');
  }
}

function evaluateRaw(raw: unknown): ApprovalEligibility {
  if (!isObject(raw)) return unknown('INVALID_RAW_RECORD');
  if (Object.hasOwn(raw, 'read_summary') || ['evaluation_results', 'tzuyang_review', 'trace_id', 'db_error_details']
    .some(key => !Object.hasOwn(raw, key))) return unknown('DETAIL_REQUIRED');
  if (typeof raw.status !== 'string' || raw.status.length > 64 || !KNOWN_STATUSES.has(raw.status)) return unknown('STATUS_UNKNOWN');

  const textFields = ['approved_name', 'origin_name', 'naver_name', 'google_name', 'jibun_address', 'tzuyang_review', 'trace_id', 'youtube_link'] as const;
  if (textFields.some(key => !optionalText(raw[key]))
    || ['is_missing', 'is_not_selected'].some(key => raw[key] != null && typeof raw[key] !== 'boolean')
    || (raw.evaluation_results != null && !isObject(raw.evaluation_results))) return unknown('INVALID_RAW_RECORD');
  if (textFields.some(key => tooLong(raw[key]))) return unknown('INPUT_LIMIT_EXCEEDED');

  const evaluation = isObject(raw.evaluation_results) ? raw.evaluation_results : {};
  const locationValue = evaluation.location_match_TF;
  if (locationValue != null && !isObject(locationValue)) return unknown('INVALID_RAW_RECORD');
  const location = isObject(locationValue) ? locationValue : {};
  if (['matched_name', 'origin_name'].some(key => !optionalText(location[key]))) return unknown('INVALID_RAW_RECORD');
  if (['matched_name', 'origin_name', 'pending_reason', 'falseMessage'].some(key => tooLong(location[key]))
    || METRICS.some(([key]) => isObject(evaluation[key]) && tooLong(evaluation[key].eval_basis))
    || (Array.isArray(location.evidence_families) && location.evidence_families.length > MAX_EVIDENCE_FAMILIES)) {
    return unknown('INPUT_LIMIT_EXCEEDED');
  }

  const reasons = new Set<ApprovalEligibilityReason>();
  const block = (reason: ApprovalEligibilityReason) => { reasons.add(reason); };
  if (raw.status !== 'pending' && raw.status !== 'hold') block('STATUS_NOT_APPROVABLE');
  if (raw.is_missing === true || raw.is_not_selected === true) block('NOT_A_TARGET');
  // SQL permits only absent/JSON null/{} details, NOT [], false, 0 or "".
  const details = raw.db_error_details;
  if ((raw.db_error_message != null && raw.db_error_message !== '')
    || (details != null && !emptyObject(details))) block('DATABASE_OR_IDENTITY_CONFLICT');

  const approved = nonblank(raw.approved_name) ? raw.approved_name : undefined;
  // Preserve untrimmed populated approved_name for the SQL length check; only
  // the fallback helper btrims its returned value.
  const candidate = approved ?? [raw.origin_name, raw.naver_name, raw.google_name].find(nonblank);
  const resolved = typeof candidate === 'string' ? btrim(candidate) : '';
  if (!resolved || !nonblank(raw.origin_name) || btrim(raw.origin_name).toLowerCase() !== resolved.toLowerCase()
    || [raw.naver_name, raw.google_name, location.matched_name]
      .some(name => nonblank(name) && btrim(name).toLowerCase() !== resolved.toLowerCase())) block('NAME_REQUIRES_REVIEW');
  if (exceedsNameLimit(approved ?? resolved)) block('NAME_TOO_LONG');

  if (raw.geocoding_success !== true
    || typeof raw.lat !== 'number' || !Number.isFinite(raw.lat) || raw.lat < -90 || raw.lat > 90
    || typeof raw.lng !== 'number' || !Number.isFinite(raw.lng) || raw.lng < -180 || raw.lng > 180
    || !nonblank(raw.jibun_address)) block('LOCATION_REQUIRES_REVIEW');

  if (location.eval_value !== true || location.match_status !== 'matched'
    // SQL nullif(text,'') does NOT trim or enumerate reasons. Unknown values,
    // whitespace, 0 and false remain blockers rather than normalizing away.
    || (location.pending_reason != null && location.pending_reason !== '')
    || (location.falseMessage != null && location.falseMessage !== '')
    || !Array.isArray(location.evidence_families)) block('LOCATION_EVIDENCE_INCOMPLETE');
  if (typeof location.origin_name !== 'string' || typeof raw.origin_name !== 'string'
    || btrim(location.origin_name).toLowerCase() !== btrim(raw.origin_name).toLowerCase()) block('LOCATION_IDENTITY_MISMATCH');
  const families = new Set<string>();
  if (Array.isArray(location.evidence_families)) {
    for (const family of location.evidence_families) {
      if (typeof family === 'string' && family.length <= 32
        && INDEPENDENT_FAMILIES.has(family as LocationMatchEvidenceFamily)) families.add(family);
    }
  }
  if (families.size < 2) block('INDEPENDENT_LOCATION_EVIDENCE_REQUIRED');

  for (const [key, valueType, basisRequired] of METRICS) {
    const metric = isObject(evaluation[key]) ? evaluation[key] : {};
    const value = metric.eval_value;
    const typed = valueType === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === 'boolean';
    if (!typed) block('MISSING_EVALUATION');
    else if (value !== (valueType === 'number' ? 1 : true)) block('EVALUATION_FAILED');
    if (basisRequired && (typeof metric.eval_basis !== 'string' || BASIS_SENTINELS.has(btrim(metric.eval_basis)))) block('MISSING_BASIS');
  }

  const categories = raw.categories;
  if (!Array.isArray(categories) || categories.length < 1 || categories.length > 15
    || categories.some(category => typeof category !== 'string' || category.length > 32 || !CATEGORIES.has(category))
    || new Set(categories).size !== categories.length) block('CATEGORIES_INVALID');
  if (!nonblank(raw.tzuyang_review) || !nonblank(raw.trace_id)) block('SOURCE_INCOMPLETE');
  // The existing youtube-url helper accepts shorts/IDs/extra params, unlike
  // guarded SQL. Require its exact stored watch URL, with optional www only.
  if (typeof raw.youtube_link !== 'string'
    || !/^https:\/\/(www\.)?youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(raw.youtube_link)) block('CANONICAL_YOUTUBE_URL_REQUIRED');

  return result(reasons.size ? 'blocked' : 'local_checks_passed', [...reasons]);
}
