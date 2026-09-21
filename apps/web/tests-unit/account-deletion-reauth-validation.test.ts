import { beforeEach, describe, expect, mock, test } from 'bun:test';

const signInWithPassword = mock();
const rpc = mock();

mock.module('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { signInWithPassword },
    rpc,
  },
}));

const loadModule = () => import('@/lib/privacy/account-deletion-reauth');

const userId = '11111111-1111-4111-8111-111111111111';
const proofId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const idempotencyKey = 'idem-key-0001';

const validBinding = { userId, proofId, requestId, idempotencyKey };

describe('account deletion reauthentication validation', () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    rpc.mockReset();
  });

  test('keeps a binding that carries exactly the four allowed fields', async () => {
    const { parseAccountDeletionReauthRequest } = await loadModule();

    expect(parseAccountDeletionReauthRequest(validBinding)).toEqual(validBinding);
  });

  test('rejects missing, extra or malformed binding fields', async () => {
    const { parseAccountDeletionReauthRequest } = await loadModule();

    const rejected: unknown[] = [
      null,
      undefined,
      [],
      'binding',
      { ...validBinding, extra: 'nope' },
      { userId, proofId, requestId },
      { ...validBinding, userId: 'not-a-uuid' },
      { ...validBinding, proofId: 'not-a-proof' },
      { ...validBinding, requestId: 'not-a-request' },
      { ...validBinding, idempotencyKey: 'short' },
      { ...validBinding, idempotencyKey: '!invalid-key' },
      { ...validBinding, userId: 11111111 },
    ];

    for (const value of rejected) {
      expect(parseAccountDeletionReauthRequest(value)).toBeNull();
    }
  });

  test('keeps only an idempotent receipt with a parseable expiry', async () => {
    const { parseAccountDeletionReauthIssueReceipt } = await loadModule();

    expect(parseAccountDeletionReauthIssueReceipt({
      proofId,
      expiresAt: '2026-09-21T12:00:00.000Z',
    })).toEqual({ proofId, expiresAt: '2026-09-21T12:00:00.000Z' });

    const rejected: unknown[] = [
      null,
      [],
      { proofId },
      { proofId, expiresAt: 'not-a-date' },
      { proofId, expiresAt: 1700000000000 },
      { proofId, expiresAt: '2026-09-21T12:00:00.000Z', extra: true },
      { proofId: 'not-a-proof', expiresAt: '2026-09-21T12:00:00.000Z' },
    ];

    for (const value of rejected) {
      expect(parseAccountDeletionReauthIssueReceipt(value)).toBeNull();
    }
  });

  test('reads a bearer token only from a well formed Authorization header', async () => {
    const { bearerTokenFromAuthorization } = await loadModule();

    expect(bearerTokenFromAuthorization('Bearer token-value')).toBe('token-value');
    expect(bearerTokenFromAuthorization(null)).toBeNull();
    expect(bearerTokenFromAuthorization('')).toBeNull();
    expect(bearerTokenFromAuthorization('Bearer ')).toBeNull();
    expect(bearerTokenFromAuthorization('bearer token-value')).toBeNull();
    expect(bearerTokenFromAuthorization('Basic token-value')).toBeNull();
  });

  test('accepts a single row result only', async () => {
    const { asSingleRow } = await loadModule();

    expect(asSingleRow([{ proof_id: proofId }])).toEqual({ proof_id: proofId });
    expect(asSingleRow([])).toBeNull();
    expect(asSingleRow([{ a: 1 }, { b: 2 }])).toBeNull();
    expect(asSingleRow(['row'])).toBeNull();
    expect(asSingleRow({ proof_id: proofId })).toBeNull();
    expect(asSingleRow(null)).toBeNull();
  });

  test('creates a fresh session only for the same signed-in user', async () => {
    const { createAccountDeletionReauthenticationSession } = await loadModule();
    const input = { userId, email: 'twoimo@dgu.ac.kr', password: 'secret-password' };

    signInWithPassword.mockResolvedValueOnce({
      data: { session: { access_token: 'fresh-token' }, user: { id: userId } },
      error: null,
    });
    expect(await createAccountDeletionReauthenticationSession(input)).toEqual({ bearerToken: 'fresh-token' });

    signInWithPassword.mockResolvedValueOnce({
      data: { session: { access_token: 'fresh-token' }, user: { id: 'other-user' } },
      error: null,
    });
    expect(await createAccountDeletionReauthenticationSession(input)).toBeNull();

    signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: 'invalid credentials' },
    });
    expect(await createAccountDeletionReauthenticationSession(input)).toBeNull();

    signInWithPassword.mockResolvedValueOnce({
      data: { session: { access_token: '' }, user: { id: userId } },
      error: null,
    });
    expect(await createAccountDeletionReauthenticationSession(input)).toBeNull();

    expect(signInWithPassword).toHaveBeenCalledTimes(4);
  });

  test('issues a proof only from a well shaped single-row rpc result', async () => {
    const { issueAccountDeletionReauthenticationProof } = await loadModule();

    rpc.mockResolvedValueOnce({
      data: [{ proof_id: proofId, expires_at: '2026-09-21T12:00:00.000Z' }],
      error: null,
    });
    expect(await issueAccountDeletionReauthenticationProof(userId)).toEqual({
      proofId,
      expiresAt: '2026-09-21T12:00:00.000Z',
    });
    expect(rpc).toHaveBeenCalledWith('issue_account_deletion_reauth_proof', {
      p_target_user_id: userId,
    });

    rpc.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    expect(await issueAccountDeletionReauthenticationProof(userId)).toBeNull();

    rpc.mockResolvedValueOnce({
      data: [
        { proof_id: proofId, expires_at: '2026-09-21T12:00:00.000Z' },
        { proof_id: proofId, expires_at: '2026-09-21T12:00:00.000Z' },
      ],
      error: null,
    });
    expect(await issueAccountDeletionReauthenticationProof(userId)).toBeNull();

    rpc.mockResolvedValueOnce({
      data: [{ proof_id: proofId, expires_at: 'tomorrow' }],
      error: null,
    });
    expect(await issueAccountDeletionReauthenticationProof(userId)).toBeNull();
  });
});
