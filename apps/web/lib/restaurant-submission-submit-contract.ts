import type { RestaurantSubmissionFormData, RestaurantSubmissionMode } from "./restaurant-submission-flow";

export type RestaurantSubmissionSubmitMode = RestaurantSubmissionMode;

export type CanonicalRestaurantSubmissionPayload = {
  restaurant_name: string;
  address: string;
  phone: string | null;
  categories: string[];
  youtube_link: string | null;
  description: string;
};

export type ClientRequestKeyDecision = {
  previousKey: string | null;
  previousFingerprint: string | null;
  nextFingerprint: string;
};

export type ClientRequestKeyDecisionResult = {
  reuse: boolean;
  fingerprint: string;
};

export function normalizeRestaurantSubmissionPhone(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/[^\d+]/g, "");
}

function canonicalizeRestaurantSubmissionCategories(categories: string[]): string[] {
  return Array.from(new Set(
    categories
      .map((category) => category.trim())
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right, "ko"));
}

export function canonicalizeRestaurantSubmissionPayload(
  mode: RestaurantSubmissionSubmitMode,
  data: RestaurantSubmissionFormData,
): CanonicalRestaurantSubmissionPayload {
  return {
    restaurant_name: data.restaurant_name.trim(),
    address: data.address.trim(),
    phone: data.phone.trim() || null,
    categories: canonicalizeRestaurantSubmissionCategories(data.categories),
    youtube_link: mode === "request" ? data.youtube_link.trim() || null : data.youtube_link.trim(),
    description: data.description.trim(),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

export function getRestaurantSubmissionPayloadFingerprint(
  mode: RestaurantSubmissionSubmitMode,
  data: RestaurantSubmissionFormData,
): string {
  return stableStringify({
    mode,
    payload: canonicalizeRestaurantSubmissionPayload(mode, data),
  });
}

export function getClientRequestKeyDecision({
  previousKey,
  previousFingerprint,
  nextFingerprint,
}: ClientRequestKeyDecision): ClientRequestKeyDecisionResult {
  return {
    reuse: Boolean(previousKey && previousFingerprint === nextFingerprint),
    fingerprint: nextFingerprint,
  };
}

export function isValidClientRequestKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.trim());
}

export function restaurantSubmissionCoreMatches(
  expected: CanonicalRestaurantSubmissionPayload,
  actual: {
    restaurant_name?: string | null;
    restaurant_address?: string | null;
    restaurant_phone?: string | null;
    restaurant_categories?: string[] | null;
    origin_address?: string | null;
    phone?: string | null;
    categories?: string[] | null;
    recommendation_reason?: string | null;
    youtube_link?: string | null;
    tzuyang_review?: string | null;
  },
): boolean {
  const actualName = (actual.restaurant_name ?? "").trim();
  const actualAddress = (actual.restaurant_address ?? actual.origin_address ?? "").trim();
  const actualPhone = normalizeRestaurantSubmissionPhone(actual.restaurant_phone ?? actual.phone);
  const expectedPhone = normalizeRestaurantSubmissionPhone(expected.phone);
  const actualCategories = actual.restaurant_categories ?? actual.categories ?? [];

  return actualName === expected.restaurant_name
    && actualAddress === expected.address
    && (!expectedPhone || actualPhone === expectedPhone)
    && JSON.stringify(actualCategories) === JSON.stringify(expected.categories);
}

export function restaurantSubmissionRequestReadbackMatches(
  expected: CanonicalRestaurantSubmissionPayload,
  actual: {
    client_request_key?: string | null;
    status?: string | null;
    restaurant_name?: string | null;
    origin_address?: string | null;
    phone?: string | null;
    categories?: string[] | null;
    recommendation_reason?: string | null;
    youtube_link?: string | null;
  },
  clientRequestKey: string,
): boolean {
  return actual.client_request_key === clientRequestKey
    && actual.status === "pending"
    && restaurantSubmissionCoreMatches(expected, actual)
    && (actual.recommendation_reason ?? "").trim() === expected.description
    && ((actual.youtube_link ?? null) === expected.youtube_link);
}
