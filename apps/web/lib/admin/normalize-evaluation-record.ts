import type { DbConflictInfo, EvaluationRecord, EvaluationRecordStatus, RestaurantInfo } from '@/types/evaluation';
import { getAdminEvaluationDisplayName } from '@/lib/admin-evaluation-name';

export function isEvaluationRecordStatus(value: unknown): value is EvaluationRecordStatus {
  switch (value) {
    case 'pending':
    case 'approved':
    case 'rejected':
    case 'hold':
    case 'deleted':
    case 'missing':
    case 'db_conflict':
    case 'geocoding_failed':
    case 'address_review_geocode_recovered':
    case 'not_selected':
      return true;
    default:
      return false;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isNullableStringArray(value: unknown): value is string[] | null {
  return value === null || isStringArray(value);
}

export function isNullableRecord(value: unknown): value is Record<string, unknown> | null {
  return value === null || isRecord(value);
}

export type ParsedEvaluationResults = NonNullable<EvaluationRecord['evaluation_results']>;

export type ParsedLocationMatch = NonNullable<ParsedEvaluationResults['location_match_TF']>;

export type ParsedYoutubeMeta = NonNullable<EvaluationRecord['youtube_meta']>;

export function parseNumericEvaluationMetric(
  value: unknown,
): ParsedEvaluationResults['visit_authenticity'] {
  if (!isRecord(value) || typeof value.eval_value !== 'number') {
    return null;
  }

  return {
    name: typeof value.name === 'string' ? value.name : '',
    eval_value: value.eval_value,
    eval_basis: typeof value.eval_basis === 'string' ? value.eval_basis : '',
  };
}

export function parseBooleanEvaluationMetric(
  value: unknown,
): ParsedEvaluationResults['rb_grounding_TF'] {
  if (!isRecord(value) || typeof value.eval_value !== 'boolean') {
    return null;
  }

  return {
    name: typeof value.name === 'string' ? value.name : '',
    eval_value: value.eval_value,
    eval_basis: typeof value.eval_basis === 'string' ? value.eval_basis : '',
  };
}

export function parseCategoryEvaluationMetric(
  value: unknown,
): ParsedEvaluationResults['category_TF'] {
  if (
    !isRecord(value)
    || typeof value.eval_value !== 'boolean'
    || (value.category_revision !== undefined && !isNullableString(value.category_revision))
    || (value.eval_basis !== undefined && typeof value.eval_basis !== 'string')
  ) {
    return null;
  }

  return {
    name: typeof value.name === 'string' ? value.name : '',
    eval_value: value.eval_value,
    category_revision: typeof value.category_revision === 'string' || value.category_revision === null
      ? value.category_revision
      : null,
    ...(typeof value.eval_basis === 'string' ? { eval_basis: value.eval_basis } : {}),
  };
}

export function parseCategoryValidityEvaluationMetric(
  value: unknown,
): ParsedEvaluationResults['category_validity_TF'] {
  if (!isRecord(value) || typeof value.eval_value !== 'boolean') {
    return null;
  }

  return {
    name: typeof value.name === 'string' ? value.name : '',
    eval_value: value.eval_value,
  };
}

export function isLocationMatchEvidenceFamily(
  value: unknown,
): value is NonNullable<ParsedLocationMatch['evidence_families']>[number] {
  return value === 'provider_candidate'
    || value === 'source_geo'
    || value === 'cross_provider'
    || value === 'browser_verification'
    || value === 'llm_verification'
    || value === 'geocode_provider';
}

export function isLocationMatchPendingReason(
  value: unknown,
): value is NonNullable<ParsedLocationMatch['pending_reason']> {
  return value === 'insufficient_evidence'
    || value === 'cross_country_mismatch'
    || value === 'ambiguous_chain'
    || value === 'multi_candidate'
    || value === 'timeout'
    || value === 'rate_limited';
}

export function parseLocationMatchSecondPass(
  value: unknown,
): NonNullable<ParsedLocationMatch['second_pass']> | null {
  if (!isRecord(value)) return null;

  const parsedSecondPass: NonNullable<ParsedLocationMatch['second_pass']> = {};
  if (typeof value.attempted === 'boolean') parsedSecondPass.attempted = value.attempted;
  if (isNullableString(value.provider)) parsedSecondPass.provider = value.provider;
  if (typeof value.timed_out === 'boolean') parsedSecondPass.timed_out = value.timed_out;
  if (typeof value.rate_limited === 'boolean') parsedSecondPass.rate_limited = value.rate_limited;
  if (typeof value.duration_ms === 'number' || value.duration_ms === null) {
    parsedSecondPass.duration_ms = value.duration_ms;
  }
  return parsedSecondPass;
}

export function parseLocationMatchAddress(
  value: unknown,
): NonNullable<ParsedLocationMatch['matched_address']> | null {
  if (!isRecord(value)) return null;

  const parsedAddress: NonNullable<ParsedLocationMatch['matched_address']> = {};
  if (isNullableString(value.roadAddress)) parsedAddress.roadAddress = value.roadAddress;
  if (isNullableString(value.jibunAddress)) parsedAddress.jibunAddress = value.jibunAddress;
  if (isNullableString(value.englishAddress)) parsedAddress.englishAddress = value.englishAddress;
  if (isNullableString(value.x)) parsedAddress.x = value.x;
  if (isNullableString(value.y)) parsedAddress.y = value.y;
  return parsedAddress;
}

export function parseLocationMatchResult(value: unknown): ParsedEvaluationResults['location_match_TF'] {
  if (!isRecord(value)) return null;

  const parsedResult: ParsedLocationMatch = {};
  if (typeof value.name === 'string') parsedResult.name = value.name;
  if (typeof value.eval_value === 'boolean') parsedResult.eval_value = value.eval_value;
  if (isNullableString(value.origin_name)) parsedResult.origin_name = value.origin_name;
  if (
    value.match_status === 'matched'
    || value.match_status === 'pending'
    || value.match_status === 'failed'
  ) {
    parsedResult.match_status = value.match_status;
  }
  if (
    value.matched_provider === 'naver'
    || value.matched_provider === 'google'
    || value.matched_provider === 'playwright'
    || value.matched_provider === 'gemini'
    || value.matched_provider === 'ncp_geocode'
    || value.matched_provider === null
  ) {
    parsedResult.matched_provider = value.matched_provider;
  }
  if (isNullableString(value.matched_name)) parsedResult.matched_name = value.matched_name;
  if (isNullableString(value.naver_name)) parsedResult.naver_name = value.naver_name;
  if (isNullableString(value.google_name)) parsedResult.google_name = value.google_name;
  if (typeof value.origin_address === 'string') parsedResult.origin_address = value.origin_address;
  if (value.matched_address === null) {
    parsedResult.matched_address = null;
  } else {
    const matchedAddress = parseLocationMatchAddress(value.matched_address);
    if (matchedAddress) parsedResult.matched_address = matchedAddress;
  }
  if (value.naver_address === null) {
    parsedResult.naver_address = null;
  } else if (Array.isArray(value.naver_address) && value.naver_address.every(isRecord)) {
    parsedResult.naver_address = value.naver_address;
  }
  if (isStringArray(value.evidence_summary)) {
    parsedResult.evidence_summary = value.evidence_summary;
  }
  const evidenceFamilies = value.evidence_families;
  if (
    Array.isArray(evidenceFamilies)
    && evidenceFamilies.every(isLocationMatchEvidenceFamily)
  ) {
    parsedResult.evidence_families = evidenceFamilies;
  }
  if (value.pending_reason === null) {
    parsedResult.pending_reason = null;
  } else if (isLocationMatchPendingReason(value.pending_reason)) {
    parsedResult.pending_reason = value.pending_reason;
  }
  if (value.second_pass === null) {
    parsedResult.second_pass = null;
  } else {
    const secondPass = parseLocationMatchSecondPass(value.second_pass);
    if (secondPass) parsedResult.second_pass = secondPass;
  }
  if (isNullableString(value.falseMessage)) parsedResult.falseMessage = value.falseMessage;

  return parsedResult;
}

export function parseEvaluationResults(value: unknown): EvaluationRecord['evaluation_results'] {
  if (!isRecord(value)) return null;

  return {
    visit_authenticity: parseNumericEvaluationMetric(value.visit_authenticity),
    rb_inference_score: parseNumericEvaluationMetric(value.rb_inference_score),
    rb_grounding_TF: parseBooleanEvaluationMetric(value.rb_grounding_TF),
    review_faithfulness_score: parseNumericEvaluationMetric(value.review_faithfulness_score),
    category_TF: parseCategoryEvaluationMetric(value.category_TF),
    category_validity_TF: parseCategoryValidityEvaluationMetric(value.category_validity_TF),
    location_match_TF: parseLocationMatchResult(value.location_match_TF),
  };
}

export function parseYoutubeMeta(value: unknown): EvaluationRecord['youtube_meta'] {
  if (!isRecord(value) || !isRecord(value.ads_info)) return null;
  if (
    typeof value.title !== 'string'
    || typeof value.publishedAt !== 'string'
    || typeof value.is_shorts !== 'boolean'
    || typeof value.duration !== 'number'
    || typeof value.ads_info.is_ads !== 'boolean'
    || !isNullableString(value.ads_info.what_ads)
  ) {
    return null;
  }

  const parsedMeta: ParsedYoutubeMeta = {
    title: value.title,
    publishedAt: value.publishedAt,
    is_shorts: value.is_shorts,
    duration: value.duration,
    ads_info: {
      is_ads: value.ads_info.is_ads,
      what_ads: value.ads_info.what_ads,
    },
  };
  return parsedMeta;
}

export type ParsedDbErrorDetails = NonNullable<EvaluationRecord['db_error_details']>;

export type ParsedAddressConsistencyReview =
  NonNullable<ParsedDbErrorDetails['address_consistency_review']>;

export function parseDbErrorDetails(value: unknown): EvaluationRecord['db_error_details'] {
  if (!isRecord(value)) return null;

  const parsedDetails: ParsedDbErrorDetails = {};
  if (value.error_type === 'duplicate') parsedDetails.error_type = 'duplicate';

  const addressReviewValue = value.address_consistency_review;
  if (isRecord(addressReviewValue)) {
    const addressReview: ParsedAddressConsistencyReview = {};
    if (typeof addressReviewValue.queue === 'string') {
      addressReview.queue = addressReviewValue.queue;
    }
    if (typeof addressReviewValue.reason_ko === 'string') {
      addressReview.reason_ko = addressReviewValue.reason_ko;
    }
    if (typeof addressReviewValue.generated_at === 'string') {
      addressReview.generated_at = addressReviewValue.generated_at;
    }
    if (typeof addressReviewValue.validation_source === 'string') {
      addressReview.validation_source = addressReviewValue.validation_source;
    }
    if (isNullableRecord(addressReviewValue.geocode_top)) {
      addressReview.geocode_top = addressReviewValue.geocode_top;
    }
    if (typeof addressReviewValue.ahp_score === 'number') {
      addressReview.ahp_score = addressReviewValue.ahp_score;
    }
    if (typeof addressReviewValue.ahp_label === 'string') {
      addressReview.ahp_label = addressReviewValue.ahp_label;
    }
    if (typeof addressReviewValue.top_failing_criterion === 'string') {
      addressReview.top_failing_criterion = addressReviewValue.top_failing_criterion;
    }
    if (isStringArray(addressReviewValue.evidence_families)) {
      addressReview.evidence_families = addressReviewValue.evidence_families;
    }
    if (typeof addressReviewValue.suggested_action === 'string') {
      addressReview.suggested_action = addressReviewValue.suggested_action;
    }
    if (Object.keys(addressReview).length > 0) {
      parsedDetails.address_consistency_review = addressReview;
    }
  }

  const conflictingRestaurantValue = value.conflicting_restaurant;
  if (
    isRecord(conflictingRestaurantValue)
    && typeof conflictingRestaurantValue.id === 'string'
    && typeof conflictingRestaurantValue.name === 'string'
    && typeof conflictingRestaurantValue.jibun_address === 'string'
    && (
      conflictingRestaurantValue.road_address === undefined
      || typeof conflictingRestaurantValue.road_address === 'string'
    )
  ) {
    parsedDetails.conflicting_restaurant = {
      id: conflictingRestaurantValue.id,
      name: conflictingRestaurantValue.name,
      jibun_address: conflictingRestaurantValue.jibun_address,
      ...(typeof conflictingRestaurantValue.road_address === 'string'
        ? { road_address: conflictingRestaurantValue.road_address }
        : {}),
    };
  }
  if (typeof value.similarity_score === 'number') {
    parsedDetails.similarity_score = value.similarity_score;
  }
  if (typeof value.detected_at === 'string') {
    parsedDetails.detected_at = value.detected_at;
  }

  return Object.keys(parsedDetails).length > 0 ? parsedDetails : null;
}

export function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function getNullableString(value: unknown): string | null {
  return isNullableString(value) ? value : null;
}

export function getNullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

const CONFLICT_RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Preserve the legacy conflict DTO; never invent a mutation target from display text. */
export function parseDbConflictInfo(value: unknown): DbConflictInfo | null {
  if (!isRecord(value) || !isRecord(value.existing_restaurant) || !isRecord(value.new_restaurant)) return null;
  const existing = value.existing_restaurant, incoming = value.new_restaurant;
  if (typeof existing.id !== 'string' || !CONFLICT_RECORD_ID.test(existing.id)
    || typeof existing.name !== 'string' || typeof existing.jibun_address !== 'string'
    || !isNullableString(existing.phone) || !isStringArray(existing.category)
    || !isStringArray(existing.youtube_links) || typeof existing.created_at !== 'string'
    || !Number.isFinite(Date.parse(existing.created_at))) return null;
  if (typeof incoming.name !== 'string' || !isNullableString(incoming.phone)
    || typeof incoming.category !== 'string' || typeof incoming.origin_address !== 'string'
    || typeof incoming.origin_lat !== 'number' || !Number.isFinite(incoming.origin_lat)
    || typeof incoming.origin_lng !== 'number' || !Number.isFinite(incoming.origin_lng)
    || typeof incoming.reasoning_basis !== 'string' || typeof incoming.tzuyang_review !== 'string') return null;
  const address = incoming.naver_address_info;
  if (address !== null && (!isRecord(address) || !isNullableString(address.road_address)
    || typeof address.jibun_address !== 'string' || !isNullableString(address.english_address)
    || !isRecord(address.address_elements) || typeof address.x !== 'string' || typeof address.y !== 'string')) return null;
  const restaurant: RestaurantInfo = {
    name: incoming.name, phone: incoming.phone, category: incoming.category,
    origin_address: incoming.origin_address, origin_lat: incoming.origin_lat, origin_lng: incoming.origin_lng,
    reasoning_basis: incoming.reasoning_basis, tzuyang_review: incoming.tzuyang_review,
    naver_address_info: address === null ? null : {
      road_address: address.road_address as string | null, jibun_address: address.jibun_address as string,
      english_address: address.english_address as string | null, address_elements: address.address_elements as Record<string, unknown>,
      x: address.x as string, y: address.y as string,
    },
  };
  return { existing_restaurant: { id: existing.id, name: existing.name, jibun_address: existing.jibun_address,
    phone: existing.phone, category: [...existing.category], youtube_links: [...existing.youtube_links], created_at: existing.created_at },
    new_restaurant: restaurant };
}

export function getEvaluationConflictTargetId(record: EvaluationRecord): string | null {
  const id = record.db_conflict_info?.existing_restaurant.id ?? record.db_error_details?.conflicting_restaurant?.id;
  return typeof id === 'string' && CONFLICT_RECORD_ID.test(id) && id !== record.id ? id : null;
}

/** The target must come from a fresh detail GET; a paged summary cannot establish a merge preview. */
export function buildEvaluationConflictInfo(source: EvaluationRecord, target: EvaluationRecord): DbConflictInfo | null {
  if (getEvaluationConflictTargetId(source) !== target.id || target.read_summary || target.status === 'deleted'
    || !Number.isFinite(Date.parse(target.updated_at)) || !source.restaurant_info) return null;
  return {
    existing_restaurant: { id: target.id, name: target.restaurant_name || target.name,
      jibun_address: target.jibun_address || target.road_address || '', phone: target.phone,
      category: [...(target.categories ?? [])], youtube_links: [...(target.youtube_links ?? (target.youtube_link ? [target.youtube_link] : []))],
      created_at: target.created_at },
    new_restaurant: source.db_conflict_info?.new_restaurant ?? source.restaurant_info,
  };
}

export function normalizeEvaluationRecord(value: unknown): EvaluationRecord | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;

  const status = isEvaluationRecordStatus(value.status) ? value.status : 'pending';
  const name = getString(value.name);
  const roadAddress = getNullableString(value.road_address);
  const jibunAddress = getNullableString(value.jibun_address);
  const englishAddress = getNullableString(value.english_address);
  const addressElements = isRecord(value.address_elements) ? value.address_elements : {};
  const originAddress = isRecord(value.origin_address) ? value.origin_address : {};
  const youtubeLink = getString(value.youtube_link);
  const categories = isNullableStringArray(value.categories) ? value.categories : null;
  const youtubeLinks = isNullableStringArray(value.youtube_links)
    ? value.youtube_links
    : (youtubeLink ? [youtubeLink] : null);

  const conflict = parseDbConflictInfo(value.db_conflict_info);

  return {
    ...(conflict && conflict.existing_restaurant.id !== value.id ? { db_conflict_info: conflict } : {}),
    ...(parseEvaluationReadSummary(value.read_summary) ? { read_summary: parseEvaluationReadSummary(value.read_summary)! } : {}),
    id: value.id,
    name,
    phone: getNullableString(value.phone),
    categories,
    lat: getNullableNumber(value.lat),
    lng: getNullableNumber(value.lng),
    road_address: roadAddress,
    jibun_address: jibunAddress,
    english_address: englishAddress,
    address_elements: addressElements,
    origin_address: originAddress,
    youtube_links: youtubeLinks,
    youtube_meta: parseYoutubeMeta(value.youtube_meta),
    unique_id: getNullableString(value.unique_id ?? value.trace_id),
    tzuyang_reviews: Array.isArray(value.tzuyang_reviews)
      ? value.tzuyang_reviews.filter(isRecord)
      : [],
    reasoning_basis: getNullableString(value.reasoning_basis),
    evaluation_results: parseEvaluationResults(value.evaluation_results),
    source_type: getNullableString(value.source_type),
    geocoding_success: value.geocoding_success === true,
    geocoding_false_stage: getNullableNumber(value.geocoding_false_stage),
    status,
    is_missing: value.is_missing === true,
    is_not_selected: value.is_not_selected === true,
    review_count: typeof value.review_count === 'number' ? value.review_count : 0,
    created_by: getNullableString(value.created_by),
    updated_by_admin_id: getNullableString(value.updated_by_admin_id),
    db_error_details: parseDbErrorDetails(value.db_error_details),
    created_at: getString(value.created_at),
    updated_at: getString(value.updated_at),
    restaurant_name: typeof value.restaurant_name === 'string'
      ? value.restaurant_name
      : undefined,
    youtube_link: youtubeLink,
    restaurant_info: {
      name,
      phone: getNullableString(value.phone),
      category: categories?.[0] ?? '',
      origin_address: getString(originAddress.address) || roadAddress || jibunAddress || '',
      origin_lat: typeof originAddress.lat === 'number'
        ? originAddress.lat
        : (typeof value.lat === 'number' ? value.lat : 0),
      origin_lng: typeof originAddress.lng === 'number'
        ? originAddress.lng
        : (typeof value.lng === 'number' ? value.lng : 0),
      reasoning_basis: getString(value.reasoning_basis),
      tzuyang_review: getString(value.tzuyang_review),
      naver_address_info: roadAddress || jibunAddress
        ? {
            road_address: roadAddress,
            jibun_address: jibunAddress || '',
            english_address: englishAddress,
            address_elements: addressElements,
            x: typeof value.lng === 'number' ? value.lng.toString() : '',
            y: typeof value.lat === 'number' ? value.lat.toString() : '',
          }
        : null,
    },
    ...(isNullableString(value.geocoding_fail_reason)
      ? { geocoding_fail_reason: value.geocoding_fail_reason }
      : {}),
    ...(isNullableString(value.db_error_message)
      ? { db_error_message: value.db_error_message }
      : {}),
    ...(isNullableString(value.missing_message)
      ? { missing_message: value.missing_message }
      : {}),
    ...(isNullableString(value.approved_name)
      ? { approved_name: value.approved_name }
      : {}),
    ...(isNullableString(value.origin_name)
      ? { origin_name: value.origin_name }
      : {}),
    ...(isNullableString(value.naver_name)
      ? { naver_name: value.naver_name }
      : {}),
    ...(isNullableString(value.google_name)
      ? { google_name: value.google_name }
      : {}),
    ...(isNullableString(value.trace_id)
      ? { trace_id: value.trace_id }
      : {}),
    ...(isNullableString(value.trace_id_name_source)
      ? { trace_id_name_source: value.trace_id_name_source }
      : {}),
    ...(isNullableString(value.channel_name)
      ? { channel_name: value.channel_name }
      : {}),
    ...(isNullableString(value.description_map_url)
      ? { description_map_url: value.description_map_url }
      : {}),
    ...(isNullableRecord(value.recollect_version)
      ? { recollect_version: value.recollect_version }
      : {}),
  };
}

export function parseEvaluationReadSummary(value: unknown): EvaluationRecord['read_summary'] | null {
  if (!isRecord(value) || !Array.isArray(value.evaluation_issues) || value.evaluation_issues.length > 6) return null;
  const statuses = ['true', 'false', 'failed', 'review', 'candidate', 'not_applicable', 'unknown'];
  const keys = ['visit_authenticity', 'rb_inference_score', 'rb_grounding_TF', 'review_faithfulness_score', 'category_validity_TF', 'category_TF'];
  if (typeof value.address_consistency !== 'string' || !statuses.includes(value.address_consistency)) return null;
  if (value.evaluation_issues.some(issue => !isRecord(issue) || !keys.includes(String(issue.key)) || typeof issue.label !== 'string' || typeof issue.missingValue !== 'boolean' || typeof issue.missingBasis !== 'boolean')) return null;
  return value as unknown as NonNullable<EvaluationRecord['read_summary']>;
}

export function withAdminEvaluationDisplayName(record: EvaluationRecord): EvaluationRecord {
  const displayName = getAdminEvaluationDisplayName({
    approved_name: record.approved_name,
    restaurant_name: record.restaurant_name,
    name: record.name,
    origin_name: record.origin_name,
    naver_name: record.naver_name,
    evaluation_results: record.evaluation_results,
  });

  return {
    ...record,
    name: displayName,
    restaurant_name: displayName,
    restaurant_info: record.restaurant_info
      ? { ...record.restaurant_info, name: displayName }
      : record.restaurant_info,
  };
}
