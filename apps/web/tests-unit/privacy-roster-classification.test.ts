import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyPrivacyRoster,
  type RosterClassificationDependencies,
  type StoredRosterClassification,
} from '@/lib/privacy/roster-classification';
import type { CurrentPrivacyEligibility } from '@/lib/privacy/eligibility';

const roster = Array.from(
  { length: 16 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);

function eligibility(
  reasonCode: CurrentPrivacyEligibility['reasonCode'],
): CurrentPrivacyEligibility {
  return {
    eligible: reasonCode === 'PRIVACY_ELIGIBLE',
    reasonCode,
    receipt: null,
  };
}

function createDependencies(receipts: readonly (CurrentPrivacyEligibility | Error)[]) {
  const durable = new Map<string, StoredRosterClassification>();
  let lookups = 0;
  const key = (batchId: string, userId: string) => `${batchId}:${userId}`;
  const dependencies: RosterClassificationDependencies = {
    getCurrentPrivacyEligibilityForUser: async () => {
      const receipt = receipts[lookups++];
      if (receipt instanceof Error) throw receipt;
      return receipt ?? eligibility(null);
    },
    sink: {
      get: async (batchId, userId) => durable.get(key(batchId, userId)) ?? null,
      putIfAbsent: async (result) => {
        const existing = durable.get(key(result.batchId, result.userId));
        if (existing) return { inserted: false, classification: existing };
        durable.set(key(result.batchId, result.userId), result);
        return { inserted: true, classification: result };
      },
    },
  };

  return { dependencies, getLookups: () => lookups };
}

describe('classifyPrivacyRoster', () => {
  test('rejects malformed, duplicate, and non-16 manifests', async () => {
    const { dependencies } = createDependencies([]);

    await expect(classifyPrivacyRoster('batch-1', roster.slice(0, 15), dependencies)).rejects.toThrow('exactly 16');
    await expect(classifyPrivacyRoster('batch-1', [...roster.slice(0, 15), roster[0]], dependencies)).rejects.toThrow('unique');
    await expect(classifyPrivacyRoster('batch-1', [...roster.slice(0, 15), 'not-a-uuid'], dependencies)).rejects.toThrow('UUIDs');
  });

  test('conserves exactly sixteen opaque outcomes', async () => {
    const receipts = [
      ...Array.from({ length: 5 }, () => eligibility('PRIVACY_ELIGIBLE')),
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

  test('replays durable results without re-reading eligibility or overwriting them', async () => {
    const { dependencies, getLookups } = createDependencies(
      Array.from({ length: 16 }, () => eligibility('PRIVACY_ELIGIBLE')),
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
    expect(source).toContain('getCurrentPrivacyEligibilityForUser');
    expect(source).toContain('putIfAbsent');
    expect(source).not.toMatch(/\b(?:insert|upsert|delete)\w*\s*\(/i);
    expect(source).not.toMatch(/\b(?:consent|guardian|marketing|age|profile)\w*\s*[:=]/i);
  });
});
