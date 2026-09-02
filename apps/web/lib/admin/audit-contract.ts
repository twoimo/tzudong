export const ADMIN_AUDIT_PRIMARY_SOURCE = "admin_audit_events";
export const RESTAURANT_REQUEST_REVIEW_AUDIT_SOURCE = "restaurant_request_review_audit";
export const RESTAURANT_CLAIM_AUDIT_SOURCE = "restaurant_claim_audit";

export const ADMIN_AUDIT_COVERAGE_MODE = "truthful-partial-domain-specific";

export type AdminAuditCoverageFeed = {
  domain: string;
  source: string;
  label: string;
  summary: string;
  readback: string;
};

export type AdminAuditCoverage = {
  mode: typeof ADMIN_AUDIT_COVERAGE_MODE;
  strategy: typeof ADMIN_AUDIT_COVERAGE_MODE;
  universal: false;
  label: string;
  summary: string;
  remediation: string;
  primary: Readonly<AdminAuditCoverageFeed>;
  domainSpecific: ReadonlyArray<Readonly<AdminAuditCoverageFeed>>;
};

export type MutationAuditReceiptInput = {
  domain: string;
  source: string;
  readbackId?: string | null;
  correlationId?: string | null;
  auditIds?: Array<string | null | undefined> | null;
};

export type MutationAuditReceipt = {
  domain: string;
  source: string;
  readbackId: string | null;
  correlationId: string | null;
  auditIds: string[];
};

export const ADMIN_AUDIT_COVERAGE: AdminAuditCoverage = Object.freeze({
  mode: ADMIN_AUDIT_COVERAGE_MODE,
  strategy: ADMIN_AUDIT_COVERAGE_MODE,
  universal: false,
  label: "Partial domain-specific audit coverage",
  summary:
    "Audit readback is limited to known domain-specific feeds; it is not a universal audit ledger for every admin action.",
  remediation:
    "Use the listed source tables for supported domains and add a dedicated audit feed before representing any new domain as covered.",
  primary: Object.freeze({
    domain: "admin_user_management",
    source: ADMIN_AUDIT_PRIMARY_SOURCE,
    label: "Admin user management audit feed",
    summary:
      "Admin user creation, role, profile, disable, and reactivation events are read from admin_audit_events.",
    readback: "Recent events are exposed by /api/admin/audit-events.",
  }),
  domainSpecific: Object.freeze([
    Object.freeze({
      domain: "restaurant_request_reviews",
      source: RESTAURANT_REQUEST_REVIEW_AUDIT_SOURCE,
      label: "Restaurant recommendation review audit feed",
      summary:
        "Restaurant recommendation review decisions have a separate domain-specific audit/readback path.",
      readback:
        "Review mutations return their restaurant_request_review_audit identifier for request-level readback.",
    }),
    Object.freeze({
      domain: "restaurant_claims",
      source: RESTAURANT_CLAIM_AUDIT_SOURCE,
      label: "Restaurant ownership claim audit feed",
      summary:
        "Public restaurant ownership-claim approvals have a separate domain-specific audit/readback path.",
      readback:
        "Claim approval mutations return their restaurant_claim_audit identifier for claim-level readback.",
    }),
  ]),
});

export function getAdminAuditCoverage(): AdminAuditCoverage {
  return ADMIN_AUDIT_COVERAGE;
}

export function buildMutationAuditReceipt({
  domain,
  source,
  readbackId = null,
  correlationId = null,
  auditIds = [],
}: MutationAuditReceiptInput): MutationAuditReceipt {
  return {
    domain,
    source,
    readbackId,
    correlationId,
    auditIds: (auditIds ?? []).filter(
      (auditId): auditId is string =>
        typeof auditId === "string" && auditId.length > 0,
    ),
  };
}
