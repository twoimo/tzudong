export type RiskReceiptStatus =
  | "applied"
  | "partial"
  | "failed"
  | "held";

export type RiskPreview<TSummary> = Readonly<{
  operationId: string;
  previewHash: string;
  expiresAt: string;
  summary: TSummary;
  requiredConfirmation: string;
}>;

export type RiskConfirm = Readonly<{
  operationId: string;
  previewHash: string;
  confirmationText: string;
  idempotencyKey: string;
}>;

export type RiskReadback = Readonly<{
  passed: boolean;
  checks: Readonly<Record<string, boolean>>;
}>;

export type RiskReceipt = Readonly<{
  operationId: string;
  status: RiskReceiptStatus;
  readback: RiskReadback;
  auditId: string;
  errorCode?: PrivacyErrorCode;
}>;

export type PrivacyPolicyLocale = "ko-KR";
export type PrivacyPolicyStatus = "draft" | "published" | "retired";
export type PrivacyAgeBand = "unknown" | "age_14_plus" | "under_14";
export type PrivacyAgeMethod = "self_attestation" | "verified_provider";
export type PrivacyAgeStatus =
  | "pending"
  | "eligible"
  | "blocked"
  | "guardian_pending"
  | "guardian_verified"
  | "guardian_withdrawn";
export type PrivacyGuardianStatus =
  | "pending"
  | "verified"
  | "rejected"
  | "expired"
  | "withdrawn";
export type PrivacyConsentSubjectKind = "self" | "child";
export type PrivacyConsentPurpose =
  | "privacy_required"
  | "marketing"
  | "email_marketing"
  | "sms_marketing"
  | "push_marketing"
  | "night_marketing";
export type PrivacyConsentChannel = "email" | "sms" | "push" | "in_app" | "none";
export type PrivacyConsentDecision = "granted" | "withdrawn";
export type PrivacyConsentSource =
  | "password_signup"
  | "oauth"
  | "settings"
  | "guardian";

export type PrivacyErrorCode =
  | "PRIVACY_AUTH_REQUIRED"
  | "PRIVACY_SERVICE_ROLE_REQUIRED"
  | "PRIVACY_INVALID_REQUEST"
  | "PRIVACY_POLICY_UNAVAILABLE"
  | "PRIVACY_POLICY_STALE"
  | "PRIVACY_CHALLENGE_NOT_FOUND"
  | "PRIVACY_CHALLENGE_EXPIRED"
  | "PRIVACY_CHALLENGE_REPLAYED"
  | "PRIVACY_IDEMPOTENCY_CONFLICT"
  | "PRIVACY_GUARDIAN_REQUIRED"
  | "PRIVACY_AGE_ATTESTATION_REQUIRED"
  | "PRIVACY_GUARDIAN_MISMATCH"
  | "PRIVACY_IMMUTABLE_RECORD";

export type PrivacyPolicyVersion = Readonly<{
  policyVersionId: string;
  version: string;
  locale: PrivacyPolicyLocale;
  contentSha256: string;
  effectiveAt: string;
}>;

export type PrivacyRequestedConsents = Readonly<{
  email?: boolean;
  sms?: boolean;
  push?: boolean;
  night_email?: boolean;
  night_sms?: boolean;
  night_push?: boolean;
}>;

export type PrivacyAuditCountKey =
  | "requested"
  | "created"
  | "updated"
  | "suppressed"
  | "failed"
  | "eligible"
  | "guardianVerified"
  | "consentEvents"
  | "requiredConsent"
  | "retryCount";

/** Values are aggregated only; personal data and free text are not audit metadata. */
export type PrivacyAuditCountSummary = Readonly<
  Partial<Record<PrivacyAuditCountKey, number | boolean>>
>;

/** The database rejects metadata outside this allowlist. */
export type PrivacySafeAuditMetadata = Readonly<{
  requestId?: string;
  ipHash?: string;
  userAgentFamily?: string;
  route?: `/${string}`;
}>;

export type CreatePrivacyOnboardingChallengeInput = Readonly<{
  tokenHash: string;
  policyVersionId: string;
  ageBand: PrivacyAgeBand;
  requestedConsents: PrivacyRequestedConsents;
  oauthNonceHash?: string;
  expiresAt?: string;
}>;

export type PrivacyOnboardingChallenge = Readonly<{
  challengeId: string;
  policyVersionId: string;
  expiresAt: string;
  auditId: string;
}>;

export type ConfirmPrivacyOnboardingInput = Readonly<{
  challengeId: string;
  challengeToken: string;
  userId: string;
  source: Extract<PrivacyConsentSource, "password_signup" | "oauth">;
  guardianVerificationId?: string;
}>;

export type PrivacyOnboardingReceipt = RiskReceipt &
  Readonly<{
    ageStatus: PrivacyAgeStatus;
  }>;

export type SubmitPrivacyConsentInput = Readonly<{
  purpose: Exclude<PrivacyConsentPurpose, "privacy_required">;
  channel: Exclude<PrivacyConsentChannel, "in_app" | "none">;
  decision: PrivacyConsentDecision;
  policyVersionId: string;
  noticeSha256: string;
  idempotencyKey: string;
  correlationId: string;
}>;

export type PrivacyConsentReceipt = RiskReceipt &
  Readonly<{
    consentEventId: string;
  }>;

export type RecordPrivacyGuardianVerificationInput = Readonly<{
  verificationId: string;
  childUserId: string;
  status: PrivacyGuardianStatus;
  provider: string;
  providerReferenceHash: string;
  verifiedAt?: string;
  expiresAt?: string;
}>;

export type PrivacyGuardianVerificationReceipt = RiskReceipt &
  Readonly<{
    guardianStatus: PrivacyGuardianStatus;
  }>;
