import { supabase } from '@/integrations/supabase/client';

export type AccountDeletionPreview = {
  previewHash: string;
  sourceManifestHash: string;
  deleteCount: number;
  anonymizeCount: number;
  separateCount: number;
  retainCount: number;
};

type ReauthenticationSession = {
  bearerToken: string;
};

type ReauthenticationProof = {
  proofId: string;
  expiresAt: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function asSingleRow(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) && value.length === 1 && value[0] !== null && typeof value[0] === 'object'
    ? value[0] as Record<string, unknown>
    : null;
}

export function parseAccountDeletionPreview(value: unknown): AccountDeletionPreview | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    !isNonEmptyString(row.preview_hash) ||
    !isNonEmptyString(row.source_manifest_hash) ||
    !isNonNegativeInteger(row.delete_count) ||
    !isNonNegativeInteger(row.anonymize_count) ||
    !isNonNegativeInteger(row.separate_count) ||
    !isNonNegativeInteger(row.retain_count)
  ) return null;

  return {
    previewHash: row.preview_hash,
    sourceManifestHash: row.source_manifest_hash,
    deleteCount: row.delete_count,
    anonymizeCount: row.anonymize_count,
    separateCount: row.separate_count,
    retainCount: row.retain_count,
  };
}


export async function createAccountDeletionReauthenticationSession(input: {
  userId: string;
  email: string;
  password: string;
}): Promise<ReauthenticationSession> {
  const { userId, email, password } = input;
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !signInData.session || signInData.user?.id !== userId) {
    throw new Error('현재 비밀번호 재확인이 필요합니다.');
  }

  return { bearerToken: signInData.session.access_token };
}

export async function issueAccountDeletionReauthenticationProof(input: {
  userId: string;
}): Promise<ReauthenticationProof> {
  const { data: proofRows, error: proofError } = await supabase.rpc(
    'issue_account_deletion_reauth_proof',
    { p_target_user_id: input.userId },
  );
  const proof = asSingleRow(proofRows);
  const proofId = proof?.proof_id;
  const expiresAt = proof?.expires_at;

  if (proofError || !isNonEmptyString(proofId) || !isNonEmptyString(expiresAt)) {
    throw new Error('계정 삭제 재인증 증명 발급에 실패했습니다.');
  }

  return { proofId, expiresAt };
}
