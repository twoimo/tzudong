import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import { asSingleRow, parseAccountDeletionPreview } from '@/lib/privacy/account-deletion-reauth';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

export const runtime = 'nodejs';

type DeletionApplyInput = {
  userId?: unknown;
  proofId?: unknown;
  requestId?: unknown;
  previewHash?: unknown;
  confirmationText?: unknown;
  idempotencyKey?: unknown;
  sourceManifestHash?: unknown;
};

type DeletionBeginRow = {
  request_id?: unknown;
  status?: unknown;
  db_readback_passed?: unknown;
  storage_readback_passed?: unknown;
  session_readback_passed?: unknown;
  auth_readback_passed?: unknown;
};

type DeletionFailureCode =
  | 'account_deletion_reauth_proof_invalid_claims'
  | 'account_deletion_reauth_proof_not_available'
  | 'account_deletion_reauth_proof_password_reauthentication_required'
  | 'account_deletion_reauthentication_required'
  | 'account_deletion_apply_not_started';

const deletionFailureResponses: Record<DeletionFailureCode, { error: string; reasonCode: DeletionFailureCode; status: number }> = {
  account_deletion_reauth_proof_invalid_claims: { error: 'Fresh self authentication is required.', reasonCode: 'account_deletion_reauth_proof_invalid_claims', status: 403 },
  account_deletion_reauth_proof_not_available: { error: 'Account deletion reauthentication has expired or was already used.', reasonCode: 'account_deletion_reauth_proof_not_available', status: 409 },
  account_deletion_reauth_proof_password_reauthentication_required: { error: 'Fresh self authentication is required.', reasonCode: 'account_deletion_reauth_proof_password_reauthentication_required', status: 403 },
  account_deletion_reauthentication_required: { error: 'Fresh self authentication is required.', reasonCode: 'account_deletion_reauthentication_required', status: 403 },
  account_deletion_apply_not_started: { error: 'Account deletion could not be started.', reasonCode: 'account_deletion_apply_not_started', status: 409 },
};

function failureResponse(value: unknown) {
  if (typeof value !== 'string' || !Object.hasOwn(deletionFailureResponses, value)) {
    return NextResponse.json({ error: 'Server error.', reasonCode: 'account_deletion_server_error' }, { status: 500 });
  }
  const failure = deletionFailureResponses[value as DeletionFailureCode];
  return NextResponse.json({ error: failure.error, reasonCode: failure.reasonCode }, { status: failure.status });
}

function rpcFailureCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const details = error as { message?: unknown; code?: unknown };
  return typeof details.message === 'string'
    ? details.message
    : typeof details.code === 'string'
      ? details.code
      : null;
}

function readRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasExactKeys(body: unknown, keys: string[]): body is Record<string, unknown> {
  return !!body && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).length === keys.length && keys.every((key) => Object.hasOwn(body, key));
}

function parseBearerToken(request: NextRequest): string | null {
  const value = request.headers.get('Authorization');
  if (!value?.startsWith('Bearer ')) return null;
  return readRequiredString(value.slice('Bearer '.length));
}

function isSameOrigin(request: NextRequest): boolean {
  return request.headers.get('Origin') === request.nextUrl.origin;
}

function isAuthoritativeBeginRow(value: unknown, requestId: string): value is DeletionBeginRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as DeletionBeginRow;
  return row.request_id === requestId && typeof row.status === 'string' &&
    typeof row.db_readback_passed === 'boolean' && typeof row.storage_readback_passed === 'boolean' &&
    typeof row.session_readback_passed === 'boolean' && typeof row.auth_readback_passed === 'boolean';
}

