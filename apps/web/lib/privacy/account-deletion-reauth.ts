import { reauthenticateBrowserAccount } from '@/lib/auth/isolated-browser-account';
import {
  isAccountDeletionIdempotencyKey,
  isAccountDeletionRequestId,
} from '@/lib/privacy/account-deletion';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RecordValue = Record<string, unknown>;

type AccountDeletionReauthBinding = Readonly<{
  userId: string;
  proofId: string;
  requestId: string;
  idempotencyKey: string;
}>;
export type AccountDeletionReauthIssueReceipt = Readonly<{ proofId: string; expiresAt: string }>;
export type AccountDeletionReauthenticationSession = Awaited<ReturnType<typeof reauthenticateBrowserAccount>>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactKeys = (value: RecordValue, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));

export const asSingleRow = (value: unknown): RecordValue | null =>
  Array.isArray(value) && value.length === 1 && isRecord(value[0]) ? value[0] : null;
export const isAccountDeletionReauthProofId = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

export const parseAccountDeletionReauthRequest = (
  value: unknown,
): AccountDeletionReauthBinding | null =>
  isRecord(value)
  && hasExactKeys(value, ['userId', 'proofId', 'requestId', 'idempotencyKey'])
  && typeof value.userId === 'string'
  && UUID_PATTERN.test(value.userId)
  && isAccountDeletionReauthProofId(value.proofId)
  && isAccountDeletionRequestId(value.requestId)
  && isAccountDeletionIdempotencyKey(value.idempotencyKey)
    ? {
      userId: value.userId,
      proofId: value.proofId,
      requestId: value.requestId,
      idempotencyKey: value.idempotencyKey,
    }
    : null;
export const parseAccountDeletionReauthIssueReceipt = (value: unknown): AccountDeletionReauthIssueReceipt | null =>
  isRecord(value)
  && hasExactKeys(value, ['proofId', 'expiresAt'])
  && isAccountDeletionReauthProofId(value.proofId)
  && typeof value.expiresAt === 'string'
  && Number.isFinite(Date.parse(value.expiresAt))
    ? { proofId: value.proofId, expiresAt: value.expiresAt }
    : null;

export async function createAccountDeletionReauthenticationSession(input: Readonly<{
  userId: string;
  email: string;
  password: string;
}>) {
  try { return await reauthenticateBrowserAccount(input); }
  catch { return null; }
}

export async function issueAccountDeletionReauthenticationProof(userId: string, session: AccountDeletionReauthenticationSession) {
  if (!session.isCurrent()) return null;
  const { data, error } = await session.client.rpc('issue_account_deletion_reauth_proof', {
    p_target_user_id: userId,
  });
  if (error || !session.isCurrent()) return null;
  const row = asSingleRow(data);
  return parseAccountDeletionReauthIssueReceipt(row && {
    proofId: row.proof_id,
    expiresAt: row.expires_at,
  });
}

export const bearerTokenFromAuthorization = (value: string | null): string | null =>
  value?.startsWith('Bearer ') && value.length > 'Bearer '.length ? value.slice('Bearer '.length) : null;
