import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import {
  PRIVACY_POLICY_CONTENT_SHA256,
  PRIVACY_POLICY_VERSION,
} from '@/lib/privacy/policy';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const PRIVACY_ELIGIBILITY_REASON_CODES = [
  'PRIVACY_ELIGIBLE',
  'PRIVACY_POLICY_UNAVAILABLE',
  'PRIVACY_AGE_ATTESTATION_REQUIRED',
  'PRIVACY_POLICY_REATTESTATION_REQUIRED',
  'PRIVACY_AGE_BLOCKED',
  'PRIVACY_GUARDIAN_REQUIRED',
  'PRIVACY_GUARDIAN_CONSENT_REQUIRED',
] as const;

export type PrivacyEligibilityReasonCode = typeof PRIVACY_ELIGIBILITY_REASON_CODES[number];

export type PrivacyEligibilityReceipt = Readonly<{
  schemaVersion: 1;
  eligible: boolean;
  reasonCode: PrivacyEligibilityReasonCode;
  policyVersionId: string | null;
  policyVersion: string | null;
  contentSha256: string | null;
}>;

export type CurrentPrivacyEligibility = Readonly<{
  eligible: boolean;
  reasonCode: PrivacyEligibilityReasonCode | null;
  receipt: PrivacyEligibilityReceipt | null;
}>;
export type PrivacyEligibilityPolicyBinding = Readonly<{
  policyVersionId: string;
  contentSha256: string;
}>;

type CurrentPrivacyEligibilityRpcClient = Readonly<{
  rpc: (functionName: 'get_current_privacy_eligibility') => Promise<Readonly<{
    data: unknown;
    error: unknown;
  }>>;
}>;

type ServicePrivacyEligibilityRpcClient = Readonly<{
  rpc: (
    functionName: 'get_privacy_eligibility_for_user',
    args: Readonly<{ p_user_id: string }>,
  ) => Promise<Readonly<{
    data: unknown;
    error: unknown;
  }>>;
}>;

