import { describe, expect, test } from 'bun:test';

import {
  getCurrentPrivacyEligibility,
  hasLivePrivacyEligibilityReceipt,
  parsePrivacyEligibilityReceipt,
} from '@/lib/privacy/eligibility';
import {
  PRIVACY_POLICY_CONTENT_SHA256,
  PRIVACY_POLICY_VERSION,
} from '@/lib/privacy/policy';

const POLICY_ID = '11111111-1111-4111-8111-111111111111';

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eligible: true,
    reasonCode: 'PRIVACY_ELIGIBLE',
    policyVersionId: POLICY_ID,
    policyVersion: PRIVACY_POLICY_VERSION,
    contentSha256: PRIVACY_POLICY_CONTENT_SHA256,
    ...overrides,
  };
}

function rpcClient(data: unknown, error: unknown = null) {
  return { rpc: async () => ({ data, error }) };
}

describe('privacy eligibility receipts', () => {
  test('admits only a schema-v1 receipt bound to the current policy', () => {
    const parsed = parsePrivacyEligibilityReceipt(receipt());
    expect(parsed).not.toBeNull();
    expect(hasLivePrivacyEligibilityReceipt({
      eligible: true,
      reasonCode: 'PRIVACY_ELIGIBLE',
      receipt: parsed,
    })).toBe(true);

    for (const malformed of [
      receipt({ schemaVersion: 2 }),
      receipt({ policyVersion: 'retired-policy' }),
      receipt({ policyVersionId: 'not-a-uuid' }),
      receipt({ extra: true }),
      receipt({ reasonCode: 'PRIVACY_GUARDIAN_CONSENT_REQUIRED', eligible: true }),
    ]) {
      expect(parsePrivacyEligibilityReceipt(malformed)).toBeNull();
    }

    const stale = parsePrivacyEligibilityReceipt(receipt({ contentSha256: 'b'.repeat(64) }));
    expect(stale).not.toBeNull();
    expect(hasLivePrivacyEligibilityReceipt({
      eligible: true,
      reasonCode: 'PRIVACY_ELIGIBLE',
      receipt: stale,
    })).toBe(false);
  });

  test('fails closed for stale, guardian-expired, withdrawn, malformed, and RPC-error receipts', async () => {
    const deniedReceipts = [
      receipt({ eligible: false, reasonCode: 'PRIVACY_POLICY_REATTESTATION_REQUIRED' }),
      receipt({ eligible: false, reasonCode: 'PRIVACY_GUARDIAN_CONSENT_REQUIRED' }),
      receipt({ eligible: false, reasonCode: 'PRIVACY_AGE_BLOCKED' }),
      { schemaVersion: 1, eligible: true },
    ];

    for (const value of deniedReceipts) {
      const eligibility = await getCurrentPrivacyEligibility(rpcClient(value) as never);
      expect(eligibility.eligible).toBe(false);
      expect(hasLivePrivacyEligibilityReceipt(eligibility)).toBe(false);
    }

    const unavailable = await getCurrentPrivacyEligibility(rpcClient(receipt(), { message: 'RPC unavailable' }) as never);
    expect(unavailable).toEqual({ eligible: false, reasonCode: null, receipt: null });
  });
});
