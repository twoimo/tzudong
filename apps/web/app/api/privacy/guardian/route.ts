import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import {
  guardianProviderErrorCode,
  MAX_GUARDIAN_REQUEST_BYTES,
  parseGuardianProviderEvent,
  parseGuardianStatusReceipt,
  parseGuardianVerificationReceipt,
  readGuardianProviderRuntime,
  verifyGuardianProviderSignature,
  GUARDIAN_PROVIDER_SIGNATURE_HEADER,
} from '@/lib/privacy/guardian';
import { isRecord } from '@/lib/privacy/onboarding';
import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from '@/lib/security/bounded-json-request';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PrivacyClient = Pick<SupabaseClient<Database>, 'auth' | 'rpc'>;

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function errorResponse(code: string, status: number) {
  return noStoreJson({ code }, { status });
}

async function authenticate(supabase: PrivacyClient) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || typeof user?.id !== 'string' || !UUID_PATTERN.test(user.id)) return null;
  return user.id;
}

export async function GET(request: NextRequest) {
  if ([...request.nextUrl.searchParams.keys()].length > 0) {
    return errorResponse('PRIVACY_INVALID_REQUEST', 400);
  }

  try {
    const supabase = await createClient();
    const userId = await authenticate(supabase);
    if (!userId) return errorResponse('PRIVACY_AUTH_REQUIRED', 401);

    const admin = createSupabaseServiceRoleClient();
    const { data, error } = await admin.rpc('read_privacy_guardian_status', {
      p_child_user_id: userId,
    });
    const receipt = error === null ? parseGuardianStatusReceipt(data, userId) : null;
    if (!receipt) return errorResponse('PRIVACY_GUARDIAN_REQUIRED', 403);
    return noStoreJson(receipt);
  } catch {
    return errorResponse('PRIVACY_GUARDIAN_PROVIDER_UNAVAILABLE', 503);
  }
}

export async function POST(request: NextRequest) {
  if ([...request.nextUrl.searchParams.keys()].length > 0) {
    return errorResponse('PRIVACY_INVALID_REQUEST', 400);
  }

  try {
    const runtime = readGuardianProviderRuntime();
    if (!runtime) return errorResponse('PRIVACY_GUARDIAN_PROVIDER_UNAVAILABLE', 503);

    const parsedBody = await readBoundedJsonRequest(request, MAX_GUARDIAN_REQUEST_BYTES);
    if (!parsedBody.ok) {
      return errorResponse(
        'PRIVACY_INVALID_REQUEST',
        parsedBody.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge ? 413 : 400,
      );
    }

    const event = parseGuardianProviderEvent(parsedBody.value);
    if (!event) return errorResponse('PRIVACY_INVALID_REQUEST', 400);
    if (!verifyGuardianProviderSignature(
      runtime.secret,
      event,
      request.headers.get(GUARDIAN_PROVIDER_SIGNATURE_HEADER),
    )) {
      return errorResponse('PRIVACY_INVALID_REQUEST', 403);
    }

    const admin = createSupabaseServiceRoleClient();
    const { data, error } = await admin.rpc('record_privacy_guardian_verification', {
      p_verification_id: event.verificationId,
      p_child_user_id: event.childUserId,
      p_status: event.status,
      p_provider: runtime.provider,
      p_provider_reference_hash: event.providerReferenceHash,
      p_verified_at: event.verifiedAt ?? null,
      p_expires_at: event.expiresAt ?? null,
    });
    if (error) {
      const mapped = guardianProviderErrorCode(error);
      return errorResponse(mapped.code, mapped.status);
    }
    if (!parseGuardianVerificationReceipt(data, event)) {
      return errorResponse('PRIVACY_GUARDIAN_READBACK_FAILED', 409);
    }

    if (event.requiredConsent) {
      const { data: consentResult, error: consentError } = await admin.rpc(
        'submit_guardian_privacy_consent',
        {
          p_purpose: 'privacy_required',
          p_channel: 'none',
          p_decision: event.requiredConsent.decision,
          p_policy_version_id: event.requiredConsent.policyVersionId,
          p_notice_sha256: event.requiredConsent.noticeSha256,
          p_guardian_verification_id: event.verificationId,
          p_idempotency_key: event.requiredConsent.idempotencyKey,
          p_correlation_id: event.requiredConsent.correlationId,
        },
      );
      if (consentError) {
        const mapped = guardianProviderErrorCode(consentError);
        return errorResponse(mapped.code, mapped.status);
      }
      if (!isRecord(consentResult) || consentResult.status !== 'applied') {
        return errorResponse('PRIVACY_GUARDIAN_READBACK_FAILED', 409);
      }
    }

    const { data: statusData, error: statusError } = await admin.rpc('read_privacy_guardian_status', {
      p_child_user_id: event.childUserId,
    });
    const status = statusError === null
      ? parseGuardianStatusReceipt(statusData, event.childUserId)
      : null;
    if (!status || status.guardianStatus !== event.status) {
      return errorResponse('PRIVACY_GUARDIAN_READBACK_FAILED', 409);
    }
    if (event.status === 'verified' && event.requiredConsent?.decision === 'granted' && !status.eligible) {
      return errorResponse('PRIVACY_GUARDIAN_READBACK_FAILED', 409);
    }
    if (event.status !== 'verified' && status.eligible) {
      return errorResponse('PRIVACY_GUARDIAN_READBACK_FAILED', 409);
    }

    return noStoreJson({
      receipt: 'PRIVACY_GUARDIAN_VERIFICATION_RECORDED',
      guardianStatus: status.guardianStatus,
      eligible: status.eligible,
    });
  } catch {
    return errorResponse('PRIVACY_GUARDIAN_PROVIDER_UNAVAILABLE', 503);
  }
}
