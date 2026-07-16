import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  clearOnboardingCookies,
  clearRejectedOnboardingCookies,
  ONBOARDING_CHALLENGE_COOKIE,
  readOnboardingChallenge,
  sha256,
} from '@/lib/privacy/onboarding';
import { getCurrentPrivacyEligibility } from '@/lib/privacy/eligibility';
import { getSafeAuthNextPath } from '@/lib/auth/auth-redirect';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const DEFAULT_PRODUCTION_REDIRECT_ORIGIN = 'https://www.tzudong.app';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOWER_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OAUTH_REJECTION_HOLD_REASON = 'ONBOARDING_OAUTH_REJECTED';

type CallbackSupabaseClient = Awaited<ReturnType<typeof createClient>>;
type OnboardingChallenge = NonNullable<ReturnType<typeof readOnboardingChallenge>>;
type SessionRevocationProof = Readonly<{ sessionAbsent: boolean }>;
type OAuthRejectionProof = Readonly<{
  sessionAbsent: boolean;
  holdRecorded: boolean;
}>;

function getTrustedRedirectOrigin(requestOrigin: string) {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredSiteUrl) {
    try {
      return new URL(configuredSiteUrl).origin;
    } catch {
      return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    try {
      return new URL(requestOrigin).origin;
    } catch {
      return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
    }
  }

  return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
}

function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => keys.includes(key));
}

function isExplicitAuthAbsenceError(error: unknown) {
  if (!isRecord(error)) return false;
  return (
    error.name === 'AuthSessionMissingError'
    && error.status === 400
    && error.code === undefined
  ) || (
    error.name === 'AuthApiError'
    && error.status === 404
    && error.code === 'user_not_found'
  );
}

function isExplicitAuthAbsence(user: unknown, error: unknown) {
  return user === null && (error === null || isExplicitAuthAbsenceError(error));
}

async function revokeRejectedCallbackSession(supabase: CallbackSupabaseClient): Promise<SessionRevocationProof> {
  try {
    await supabase.auth.signOut({ scope: 'global' });
  } catch {
    // Only the strict getUser readback below can prove that a session is absent.
  }

  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Only the strict getUser readback below can prove that a session is absent.
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    return { sessionAbsent: isExplicitAuthAbsence(user, error) };
  } catch {
    return { sessionAbsent: false };
  }
}

function compensationIdempotencyKey(challengeId: string, userId: string, reasonCode: string) {
  return sha256(`privacy-onboarding-compensation:v1:${challengeId}:${userId}:${reasonCode}`);
}

function isExactCompensationHoldReceipt(
  value: unknown,
  challengeId: string,
  userId: string,
  reasonCode: string,
) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'schemaVersion',
      'operationId',
      'challengeId',
      'userId',
      'status',
      'reasonCode',
      'auditId',
      'readback',
    ])
    || value.schemaVersion !== 1
    || typeof value.operationId !== 'string' || !UUID_PATTERN.test(value.operationId)
    || value.challengeId !== challengeId
    || value.userId !== userId
    || value.status !== 'held'
    || value.reasonCode !== reasonCode
    || typeof value.auditId !== 'string' || !UUID_PATTERN.test(value.auditId)
    || !isRecord(value.readback)
    || !hasExactKeys(value.readback, ['passed', 'holdRecorded', 'auditRecorded', 'active'])
  ) {
    return false;
  }

  return value.readback.passed === true
    && value.readback.holdRecorded === true
    && value.readback.auditRecorded === true
    && value.readback.active === true;
}

async function holdOAuthRejection(
  challenge: OnboardingChallenge,
  userId: string,
) {
  if (!UUID_PATTERN.test(userId)) return false;

  try {
    const admin = createSupabaseServiceRoleClient();
    const reasonCode = OAUTH_REJECTION_HOLD_REASON;
    const { data, error } = await admin.rpc('hold_privacy_onboarding_compensation', {
      p_challenge_id: challenge.challengeId,
      p_user_id: userId,
      p_reason_code: reasonCode,
      p_idempotency_key: compensationIdempotencyKey(challenge.challengeId, userId, reasonCode),
    });
    return error === null && isExactCompensationHoldReceipt(data, challenge.challengeId, userId, reasonCode);
  } catch {
    return false;
  }
}

async function rejectOAuthCallbackSession(
  challenge: OnboardingChallenge,
  userId: string,
  supabase: CallbackSupabaseClient,
): Promise<OAuthRejectionProof> {
  const session = await revokeRejectedCallbackSession(supabase);

  // OAuth responses provide no immutable per-operation creation provenance, so
  // a rejected callback is durably held rather than deleting or banning an identity.
  const holdRecorded = await holdOAuthRejection(challenge, userId);
  return { sessionAbsent: session.sessionAbsent, holdRecorded };
}

function redirectWithOnboardingCookiesCleared(origin: string, path = '/') {
  const response = NextResponse.redirect(`${getTrustedRedirectOrigin(origin)}${path}`);
  response.headers.set('Cache-Control', 'no-store');
  clearOnboardingCookies(response);
  return response;
}

function rejectedCallbackRedirect(request: Request, origin: string) {
  const response = NextResponse.redirect(`${getTrustedRedirectOrigin(origin)}/`);
  response.headers.set('Cache-Control', 'no-store');
  clearRejectedOnboardingCookies(response, request);
  return response;
}