function createBearerClient(bearerToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase environment variables are missing.');
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${bearerToken}` } },
  });
}

function parseApplyInput(body: DeletionApplyInput) {
  const userId = readRequiredString(body.userId);
  const proofId = readRequiredString(body.proofId);
  const requestId = readRequiredString(body.requestId);
  const previewHash = readRequiredString(body.previewHash);
  const confirmationText = readRequiredString(body.confirmationText);
  const idempotencyKey = readRequiredString(body.idempotencyKey);
  const sourceManifestHash = readRequiredString(body.sourceManifestHash);
  return userId && proofId && requestId && previewHash && confirmationText && idempotencyKey && sourceManifestHash
    ? { userId, proofId, requestId, previewHash, confirmationText, idempotencyKey, sourceManifestHash }
    : null;
}

async function verifySelfBearer(bearerToken: string, targetUserId: string) {
  const supabaseAdmin = createSupabaseServiceRoleClient();
  const [{ data: userData, error: userError }, { data: claimsData, error: claimsError }] = await Promise.all([
    supabaseAdmin.auth.getUser(bearerToken),
    supabaseAdmin.auth.getClaims(bearerToken),
  ]);
  const sub = claimsData?.claims?.sub;
  const user = userData.user;
  return !userError && !claimsError && user?.id === targetUserId && sub === targetUserId ? user : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!isSameOrigin(request) || !hasExactKeys(body, ['targetUserId'])) {
      return NextResponse.json({ error: 'Invalid account deletion preview request.', reasonCode: 'account_deletion_preview_request_invalid' }, { status: 400 });
    }
    const targetUserId = readRequiredString(body.targetUserId);
    const bearerToken = parseBearerToken(request);
    if (!targetUserId || !bearerToken) return NextResponse.json({ error: 'Authentication is required.', reasonCode: 'account_deletion_authentication_required' }, { status: 401 });

    const verifiedUser = await verifySelfBearer(bearerToken, targetUserId);
    if (!verifiedUser?.last_sign_in_at) return NextResponse.json({ error: 'Fresh self authentication is required.', reasonCode: 'account_deletion_reauthentication_required' }, { status: 403 });

    const supabaseAdmin = createSupabaseServiceRoleClient();
    const { data, error } = await supabaseAdmin.rpc('preview_account_deletion', {
      p_actor_user_id: targetUserId,
      p_target_user_id: targetUserId,
      p_reauthenticated_at: verifiedUser.last_sign_in_at,
    });
    const preview = parseAccountDeletionPreview(asSingleRow(data));
    if (error || !preview) return NextResponse.json({ error: 'Account deletion preview could not be created.', reasonCode: 'account_deletion_preview_not_available' }, { status: 409 });

    return NextResponse.json({ preview }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Server error.', reasonCode: 'account_deletion_server_error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!isSameOrigin(request) || !hasExactKeys(body, ['userId', 'proofId', 'requestId', 'previewHash', 'confirmationText', 'idempotencyKey', 'sourceManifestHash'])) {
      return NextResponse.json({ error: 'Invalid account deletion request.', reasonCode: 'account_deletion_request_invalid' }, { status: 400 });
    }
    const input = parseApplyInput(body);
    const bearerToken = parseBearerToken(request);
    if (!input || !bearerToken) return NextResponse.json({ error: 'Authentication is required.', reasonCode: 'account_deletion_authentication_required' }, { status: 401 });
    if (!await verifySelfBearer(bearerToken, input.userId)) {
      return NextResponse.json({ error: 'Self account deletion is required.', reasonCode: 'account_deletion_self_required' }, { status: 403 });
    }

    const supabase = createBearerClient(bearerToken);
    const { data, error } = await supabase.rpc('begin_account_deletion_apply_with_reauth', {
      p_proof_id: input.proofId,
      p_actor_user_id: input.userId,
      p_target_user_id: input.userId,
      p_request_id: input.requestId,
      p_preview_hash: input.previewHash,
      p_confirmation_text: input.confirmationText,
      p_idempotency_key: input.idempotencyKey,
      p_source_manifest_hash: input.sourceManifestHash,
    });
    const begin = asSingleRow(data);
    if (error) return failureResponse(rpcFailureCode(error));
    if (!isAuthoritativeBeginRow(begin, input.requestId)) {
      return NextResponse.json({ error: 'Server error.', reasonCode: 'account_deletion_server_error' }, { status: 500 });
    }
    if (begin.status !== 'APPLY_STARTED') {
      return failureResponse('account_deletion_apply_not_started');
    }
    return NextResponse.json({ success: true, begin }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Server error.', reasonCode: 'account_deletion_server_error' }, { status: 500 });
  }
}