const RECEIPT_KEYS = [
  'schemaVersion',
  'eligible',
  'reasonCode',
  'policyVersionId',
  'contentSha256',
  'policyVersion',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isExplicitAuthSessionMissingError(error: unknown) {
  return isRecord(error) && error.name === 'AuthSessionMissingError';
}

function hasExactReceiptKeys(value: Record<string, unknown>) {
  const keys = Object.keys(value);
  return keys.length === RECEIPT_KEYS.length
    && RECEIPT_KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isReasonCode(value: unknown): value is PrivacyEligibilityReasonCode {
  return typeof value === 'string'
    && PRIVACY_ELIGIBILITY_REASON_CODES.some((reasonCode) => reasonCode === value);
}

export function parsePrivacyEligibilityReceipt(value: unknown): PrivacyEligibilityReceipt | null {
  if (!isRecord(value) || !hasExactReceiptKeys(value)) return null;

  const { schemaVersion, eligible, reasonCode, policyVersionId, policyVersion, contentSha256 } = value;
  if (schemaVersion !== 1 || typeof eligible !== 'boolean' || !isReasonCode(reasonCode)) return null;
  if (policyVersionId !== null && (typeof policyVersionId !== 'string' || !UUID_PATTERN.test(policyVersionId))) {
    return null;
  }
  if (policyVersion !== null && (typeof policyVersion !== 'string' || policyVersion !== PRIVACY_POLICY_VERSION)) {
    return null;
  }
  if (contentSha256 !== null && (typeof contentSha256 !== 'string' || !SHA256_PATTERN.test(contentSha256))) {
    return null;
  }

  if (reasonCode === 'PRIVACY_POLICY_UNAVAILABLE') {
    return !eligible && policyVersionId === null && policyVersion === null && contentSha256 === null
      ? { schemaVersion, eligible, reasonCode, policyVersionId, policyVersion, contentSha256 }
      : null;
  }

  if (!policyVersionId || policyVersion !== PRIVACY_POLICY_VERSION || !contentSha256 || eligible !== (reasonCode === 'PRIVACY_ELIGIBLE')) {
    return null;
  }

  return { schemaVersion, eligible, reasonCode, policyVersionId, policyVersion, contentSha256 };
}
export function privacyEligibilityMatchesPolicy(
  receipt: PrivacyEligibilityReceipt | null,
  policy: PrivacyEligibilityPolicyBinding,
) {
  return receipt?.policyVersionId === policy.policyVersionId
    && receipt?.contentSha256 === policy.contentSha256;
}
export function hasLivePrivacyEligibilityReceipt(
  eligibility: CurrentPrivacyEligibility | null,
): eligibility is CurrentPrivacyEligibility & Readonly<{
  eligible: true;
  reasonCode: 'PRIVACY_ELIGIBLE';
  receipt: PrivacyEligibilityReceipt & Readonly<{
    eligible: true;
    reasonCode: 'PRIVACY_ELIGIBLE';
    policyVersionId: string;
    contentSha256: string;
  }>;
}> {
  const receipt = eligibility?.receipt;
  return eligibility !== null
    && eligibility.eligible === true
    && eligibility.reasonCode === 'PRIVACY_ELIGIBLE'
    && receipt?.schemaVersion === 1
    && receipt.eligible === true
    && receipt.reasonCode === 'PRIVACY_ELIGIBLE'
    && typeof receipt.policyVersionId === 'string'
    && UUID_PATTERN.test(receipt.policyVersionId)
    && typeof receipt.contentSha256 === 'string'
    && receipt.policyVersion === PRIVACY_POLICY_VERSION
    && receipt.contentSha256 === PRIVACY_POLICY_CONTENT_SHA256
    && SHA256_PATTERN.test(receipt.contentSha256);
}

/**
 * Generated database types do not yet include the G014 RPCs. Keep the temporary
 * structural RPC boundary here so callers remain fully typed and fail closed.
 */
export async function getCurrentPrivacyEligibility(
  client: SupabaseClient<Database>,
): Promise<CurrentPrivacyEligibility> {
  const rpcClient = client as unknown as CurrentPrivacyEligibilityRpcClient;

  try {
    const { data, error } = await rpcClient.rpc('get_current_privacy_eligibility');
    const receipt = error === null ? parsePrivacyEligibilityReceipt(data) : null;
    return {
      eligible: receipt?.eligible === true && receipt?.reasonCode === 'PRIVACY_ELIGIBLE',
      reasonCode: receipt?.reasonCode ?? null,
      receipt,
    };
  } catch {
    return { eligible: false, reasonCode: null, receipt: null };
  }
}

export async function getPrivacyEligibilityForUser(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<CurrentPrivacyEligibility> {
  if (!UUID_PATTERN.test(userId)) {
    return { eligible: false, reasonCode: null, receipt: null };
  }

  const rpcClient = client as unknown as ServicePrivacyEligibilityRpcClient;
  try {
    const { data, error } = await rpcClient.rpc('get_privacy_eligibility_for_user', {
      p_user_id: userId,
    });
    const receipt = error === null ? parsePrivacyEligibilityReceipt(data) : null;
    return {
      eligible: receipt?.eligible === true && receipt?.reasonCode === 'PRIVACY_ELIGIBLE',
      reasonCode: receipt?.reasonCode ?? null,
      receipt,
    };
  } catch {
    return { eligible: false, reasonCode: null, receipt: null };
  }
}

export async function signOutRejectedPrivacySession(client: SupabaseClient<Database>) {
  try {
    await client.auth.signOut({ scope: 'global' });
  } catch {
    // A local sign-out below still clears this browser when global revocation is unavailable.
  }

  try {
    await client.auth.signOut({ scope: 'local' });
  } catch {
    // The readback below remains fail closed even when local cookie cleanup fails.
  }

  try {
    const { data: { user }, error } = await client.auth.getUser();
    return user === null && (error === null || isExplicitAuthSessionMissingError(error));
  } catch {
    return false;
  }
}

export function privacyEligibilityGuidance(reasonCode: PrivacyEligibilityReasonCode | null) {
  switch (reasonCode) {
    case 'PRIVACY_POLICY_UNAVAILABLE':
      return '현재 개인정보 처리방침을 확인할 수 없어 이용할 수 없습니다. 잠시 후 다시 시도해주세요.';
    case 'PRIVACY_AGE_ATTESTATION_REQUIRED':
      return '연령 및 개인정보 처리방침 확인을 완료한 뒤 이용할 수 있습니다.';
    case 'PRIVACY_POLICY_REATTESTATION_REQUIRED':
      return '최신 개인정보 처리방침 재동의가 필요합니다.';
    case 'PRIVACY_AGE_BLOCKED':
      return '현재 계정은 개인정보 보호 정책에 따라 이용할 수 없습니다.';
    case 'PRIVACY_GUARDIAN_REQUIRED':
      return '보호자 확인이 완료되기 전에는 이용할 수 없습니다.';
    case 'PRIVACY_GUARDIAN_CONSENT_REQUIRED':
      return '유효한 보호자 동의가 확인되기 전에는 이용할 수 없습니다.';
    default:
      return '로그인 정보를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.';
  }
}
