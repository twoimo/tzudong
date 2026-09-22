export const GUARDED_MUTATION_STEPS = Object.freeze([
  "Preview",
  "Confirm",
  "Apply",
  "Readback",
  "Audit",
] as const);

export const GUARDED_MUTATION_SEMANTICS = GUARDED_MUTATION_STEPS.join(" -> ");
export const GUARDED_MUTATION_CONFIRMATION = GUARDED_MUTATION_SEMANTICS;


export const GUARDED_MUTATION_DOMAINS = Object.freeze([
  "review_moderation",
  "restaurant_record",
  "restaurant_submission",
  "ocr_receipt",
  "restaurant_request_review",
  "pipeline_control",
] as const);

export type GuardedMutationStep = (typeof GUARDED_MUTATION_STEPS)[number];
export type GuardedMutationDomain = (typeof GUARDED_MUTATION_DOMAINS)[number];

export type GuardedMutationRequiredResponse = {
  error: string;
  requiresGuardedContract: true;
  steps: GuardedMutationStep[];
  domain: GuardedMutationDomain;
  action: string;
  readbackRequired: true;
  auditRequired: true;
};

const MAX_ACTION_LENGTH = 80;

function boundedAction(action: string): string {
  const trimmed = action.trim();
  if (trimmed.length <= MAX_ACTION_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_ACTION_LENGTH)}…`;
}

export function isLegacyBrowserAdminMutationEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ADMIN_LEGACY_BROWSER_MUTATIONS === "enabled";
}

export function isGuardedMutationConfirmationValid(value: string | null | undefined): boolean {
  return value === GUARDED_MUTATION_CONFIRMATION;
}

export function buildGuardedMutationRequiredResponse(
  domain: GuardedMutationDomain,
  action: string,
): GuardedMutationRequiredResponse {
  return {
    error: `관리자 변경은 ${GUARDED_MUTATION_SEMANTICS} guarded server contract가 필요합니다. Legacy browser mutation is disabled; guarded server contract required.`,
    requiresGuardedContract: true,
    steps: [...GUARDED_MUTATION_STEPS],
    domain,
    action: boundedAction(action),
    readbackRequired: true,
    auditRequired: true,
  };
}

export function assertLegacyBrowserAdminMutationEnabled(
  domain: GuardedMutationDomain,
  action: string,
): void {
  if (isLegacyBrowserAdminMutationEnabled()) return;

  const metadata = buildGuardedMutationRequiredResponse(domain, action);
  throw new Error(`${metadata.error} domain=${metadata.domain} action=${metadata.action}`);
}

export function isInlineOcrProcessEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ADMIN_OCR_INLINE_PROCESS_ENABLED === "enabled"
  );
}

const ADMIN_SAFE_ERROR_NAMES = new Set([
  "AbortError",
  "AggregateError",
  "AuthApiError",
  "Error",
  "FunctionsFetchError",
  "FunctionsHttpError",
  "FunctionsRelayError",
  "PostgrestError",
  "RangeError",
  "ReferenceError",
  "StorageApiError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "URIError",
]);

export function getAdminSafeErrorName(error: unknown): string {
  if (error instanceof Error && ADMIN_SAFE_ERROR_NAMES.has(error.name)) {
    return error.name;
  }
  if (error && typeof error === "object" && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && ADMIN_SAFE_ERROR_NAMES.has(name.trim())) {
      return name.trim();
    }
  }
  return typeof error === "object" && error !== null ? "object" : typeof error;
}

export const getGuardedMutationErrorName = getAdminSafeErrorName;