function compensationHoldUnavailableResponse(request: Request) {
  const response = NextResponse.json({
    code: 'ONBOARDING_COMPENSATION_HOLD_UNAVAILABLE',
    message: '요청을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.',
  }, { status: 503 });
  response.headers.set('Cache-Control', 'no-store');
  clearRejectedOnboardingCookies(response, request);
  return response;
}

async function confirmOAuthOnboarding(
  challenge: OnboardingChallenge,
  userId: string,
) {
  const admin = createSupabaseServiceRoleClient();
  const { data, error } = await admin.rpc('confirm_privacy_onboarding', {
    p_challenge_id: challenge.challengeId,
    p_challenge_token: challenge.challengeToken,
    p_user_id: userId,
    p_source: 'oauth',
    p_guardian_verification_id: null,
  });
  if (error || !isRecord(data)) return false;

  const readback = isRecord(data.readback) ? data.readback : null;
  return data.schemaVersion === 1
    && data.operationId === challenge.challengeId
    && data.challengeId === challenge.challengeId
    && data.userId === userId
    && data.policyVersionId === challenge.policyVersionId
    && data.status === 'applied'
    && data.eligible === true
    && readback?.passed === true;
}

async function enforceRejectedOAuthCallback(
  challenge: OnboardingChallenge,
  userId: string,
  supabase: CallbackSupabaseClient,
) {
  const proof = await rejectOAuthCallbackSession(challenge, userId, supabase);
  return proof.sessionAbsent && proof.holdRecorded;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = getSafeAuthNextPath(searchParams.get('next'));
  const onboardingRequested = searchParams.get('onboarding') === '1';

  if (!onboardingRequested) {
    if (!code) return rejectedCallbackRedirect(request, origin);

    let supabase: CallbackSupabaseClient | null = null;
    try {
      supabase = await createClient();
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        const proof = await revokeRejectedCallbackSession(supabase);
        return proof.sessionAbsent
          ? rejectedCallbackRedirect(request, origin)
          : compensationHoldUnavailableResponse(request);
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      const eligibility = userError || !user?.id
        ? null
        : await getCurrentPrivacyEligibility(supabase);
      if (!eligibility?.eligible) {
        const proof = await revokeRejectedCallbackSession(supabase);
        return proof.sessionAbsent
          ? rejectedCallbackRedirect(request, origin)
          : compensationHoldUnavailableResponse(request);
      }

      return redirectWithOnboardingCookiesCleared(origin, next);
    } catch {
      if (!supabase) return rejectedCallbackRedirect(request, origin);
      const proof = await revokeRejectedCallbackSession(supabase);
      return proof.sessionAbsent
        ? rejectedCallbackRedirect(request, origin)
        : compensationHoldUnavailableResponse(request);
    }
  }

  const challenge = readOnboardingChallenge(request.headers.get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ONBOARDING_CHALLENGE_COOKIE}=`))
    ?.slice(ONBOARDING_CHALLENGE_COOKIE.length + 1));
  const returnedNonce = searchParams.get('onboarding_nonce');
  if (
    !code
    || !challenge
    || challenge.intent !== 'oauth'
    || !challenge.oauthNonce
    || !returnedNonce
    || !LOWER_SHA256_PATTERN.test(returnedNonce)
    || !safeEquals(challenge.oauthNonce, returnedNonce)
  ) {
    return rejectedCallbackRedirect(request, origin);
  }

  let supabase: CallbackSupabaseClient | null = null;
  let userId: string | null = null;
  try {
    supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      const proof = await revokeRejectedCallbackSession(supabase);
      return proof.sessionAbsent
        ? rejectedCallbackRedirect(request, origin)
        : compensationHoldUnavailableResponse(request);
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    const candidateUserId = typeof user?.id === 'string' && UUID_PATTERN.test(user.id)
      ? user.id
      : null;
    if (userError || !candidateUserId) {
      if (candidateUserId) {
        return await enforceRejectedOAuthCallback(challenge, candidateUserId, supabase)
          ? rejectedCallbackRedirect(request, origin)
          : compensationHoldUnavailableResponse(request);
      }
      const proof = await revokeRejectedCallbackSession(supabase);
      return proof.sessionAbsent
        ? rejectedCallbackRedirect(request, origin)
        : compensationHoldUnavailableResponse(request);
    }
    userId = candidateUserId;

    let confirmed = false;
    try {
      confirmed = await confirmOAuthOnboarding(challenge, userId);
    } catch {
      confirmed = false;
    }
    const eligibility = confirmed ? await getCurrentPrivacyEligibility(supabase) : null;
    if (
      !eligibility?.eligible
      || eligibility.receipt?.policyVersionId !== challenge.policyVersionId
      || eligibility.receipt?.contentSha256 !== challenge.contentSha256
    ) {
      return await enforceRejectedOAuthCallback(challenge, userId, supabase)
        ? rejectedCallbackRedirect(request, origin)
        : compensationHoldUnavailableResponse(request);
    }

    return redirectWithOnboardingCookiesCleared(origin, next);
  } catch {
    if (!supabase) return rejectedCallbackRedirect(request, origin);
    if (!userId) {
      const proof = await revokeRejectedCallbackSession(supabase);
      return proof.sessionAbsent
        ? rejectedCallbackRedirect(request, origin)
        : compensationHoldUnavailableResponse(request);
    }
    return await enforceRejectedOAuthCallback(challenge, userId, supabase)
      ? rejectedCallbackRedirect(request, origin)
      : compensationHoldUnavailableResponse(request);
  }
}
