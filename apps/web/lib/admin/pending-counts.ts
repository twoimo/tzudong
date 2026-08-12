export const ADMIN_PENDING_COUNT_DOMAIN_IDS = [
  "restaurant_submissions",
  "restaurant_recommendation_requests",
  "reviews",
] as const;

export const ADMIN_PENDING_COUNTS_QUERY_KEY = ["admin", "pending-counts"] as const;

export type AdminPendingCountDomainId = (typeof ADMIN_PENDING_COUNT_DOMAIN_IDS)[number];
export type AdminPendingCountReadinessStatus = "ready" | "degraded";

export const RESTAURANT_REQUESTS_LIFECYCLE_MISSING_REASON =
  "restaurant_requests_lifecycle_missing" as const;

export const RESTAURANT_REQUESTS_LIFECYCLE_COLUMNS = [
  "status",
  "reviewed_by_admin_id",
  "reviewed_at",
  "admin_note",
  "rejection_reason",
  "review_audit_id",
  "updated_at",
] as const;

export type AdminPendingCountDomain = {
  id: AdminPendingCountDomainId;
  count: number;
  ready: boolean;
  status: AdminPendingCountReadinessStatus;
  reason?: typeof RESTAURANT_REQUESTS_LIFECYCLE_MISSING_REASON;
  remediation?: string;
};

export type AdminPendingCountsDiagnostics = {
  restaurantRequestsLifecycle?: {
    reason: typeof RESTAURANT_REQUESTS_LIFECYCLE_MISSING_REASON;
    table: "restaurant_requests";
    columns: readonly (typeof RESTAURANT_REQUESTS_LIFECYCLE_COLUMNS)[number][];
    fallback: "count_all_restaurant_requests";
  };
};

export type AdminPendingCountsResponse = {
  submissions: number;
  recommendationRequests: number;
  reviews: number;
  recommendationRequestsLifecycleReady: boolean;
  asOf: string;
  total: number;
  domains: Record<AdminPendingCountDomainId, AdminPendingCountDomain>;
  readiness: {
    status: AdminPendingCountReadinessStatus;
    recommendationRequestsLifecycleReady: boolean;
    reasons: typeof RESTAURANT_REQUESTS_LIFECYCLE_MISSING_REASON[];
    remediation?: string;
  };
  diagnostics: AdminPendingCountsDiagnostics;
};

export type BuildAdminPendingCountsResponseInput = {
  restaurantSubmissions: number;
  restaurantRecommendationRequests: number;
  reviews: number;
  recommendationRequestsLifecycleReady: boolean;
  asOf?: string | Date;
};

const RESTAURANT_REQUESTS_LIFECYCLE_REMEDIATION =
  "Run the restaurant request lifecycle migration before relying on scoped pending recommendation-request counts.";

function normalizeCountValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function normalizeAsOf(value: string | Date | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getDomainCount(payload: Record<string, unknown>, id: AdminPendingCountDomainId): number | null {
  const domains = payload.domains;
  if (!isRecord(domains)) return null;

  const domain = domains[id];
  if (!isRecord(domain)) return null;

  return normalizeCountValue(domain.count);
}

function getDomainReady(payload: Record<string, unknown>, id: AdminPendingCountDomainId): boolean | null {
  const domains = payload.domains;
  if (!isRecord(domains)) return null;

  const domain = domains[id];
  if (!isRecord(domain) || typeof domain.ready !== "boolean") return null;

  return domain.ready;
}

export function buildAdminPendingCountsResponse({
  restaurantSubmissions,
  restaurantRecommendationRequests,
  reviews,
  recommendationRequestsLifecycleReady,
  asOf,
}: BuildAdminPendingCountsResponseInput): AdminPendingCountsResponse {
  const restaurantSubmissionsCount = normalizeCountValue(restaurantSubmissions);
  const recommendationRequestsCount = normalizeCountValue(restaurantRecommendationRequests);
  const reviewsCount = normalizeCountValue(reviews);
  const submissions = restaurantSubmissionsCount + recommendationRequestsCount;
  const lifecycleReady = recommendationRequestsLifecycleReady === true;
  const status: AdminPendingCountReadinessStatus = lifecycleReady ? "ready" : "degraded";
  const reasons = lifecycleReady ? [] : [RESTAURANT_REQUESTS_LIFECYCLE_MISSING_REASON];
  const remediation = lifecycleReady ? undefined : RESTAURANT_REQUESTS_LIFECYCLE_REMEDIATION;

  return {
    submissions,
    recommendationRequests: recommendationRequestsCount,
    reviews: reviewsCount,
    recommendationRequestsLifecycleReady: lifecycleReady,
    asOf: normalizeAsOf(asOf),
    total: submissions + reviewsCount,
    domains: {
      restaurant_submissions: {
        id: "restaurant_submissions",
        count: restaurantSubmissionsCount,
        ready: true,
        status: "ready",
      },
      restaurant_recommendation_requests: {
        id: "restaurant_recommendation_requests",
        count: recommendationRequestsCount,
        ready: lifecycleReady,
        status,
        ...(lifecycleReady
          ? {}
          : {
              reason: RESTAURANT_REQUESTS_LIFECYCLE_MISSING_REASON,
              remediation: RESTAURANT_REQUESTS_LIFECYCLE_REMEDIATION,
            }),
      },
      reviews: {
        id: "reviews",
        count: reviewsCount,
        ready: true,
        status: "ready",
      },
    },
    readiness: {
      status,
      recommendationRequestsLifecycleReady: lifecycleReady,
      reasons,
      ...(remediation ? { remediation } : {}),
    },
    diagnostics: lifecycleReady
      ? {}
      : {
          restaurantRequestsLifecycle: {
            reason: RESTAURANT_REQUESTS_LIFECYCLE_MISSING_REASON,
            table: "restaurant_requests",
            columns: RESTAURANT_REQUESTS_LIFECYCLE_COLUMNS,
            fallback: "count_all_restaurant_requests",
          },
        },
  };
}

export function normalizeAdminPendingCountsResponse(payload: unknown): AdminPendingCountsResponse {
  const record = isRecord(payload) ? payload : {};
  const recommendationRequests =
    getDomainCount(record, "restaurant_recommendation_requests") ??
    normalizeCountValue(record.recommendationRequests);
  const submissionsLegacy = normalizeCountValue(record.submissions);
  const restaurantSubmissions =
    getDomainCount(record, "restaurant_submissions") ??
    Math.max(0, submissionsLegacy - recommendationRequests);
  const reviews = getDomainCount(record, "reviews") ?? normalizeCountValue(record.reviews);
  const domainReady = getDomainReady(record, "restaurant_recommendation_requests");
  const lifecycleReady =
    domainReady ??
    (typeof record.recommendationRequestsLifecycleReady === "boolean"
      ? record.recommendationRequestsLifecycleReady
      : true);

  return buildAdminPendingCountsResponse({
    restaurantSubmissions,
    restaurantRecommendationRequests: recommendationRequests,
    reviews,
    recommendationRequestsLifecycleReady: lifecycleReady,
    asOf: typeof record.asOf === "string" ? record.asOf : undefined,
  });
}

export function getAdminPendingCountsTotal(response: AdminPendingCountsResponse): number {
  return response.total;
}

export function getAdminPendingSubmissionCount(response: AdminPendingCountsResponse): number {
  return response.submissions;
}

export function getAdminPendingReviewCount(response: AdminPendingCountsResponse): number {
  return response.reviews;
}
