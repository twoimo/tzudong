import { beforeEach, describe, expect, test } from 'bun:test';

import {
  RESTAURANT_CLAIM_CONFIRMATION_TEXT,
  RESTAURANT_CLAIM_ERROR,
} from '@/lib/claim/contract';
import {
  applyRestaurantClaimApproval,
  previewRestaurantClaimApproval,
  readPublicClaimStatus,
  resetRestaurantClaimLedgerForTests,
  startRestaurantClaim,
  submitRestaurantClaimEvidence,
} from '@/lib/claim/store';

const USER_A = '00000000-0000-4000-8000-00000000c1a0';
const USER_B = '00000000-0000-4000-8000-00000000c1a1';
const ADMIN_ID = 'e2e-admin-route-bypass';

function restaurantId(label: string) {
  return `10000000-0000-4000-8000-${label.padStart(12, '0')}`;
}

function licenseEvidence(overrides: Record<string, unknown> = {}) {
  return {
    documentKind: 'business_license',
    fileName: 'business-license.png',
    contentSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    byteLength: 128,
    mimeType: 'image/png',
    ...overrides,
  };
}

describe('restaurant claim flow', () => {
  beforeEach(() => {
    resetRestaurantClaimLedgerForTests();
  });

  test('happy path starts, accepts license evidence, applies with readback, and verifies owner', () => {
    const id = restaurantId('c1a100000001');
    const started = startRestaurantClaim({
      restaurantId: id,
      userId: USER_A,
      idempotencyKey: 'claim-start-happy-001',
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.status.ownerState).toBe('pending');
    expect(started.status.canStart).toBe(false);
    expect(started.status.claimId).toBeTruthy();

    const evidence = submitRestaurantClaimEvidence({
      claimId: started.status.claimId as string,
      userId: USER_A,
      evidence: licenseEvidence(),
    });
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;

    const preview = previewRestaurantClaimApproval({
      claimId: started.status.claimId as string,
      adminUserId: ADMIN_ID,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const applied = applyRestaurantClaimApproval({
      claimId: preview.preview.claimId,
      adminUserId: ADMIN_ID,
      operationId: preview.preview.operationId,
      previewHash: preview.preview.previewHash,
      confirmationText: RESTAURANT_CLAIM_CONFIRMATION_TEXT,
      idempotencyKey: 'claim-apply-happy-001',
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.receipt.ownerState).toBe('verified');
    expect(applied.receipt.replayed).toBe(false);
    expect(applied.receipt.readback.passed).toBe(true);
    expect(applied.receipt.readback.checks).toEqual({
      claimApproved: true,
      ownerBound: true,
      evidencePresent: true,
      restaurantOwnerMatches: true,
    });
    expect(applied.receipt.auditId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const publicStatus = readPublicClaimStatus(id, USER_A);
    expect('ok' in publicStatus && publicStatus.ok === false).toBe(false);
    if ('ok' in publicStatus && publicStatus.ok === false) return;
    expect(publicStatus.ownerState).toBe('verified');
    expect(publicStatus.canStart).toBe(false);
    expect(publicStatus.duplicateBlocked).toBe(true);
  });

  test('duplicate claim on the same restaurant is blocked', () => {
    const id = restaurantId('c1a100000002');
    const first = startRestaurantClaim({
      restaurantId: id,
      userId: USER_A,
      idempotencyKey: 'claim-start-dup-001',
    });
    expect(first.ok).toBe(true);

    const second = startRestaurantClaim({
      restaurantId: id,
      userId: USER_B,
      idempotencyKey: 'claim-start-dup-002',
    });
    expect(second).toEqual({ ok: false, error: RESTAURANT_CLAIM_ERROR.duplicateClaimBlocked });
  });

  test('same user can replay start with the same idempotency key', () => {
    const id = restaurantId('c1a100000003');
    const first = startRestaurantClaim({
      restaurantId: id,
      userId: USER_A,
      idempotencyKey: 'claim-start-idem-001',
    });
    const replay = startRestaurantClaim({
      restaurantId: id,
      userId: USER_A,
      idempotencyKey: 'claim-start-idem-001',
    });
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.status.claimId).toBe(first.status.claimId);
  });

  test('pending start with a different idempotency key conflicts', () => {
    const id = restaurantId('c1a100000004');
    expect(startRestaurantClaim({
      restaurantId: id,
      userId: USER_A,
      idempotencyKey: 'claim-start-conflict-001',
    }).ok).toBe(true);
    expect(startRestaurantClaim({
      restaurantId: id,
      userId: USER_A,
      idempotencyKey: 'claim-start-conflict-002',
    })).toEqual({ ok: false, error: RESTAURANT_CLAIM_ERROR.idempotencyConflict });
  });

  test('invalid license evidence is rejected without storing bytes', () => {
    const id = restaurantId('c1a100000005');
    const started = startRestaurantClaim({
      restaurantId: id,
      userId: USER_A,
      idempotencyKey: 'claim-start-evidence-001',
    });
    expect(started.ok).toBe(true);
    if (!started.ok || !started.status.claimId) return;

    expect(submitRestaurantClaimEvidence({
      claimId: started.status.claimId,
      userId: USER_A,
      evidence: licenseEvidence({ fileName: '../license.png' }),
    })).toEqual({ ok: false, error: RESTAURANT_CLAIM_ERROR.evidenceRequired });

    expect(submitRestaurantClaimEvidence({
      claimId: started.status.claimId,
      userId: USER_A,
      evidence: licenseEvidence({ mimeType: 'text/plain' }),
    })).toEqual({ ok: false, error: RESTAURANT_CLAIM_ERROR.evidenceRequired });

    expect(submitRestaurantClaimEvidence({
      claimId: started.status.claimId,
      userId: USER_A,
      evidence: { rawBytes: 'SECRET' },
    })).toEqual({ ok: false, error: RESTAURANT_CLAIM_ERROR.evidenceRequired });
  });

  test('wrong confirmation text is rejected before apply', () => {
    const id = restaurantId('c1a100000006');
    const started = startRestaurantClaim({
      restaurantId: id,
      userId: USER_A,
      idempotencyKey: 'claim-start-confirm-001',
    });
    if (!started.ok || !started.status.claimId) return;
    expect(submitRestaurantClaimEvidence({
      claimId: started.status.claimId,
      userId: USER_A,
      evidence: licenseEvidence(),
    }).ok).toBe(true);
    const preview = previewRestaurantClaimApproval({
      claimId: started.status.claimId,
      adminUserId: ADMIN_ID,
    });
    if (!preview.ok) return;
    expect(applyRestaurantClaimApproval({
      claimId: preview.preview.claimId,
      adminUserId: ADMIN_ID,
      operationId: preview.preview.operationId,
      previewHash: preview.preview.previewHash,
      confirmationText: '승인',
      idempotencyKey: 'claim-apply-confirm-001',
    })).toEqual({ ok: false, error: RESTAURANT_CLAIM_ERROR.confirmationRequired });
  });

  test('stale preview hash and expired preview are rejected', () => {
    const id = restaurantId('c1a100000007');
    const started = startRestaurantClaim({
      restaurantId: id,
      userId: USER_A,
      idempotencyKey: 'claim-start-stale-001',
    });
    if (!started.ok || !started.status.claimId) return;
    expect(submitRestaurantClaimEvidence({
      claimId: started.status.claimId,
      userId: USER_A,
      evidence: licenseEvidence(),
    }).ok).toBe(true);
    const preview = previewRestaurantClaimApproval({
      claimId: started.status.claimId,
      adminUserId: ADMIN_ID,
    });
    if (!preview.ok) return;

    expect(applyRestaurantClaimApproval({
      claimId: preview.preview.claimId,
      adminUserId: ADMIN_ID,
      operationId: preview.preview.operationId,
      previewHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      confirmationText: RESTAURANT_CLAIM_CONFIRMATION_TEXT,
      idempotencyKey: 'claim-apply-stale-hash-001',
    })).toEqual({ ok: false, error: RESTAURANT_CLAIM_ERROR.previewStale });

    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      expect(applyRestaurantClaimApproval({
        claimId: preview.preview.claimId,
        adminUserId: ADMIN_ID,
        operationId: preview.preview.operationId,
        previewHash: preview.preview.previewHash,
        confirmationText: RESTAURANT_CLAIM_CONFIRMATION_TEXT,
        idempotencyKey: 'claim-apply-stale-ttl-001',
      })).toEqual({ ok: false, error: RESTAURANT_CLAIM_ERROR.previewStale });
    } finally {
      Date.now = realNow;
    }
  });

  test('apply replay with the same idempotency key returns the same receipt', () => {
    const id = restaurantId('c1a100000008');
    const started = startRestaurantClaim({
      restaurantId: id,
      userId: USER_A,
      idempotencyKey: 'claim-start-replay-001',
    });
    if (!started.ok || !started.status.claimId) return;
    expect(submitRestaurantClaimEvidence({
      claimId: started.status.claimId,
      userId: USER_A,
      evidence: licenseEvidence(),
    }).ok).toBe(true);
    const preview = previewRestaurantClaimApproval({
      claimId: started.status.claimId,
      adminUserId: ADMIN_ID,
    });
    if (!preview.ok) return;
    const first = applyRestaurantClaimApproval({
      claimId: preview.preview.claimId,
      adminUserId: ADMIN_ID,
      operationId: preview.preview.operationId,
      previewHash: preview.preview.previewHash,
      confirmationText: RESTAURANT_CLAIM_CONFIRMATION_TEXT,
      idempotencyKey: 'claim-apply-replay-001',
    });
    const second = applyRestaurantClaimApproval({
      claimId: preview.preview.claimId,
      adminUserId: ADMIN_ID,
      operationId: preview.preview.operationId,
      previewHash: preview.preview.previewHash,
      confirmationText: RESTAURANT_CLAIM_CONFIRMATION_TEXT,
      idempotencyKey: 'claim-apply-replay-001',
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.receipt.replayed).toBe(false);
    expect(second.receipt.replayed).toBe(true);
    expect(second.receipt.auditId).toBe(first.receipt.auditId);
    expect(second.receipt.claimId).toBe(first.receipt.claimId);
  });
});
