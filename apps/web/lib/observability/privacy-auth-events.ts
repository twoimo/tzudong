const EVENTS = [
  'onboarding',
  'auth_callback',
  'middleware',
  'logout',
  'roster_classification',
  'release',
] as const;

const ROUTE_CLASSES = [
  'public_page',
  'public_api',
  'loop_safe_page',
  'loop_safe_api',
  'protected',
] as const;

const PROVIDERS = ['password', 'oauth', 'session', 'none'] as const;

const OUTCOME_REASONS = [
  'started',
  'auth_started',
  'callback_started',
  'onboarding_started',
  'pending_email_confirmation',
  'onboarding_required',
  'admitted',
  'held',
  'failed',
  'denied',
  'completed',
  'already_current_eligible',
  'needs_user_onboarding',
  'workflow_42501',
  'audit_write_failed',
  'eligibility_error',
  'policy_drift',
  'catalog_drift',
  'roster_conservation_mismatch',
  'release_verified',
] as const;

export type PrivacyAuthEvent = {
  event: (typeof EVENTS)[number];
  buildCommit: string;
  deploymentId: string;
  migrationManifestSha: string;
  policyVersion: string;
  policySha: string;
  routeClass: (typeof ROUTE_CLASSES)[number];
  provider: (typeof PROVIDERS)[number];
  outcomeReason: (typeof OUTCOME_REASONS)[number];
  correlationId: string;
  subjectDigest: string | null;
};

export type EmittedPrivacyAuthEvent = PrivacyAuthEvent & {
  utcMinute: string;
};
export type PrivacyAuthEventInput = Omit<
  PrivacyAuthEvent,
  'buildCommit' | 'deploymentId' | 'migrationManifestSha'
>;

const SERVER_METADATA_ENVIRONMENT_KEYS = [
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_DEPLOYMENT_ID',
  'RELEASE_MIGRATION_MANIFEST_SHA256',
] as const;

function serverMetadataFromEnvironment(environment: Record<string, string | undefined>): Pick<
  PrivacyAuthEvent,
  'buildCommit' | 'deploymentId' | 'migrationManifestSha'
> | null {
  const [buildCommit, deploymentId, migrationManifestSha] = SERVER_METADATA_ENVIRONMENT_KEYS
    .map((key) => environment[key]?.trim());

  if (
    !buildCommit || !COMMIT_PATTERN.test(buildCommit)
    || !deploymentId || !DEPLOYMENT_ID_PATTERN.test(deploymentId)
    || !migrationManifestSha || !SHA256_PATTERN.test(migrationManifestSha)
  ) {
    return null;
  }

  return { buildCommit, deploymentId, migrationManifestSha };
}

/**
 * Best-effort server telemetry which never alters an auth/privacy decision.
 * Invalid or unavailable deployment provenance is deliberately suppressed rather
 * than represented by a synthetic value.
 */
export function emitPrivacyAuthEventFromServerEnvironment(
  input: PrivacyAuthEventInput,
  environment: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): EmittedPrivacyAuthEvent | null {
  const metadata = serverMetadataFromEnvironment(environment);
  if (!metadata) {
    console.warn('privacy_auth_event_suppressed: invalid_server_metadata');
    return null;
  }

  try {
    return emitPrivacyAuthEvent({ ...metadata, ...input }, now);
  } catch {
    console.warn('privacy_auth_event_suppressed: invalid_event');
    return null;
  }
}

const EVENT_KEYS = [
  'event',
  'buildCommit',
  'deploymentId',
  'migrationManifestSha',
  'policyVersion',
  'policySha',
  'routeClass',
  'provider',
  'outcomeReason',
  'correlationId',
  'subjectDigest',
] as const;

const COMMIT_PATTERN = /^[a-f0-9]{7,64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const POLICY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function isAllowed<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function requireMatch(value: unknown, pattern: RegExp, field: string): asserts value is string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`Invalid privacy auth event ${field}.`);
  }
}

function validatePrivacyAuthEvent(input: unknown): PrivacyAuthEvent {
  if (!isRecord(input)) {
    throw new TypeError('Privacy auth event must be a plain object.');
  }

  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== EVENT_KEYS.length ||
    keys.some((key) => typeof key !== 'string' || !EVENT_KEYS.includes(key as (typeof EVENT_KEYS)[number]))
  ) {
    throw new TypeError('Privacy auth event contains forbidden fields.');
  }

  if (!isAllowed(input.event, EVENTS)) throw new TypeError('Invalid privacy auth event event.');
  if (!isAllowed(input.routeClass, ROUTE_CLASSES)) throw new TypeError('Invalid privacy auth event routeClass.');
  if (!isAllowed(input.provider, PROVIDERS)) throw new TypeError('Invalid privacy auth event provider.');
  if (!isAllowed(input.outcomeReason, OUTCOME_REASONS)) throw new TypeError('Invalid privacy auth event outcomeReason.');

  requireMatch(input.buildCommit, COMMIT_PATTERN, 'buildCommit');
  requireMatch(input.deploymentId, DEPLOYMENT_ID_PATTERN, 'deploymentId');
  requireMatch(input.migrationManifestSha, SHA256_PATTERN, 'migrationManifestSha');
  requireMatch(input.policyVersion, POLICY_VERSION_PATTERN, 'policyVersion');
  requireMatch(input.policySha, SHA256_PATTERN, 'policySha');
  requireMatch(input.correlationId, UUID_PATTERN, 'correlationId');

  if (input.subjectDigest !== null) requireMatch(input.subjectDigest, SHA256_PATTERN, 'subjectDigest');

  return input as PrivacyAuthEvent;
}

export function formatPrivacyAuthUtcMinute(now: Date): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('Privacy auth event timestamp must be a valid Date.');
  }

  return `${now.toISOString().slice(0, 16)}:00.000Z`;
}

/**
 * Emits the sole privacy-auth recovery event shape to server runtime logs.
 * The input is runtime-validated before serialization so malformed or sensitive
 * payloads are never logged.
 */
export function emitPrivacyAuthEvent(input: unknown, now: Date = new Date()): EmittedPrivacyAuthEvent {
  if (typeof window !== 'undefined') {
    throw new Error('Privacy auth events can only be emitted on the server.');
  }

  const event = validatePrivacyAuthEvent(input);
  const emitted = { utcMinute: formatPrivacyAuthUtcMinute(now), ...event };
  console.info(JSON.stringify(emitted));
  return emitted;
}
