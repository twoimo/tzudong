import { createHash } from 'node:crypto';
import type { CurrentPrivacyEligibility } from '@/lib/privacy/eligibility';

if (typeof window !== 'undefined') {
  throw new Error('Privacy roster classification is server-only.');
}

export const ROSTER_CLASSIFICATION_SIZE = 16;

export type RosterClassification =
  | 'already_current_eligible'
  | 'needs_user_onboarding'
  | 'held'
  | 'failed';

export type StoredRosterClassification = Readonly<{
  batchId: string;
  userId: string;
  classification: RosterClassification;
  subjectDigest: string;
  receiptDigest: string;
  resultDigest: string;
}>;

export type RosterClassificationSink = Readonly<{
  get: (batchId: string, userId: string) => Promise<StoredRosterClassification | null>;
  putIfAbsent: (result: StoredRosterClassification) => Promise<Readonly<{
    inserted: boolean;
    classification: StoredRosterClassification;
  }>>;
}>;

export type RosterClassificationDependencies = Readonly<{
  getCurrentPrivacyEligibilityForUser: (userId: string) => Promise<CurrentPrivacyEligibility>;
  sink: RosterClassificationSink;
}>;

export type RosterClassificationResult = Readonly<{
  batchDigest: string;
  counts: Readonly<Record<RosterClassification, number>>;
  subjects: readonly Readonly<{
    classification: RosterClassification;
    subjectDigest: string;
    receiptDigest: string;
    resultDigest: string;
  }>[];
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CLASSIFICATIONS = new Set<RosterClassification>([
  'already_current_eligible',
  'needs_user_onboarding',
  'held',
  'failed',
]);

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function receiptDigest(eligibility: CurrentPrivacyEligibility | null) {
  if (eligibility === null) return digest('eligibility-error');

  return digest(JSON.stringify({
    eligible: eligibility.eligible,
    reasonCode: eligibility.reasonCode,
    receipt: eligibility.receipt,
  }));
}

function classifyEligibility(eligibility: CurrentPrivacyEligibility): RosterClassification {
  if (eligibility.eligible === true && eligibility.reasonCode === 'PRIVACY_ELIGIBLE') {
    return 'already_current_eligible';
  }

  switch (eligibility.reasonCode) {
    case 'PRIVACY_AGE_ATTESTATION_REQUIRED':
    case 'PRIVACY_POLICY_REATTESTATION_REQUIRED':
      return 'needs_user_onboarding';
    case 'PRIVACY_AGE_BLOCKED':
    case 'PRIVACY_GUARDIAN_REQUIRED':
    case 'PRIVACY_GUARDIAN_CONSENT_REQUIRED':
      return 'held';
    default:
      return 'failed';
  }
}

function validateManifest(batchId: string, userIds: readonly string[]) {
  if (typeof batchId !== 'string' || batchId.trim().length === 0) {
    throw new Error('A non-empty batchId is required.');
  }
  if (userIds.length !== ROSTER_CLASSIFICATION_SIZE) {
    throw new Error(`Roster must contain exactly ${ROSTER_CLASSIFICATION_SIZE} subjects.`);
  }

  const normalizedUserIds = userIds.map((userId) => {
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
      throw new Error('Roster subjects must be UUIDs.');
    }
    return userId.toLowerCase();
  });

  if (new Set(normalizedUserIds).size !== ROSTER_CLASSIFICATION_SIZE) {
    throw new Error('Roster subjects must be unique.');
  }

  return normalizedUserIds;
}

function isStoredResult(value: StoredRosterClassification, batchId: string, userId: string) {
  return value.batchId === batchId
    && value.userId === userId
    && CLASSIFICATIONS.has(value.classification)
    && SHA256_PATTERN.test(value.subjectDigest)
    && SHA256_PATTERN.test(value.receiptDigest)
    && SHA256_PATTERN.test(value.resultDigest);
}

function publicSubject(result: StoredRosterClassification) {
  return {
    classification: result.classification,
    subjectDigest: result.subjectDigest,
    receiptDigest: result.receiptDigest,
    resultDigest: result.resultDigest,
  };
}

export async function classifyPrivacyRoster(
  batchId: string,
  userIds: readonly string[],
  dependencies: RosterClassificationDependencies,
): Promise<RosterClassificationResult> {
  const normalizedUserIds = validateManifest(batchId, userIds);
  const counts: Record<RosterClassification, number> = {
    already_current_eligible: 0,
    needs_user_onboarding: 0,
    held: 0,
    failed: 0,
  };
  const subjects: Array<ReturnType<typeof publicSubject>> = [];

  for (const userId of normalizedUserIds) {
    const stored = await dependencies.sink.get(batchId, userId);
    if (stored !== null) {
      if (!isStoredResult(stored, batchId, userId)) {
        throw new Error('Durable roster classification is invalid.');
      }
      counts[stored.classification] += 1;
      subjects.push(publicSubject(stored));
      continue;
    }

    let eligibility: CurrentPrivacyEligibility | null = null;
    try {
      eligibility = await dependencies.getCurrentPrivacyEligibilityForUser(userId);
    } catch {
      eligibility = null;
    }

    const classification = eligibility === null ? 'failed' : classifyEligibility(eligibility);
    const evidenceDigest = receiptDigest(eligibility);
    const subjectDigest = digest(userId);
    const result: StoredRosterClassification = {
      batchId,
      userId,
      classification,
      subjectDigest,
      receiptDigest: evidenceDigest,
      resultDigest: digest(`${batchId}:${userId}:${classification}:${evidenceDigest}`),
    };
    const persisted = await dependencies.sink.putIfAbsent(result);

    if (!isStoredResult(persisted.classification, batchId, userId)) {
      throw new Error('Durable roster classification is invalid.');
    }
    counts[persisted.classification.classification] += 1;
    subjects.push(publicSubject(persisted.classification));
  }

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total !== ROSTER_CLASSIFICATION_SIZE || subjects.length !== ROSTER_CLASSIFICATION_SIZE) {
    throw new Error('Roster classification count conservation failed.');
  }

  return {
    batchDigest: digest(batchId),
    counts,
    subjects,
  };
}
