import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  classifyPrivacyRoster,
  type RosterClassificationDependencies,
  type StoredRosterClassification,
} from '@/lib/privacy/roster-classification';
import type { CurrentPrivacyEligibility } from '@/lib/privacy/eligibility';
import {
  PRIVACY_POLICY_CONTENT_SHA256,
  PRIVACY_POLICY_VERSION,
} from '@/lib/privacy/policy';

const roster = Array.from(
  { length: 16 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);
const pseudonymKey = new TextEncoder().encode('server-held-roster-pseudonym-key');

function eligibility(
  reasonCode: CurrentPrivacyEligibility['reasonCode'],
): CurrentPrivacyEligibility {
  return {
    eligible: reasonCode === 'PRIVACY_ELIGIBLE',
    reasonCode,
    receipt: null,
  };
}

function liveEligibility(): CurrentPrivacyEligibility {
  return {
    eligible: true,
    reasonCode: 'PRIVACY_ELIGIBLE',
    receipt: {
      schemaVersion: 1,
      eligible: true,
      reasonCode: 'PRIVACY_ELIGIBLE',
      policyVersionId: '11111111-1111-4111-8111-111111111111',
      policyVersion: PRIVACY_POLICY_VERSION,
      contentSha256: PRIVACY_POLICY_CONTENT_SHA256,
    },
  };
}
function legacyPublicResultDigest(result: Pick<
  StoredRosterClassification,
  'batchId' | 'userId' | 'classification' | 'subjectDigest' | 'receiptDigest'
>) {
  return createHash('sha256').update(JSON.stringify(result)).digest('hex');
}
function createDependencies(
  receipts: readonly (CurrentPrivacyEligibility | Error)[],
  subjectPseudonymKey = pseudonymKey,
) {
  const durable = new Map<string, StoredRosterClassification>();
  const manifests = new Map<string, string>();
  let lookups = 0;
  const key = (batchId: string, userId: string) => `${batchId}:${userId}`;
  const dependencies: RosterClassificationDependencies = {
    getCurrentPrivacyEligibilityForUser: async () => {
      const receipt = receipts[lookups++];
      if (receipt instanceof Error) throw receipt;
      return receipt ?? eligibility(null);
    },
    subjectPseudonymKey,
    sink: {
      bindManifestIfAbsent: async (batchId, manifestDigest) => {
        const existing = manifests.get(batchId);
        if (existing) return { inserted: false, manifestDigest: existing };
        manifests.set(batchId, manifestDigest);
        return { inserted: true, manifestDigest };
      },
      get: async (batchId, userId) => durable.get(key(batchId, userId)) ?? null,
      putIfAbsent: async (result) => {
        const existing = durable.get(key(result.batchId, result.userId));
        if (existing) return { inserted: false, classification: existing };
        durable.set(key(result.batchId, result.userId), result);
        return { inserted: true, classification: result };
      },
    },
  };

  return { dependencies, durable, getLookups: () => lookups };
}

describe('classifyPrivacyRoster', () => {
  test('rejects malformed, duplicate, and non-16 manifests', async () => {
    const { dependencies } = createDependencies([]);

    await expect(classifyPrivacyRoster('batch-1', roster.slice(0, 15), dependencies)).rejects.toThrow('exactly 16');
    await expect(classifyPrivacyRoster('batch-1', [...roster.slice(0, 15), roster[0]], dependencies)).rejects.toThrow('unique');
    await expect(classifyPrivacyRoster('batch-1', [...roster.slice(0, 15), 'not-a-uuid'], dependencies)).rejects.toThrow('UUIDs');
  });

  test('rejects undersized subject pseudonym keys', async () => {
    const { dependencies } = createDependencies([]);

    await expect(classifyPrivacyRoster('batch-short-key', roster, {
      ...dependencies,
      subjectPseudonymKey: new Uint8Array([1]),
    })).rejects.toThrow('at least 32 bytes');
  });

  test('requires a live current-policy schema-v1 receipt for eligible classification', async () => {
const live = liveEligibility();
    const stale: CurrentPrivacyEligibility = {
      ...live,
      receipt: { ...live.receipt!, policyVersion: 'stale-policy' },
    };
    const { dependencies } = createDependencies([
      eligibility('PRIVACY_ELIGIBLE'),
      stale,
      ...Array.from({ length: 14 }, liveEligibility),
    ]);

    const result = await classifyPrivacyRoster('batch-live-receipt', roster, dependencies);

    expect(result.subjects[0]?.classification).toBe('failed');
    expect(result.subjects[1]?.classification).toBe('failed');
    expect(result.counts.already_current_eligible).toBe(14);
  });

  test('conserves exactly sixteen opaque outcomes', async () => {
    const receipts = [
      ...Array.from({ length: 5 }, liveEligibility),
      ...Array.from({ length: 4 }, () => eligibility('PRIVACY_POLICY_REATTESTATION_REQUIRED')),
      ...Array.from({ length: 3 }, () => eligibility('PRIVACY_GUARDIAN_REQUIRED')),
      ...Array.from({ length: 3 }, () => eligibility(null)),
      new Error('RPC unavailable'),
    ];
    const { dependencies } = createDependencies(receipts);

    const result = await classifyPrivacyRoster('batch-conservation', roster, dependencies);

    expect(result.counts).toEqual({
      already_current_eligible: 5,
      needs_user_onboarding: 4,
      held: 3,
      failed: 4,
    });
    expect(Object.values(result.counts).reduce((sum, count) => sum + count, 0)).toBe(16);
    expect(result.subjects).toHaveLength(16);
    expect(JSON.stringify(result)).not.toContain(roster[0]);
    for (const subject of result.subjects) {
      expect(subject.subjectDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(subject.receiptDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(subject.resultDigest).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test('rejects corrupt manifest bindings and same-batch different-manifest replay', async () => {
const { dependencies } = createDependencies(Array.from({ length: 32 }, liveEligibility));
    const corruptDependencies: RosterClassificationDependencies = {
      ...dependencies,
      sink: {
        ...dependencies.sink,
        bindManifestIfAbsent: async () => ({
          inserted: false,
          manifestDigest: 'not-a-digest',
        }),
      },
    };
    await expect(
      classifyPrivacyRoster('batch-corrupt-manifest', roster, corruptDependencies),
    ).rejects.toThrow('batch manifest');

    const replay = createDependencies(Array.from({ length: 32 }, liveEligibility));
    await classifyPrivacyRoster('batch-manifest-replay', roster, replay.dependencies);
    const differentRoster = [...roster];
    differentRoster[15] = '00000000-0000-4000-8000-000000000099';
    await expect(
      classifyPrivacyRoster('batch-manifest-replay', differentRoster, replay.dependencies),
    ).rejects.toThrow('batch manifest');
  });

  test('uses purpose-scoped HMAC pseudonyms', async () => {
    const first = createDependencies(Array.from({ length: 16 }, liveEligibility));
    const second = createDependencies(
      Array.from({ length: 16 }, liveEligibility),
      new TextEncoder().encode('different-server-held-roster-pseudonym-key'),
    );
    const firstResult = await classifyPrivacyRoster('batch-pseudonym-a', roster, first.dependencies);
    const secondResult = await classifyPrivacyRoster('batch-pseudonym-b', roster, second.dependencies);

    expect(firstResult.subjects[0]?.subjectDigest).not.toBe(secondResult.subjects[0]?.subjectDigest);
  });

  test('rejects forged coherent stored and raced sink rewrites', async () => {
    const storedFixture = createDependencies(Array.from({ length: 16 }, liveEligibility));
    await classifyPrivacyRoster('batch-forged-stored', roster, storedFixture.dependencies);

    const storedKey = 'batch-forged-stored:00000000-0000-4000-8000-000000000001';
    const stored = storedFixture.durable.get(storedKey)!;
    const forgedStoredFields = {
      batchId: stored.batchId,
      userId: stored.userId,
      classification: 'held' as const,
      subjectDigest: stored.subjectDigest,
      receiptDigest: '0'.repeat(64),
    };
    const forgedStored: StoredRosterClassification = {
      ...forgedStoredFields,
      resultDigest: legacyPublicResultDigest(forgedStoredFields),
    };
    storedFixture.durable.set(storedKey, forgedStored);

    await expect(
      classifyPrivacyRoster('batch-forged-stored', roster, storedFixture.dependencies),
    ).rejects.toThrow('classification is invalid');

    const racedFixture = createDependencies(Array.from({ length: 16 }, liveEligibility));
    const racedDependencies: RosterClassificationDependencies = {
      ...racedFixture.dependencies,
      sink: {
        ...racedFixture.dependencies.sink,
        putIfAbsent: async (result) => {
          const forgedResultFields = {
            batchId: result.batchId,
            userId: result.userId,
            classification: 'held' as const,
            subjectDigest: result.subjectDigest,
            receiptDigest: 'f'.repeat(64),
          };
          return {
            inserted: false,
            classification: {
              ...forgedResultFields,
              resultDigest: legacyPublicResultDigest(forgedResultFields),
            },
          };
        },
      },
    };

    await expect(
      classifyPrivacyRoster('batch-forged-race', roster, racedDependencies),
    ).rejects.toThrow('classification is invalid');
  });

  test('replays durable results without re-reading eligibility or overwriting them', async () => {
    const { dependencies, getLookups } = createDependencies(
      Array.from({ length: 16 }, liveEligibility),
    );

    const first = await classifyPrivacyRoster('batch-replay', roster, dependencies);
    const replay = await classifyPrivacyRoster('batch-replay', roster, dependencies);

    expect(replay).toEqual(first);
    expect(getLookups()).toBe(16);
  });

  test('maps held receipts and reader errors fail closed', async () => {
    const { dependencies } = createDependencies([
      eligibility('PRIVACY_AGE_BLOCKED'),
      new Error('RPC unavailable'),
      ...Array.from({ length: 14 }, () => eligibility('PRIVACY_AGE_ATTESTATION_REQUIRED')),
    ]);

    const result = await classifyPrivacyRoster('batch-held', roster, dependencies);

    expect(result.subjects[0]?.classification).toBe('held');
    expect(result.subjects[1]?.classification).toBe('failed');
    expect(result.counts).toEqual({
      already_current_eligible: 0,
      needs_user_onboarding: 14,
      held: 1,
      failed: 1,
    });
  });

  test('has no privacy mutation surface', () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dir, '../lib/privacy/roster-classification.ts'),
      'utf8',
    );

    expect(source).toContain("typeof window !== 'undefined'");
    expect(source).toContain('hasLivePrivacyEligibilityReceipt');
    expect(source).toContain('bindManifestIfAbsent');
    expect(source).toContain('createHmac');
    expect(source).toContain('putIfAbsent');
    expect(source).toContain("event: 'roster_classification'");
    expect(source).toContain("'roster_conservation_mismatch'");
    expect(source).toContain("emitRosterClassificationEvent(classification, correlationId)");
    expect(source).not.toMatch(/\b(?:insert|upsert|delete)\w*\s*\(/i);
    expect(source).not.toMatch(/\b(?:consent|guardian|marketing|age|profile)\w*\s*[:=]/i);
  });
});
