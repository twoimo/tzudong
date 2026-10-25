import { NextResponse } from 'next/server';
import {
  clearOnboardingCookies,
  clearRejectedOnboardingCookies,
  ONBOARDING_CHALLENGE_COOKIE,
  parseFreshPrivacyOnboardingConfirmationReceipt,
  readOnboardingChallenge,
  sha256,
} from '@/lib/privacy/onboarding';
import {
  getCurrentPrivacyEligibility,
  hasLivePrivacyEligibilityReceipt,
} from '@/lib/privacy/eligibility';
import { buildHomePrivacyOnboardingPath, getSafeAuthNextPath } from '@/lib/auth/auth-redirect';
import { getTrustedAuthCallbackOrigin } from '@/lib/auth/callback-origin';
import {
  createCallbackSupabaseClient,
  getCallbackSessionTokens,
  revokeRejectedCallbackSession,
} from '@/lib/auth/callback-session';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OAUTH_CODE_LENGTH = 2048;
const MAX_CALLBACK_VALUE_LENGTH = 2048;
const CALLBACK_QUERY_KEYS = new Set([
  'code',
  'next',
  'error',
  'error_code',
  'error_description',
]);

type CallbackQuery = Readonly<{
  code: string | null;
  next: string;
  providerError: boolean;
}>;

function parseCallbackQuery(searchParams: URLSearchParams): CallbackQuery | null {
  const entries = [...searchParams.entries()];
  if (
    entries.length > CALLBACK_QUERY_KEYS.size
    || entries.some(([key, value]) =>
      !CALLBACK_QUERY_KEYS.has(key)
      || value.length > MAX_CALLBACK_VALUE_LENGTH
      || searchParams.getAll(key).length !== 1)
  ) {
    return null;
  }

  const code = searchParams.get('code');
  const providerError = ['error', 'error_code', 'error_description']
    .some((key) => searchParams.has(key));
  if (providerError) {
    return code === null
      ? { code: null, next: getSafeAuthNextPath(searchParams.get('next')), providerError: true }
      : null;
  }
  if (
    !code
    || code.length > MAX_OAUTH_CODE_LENGTH
    || /[\u0000-\u0020]/.test(code)
  ) {
    return null;
  }

  return {
    code,
    next: getSafeAuthNextPath(searchParams.get('next')),
    providerError: false,
  };
}

type CallbackSupabaseClient = Awaited<ReturnType<typeof createCallbackSupabaseClient>>;
type OnboardingChallenge = NonNullable<ReturnType<typeof readOnboardingChallenge>>;

async function callbackSessionResponse(supabase: CallbackSupabaseClient, path = '/') {
  const handoff = await getCallbackSessionTokens(supabase);
  const response = NextResponse.json({ ok: true, next: path, ...handoff });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  clearOnboardingCookies(response);
  return response;
}

function rejectedCallbackRedirect(request: Request, origin: string) {
  const response = request.method === 'POST'
    ? NextResponse.json({ ok: false, error: 'AUTH_CALLBACK_FAILED' }, { status: 400 })
    : NextResponse.redirect(`${getTrustedAuthCallbackOrigin(origin)}/`);
  response.headers.set('Cache-Control', 'no-store');
  clearRejectedOnboardingCookies(response, request);
  return response;
}


async function confirmOAuthOnboarding(
  challenge: OnboardingChallenge,
  userId: string,
) {
  if (!challenge.oauthNonce) return false;
  const admin = createSupabaseServiceRoleClient();
  const confirmationArgs = {
    p_challenge_id: challenge.challengeId,
    p_challenge_token: challenge.challengeToken,
    p_user_id: userId,
    p_source: 'oauth' as const,
    p_guardian_verification_id: null,
    p_oauth_nonce_hash: sha256(challenge.oauthNonce),
  };
  const { data, error } = await admin.rpc('confirm_privacy_onboarding', confirmationArgs);
  return error === null
    && parseFreshPrivacyOnboardingConfirmationReceipt(
      data,
      challenge.challengeId,
      userId,
      challenge.policyVersionId,
    ) !== null;
}

async function rejectOAuthCallbackSession(supabase: CallbackSupabaseClient) {
  await revokeRejectedCallbackSession(supabase);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const callback = parseCallbackQuery(searchParams);
  if (!callback || callback.providerError) return rejectedCallbackRedirect(request, origin);
  // A navigation response never publishes auth cookies. The new document
  // exchanges the one-use code only with its locally saved OAuth intent.
  const target = new URL('/auth/complete', getTrustedAuthCallbackOrigin(origin));
  target.searchParams.set('code', callback.code!);
  target.searchParams.set('next', callback.next);
  return NextResponse.redirect(target, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

export async function POST(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  if (searchParams.size || !isTrustedSameOriginMutation(request)
    || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return NextResponse.json({ ok: false, error: 'INVALID_CALLBACK_REQUEST' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  let callback: CallbackQuery | null = null;
  try {
    const input = await readBoundedJsonRequest(request, 8192);
    if (!input.ok) throw new Error();
    const body = input.value;
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['code', 'next'].includes(key))
      || !('code' in body) || typeof body.code !== 'string'
      || ('next' in body && typeof body.next !== 'string')) throw new Error();
    const query = new URLSearchParams({ code: body.code, next: 'next' in body ? body.next as string : '/' });
    callback = parseCallbackQuery(query);
  } catch { /* Invalid input never reaches the one-use exchange. */ }
  if (!callback || callback.providerError) return rejectedCallbackRedirect(request, origin);
  const challengeCookie = request.headers.get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ONBOARDING_CHALLENGE_COOKIE}=`))
    ?.slice(ONBOARDING_CHALLENGE_COOKIE.length + 1);
  const challenge = readOnboardingChallenge(challengeCookie);
  if (challengeCookie && !challenge) return rejectedCallbackRedirect(request, origin);
  const onboardingRequested = challenge?.intent === 'oauth';

  const { code, next } = callback;
  if (!code) return rejectedCallbackRedirect(request, origin);

  if (!onboardingRequested) {

    let supabase: CallbackSupabaseClient | null = null;
    try {
      supabase = await createCallbackSupabaseClient();
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        await revokeRejectedCallbackSession(supabase);
        return rejectedCallbackRedirect(request, origin);
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user?.id || !UUID_PATTERN.test(user.id)) {
        await revokeRejectedCallbackSession(supabase);
        return rejectedCallbackRedirect(request, origin);
      }
      const eligibility = await getCurrentPrivacyEligibility(supabase);
      if (!hasLivePrivacyEligibilityReceipt(eligibility)) {
        return await callbackSessionResponse(supabase, buildHomePrivacyOnboardingPath(next));
      }

      return await callbackSessionResponse(supabase, next);
    } catch {
      if (!supabase) return rejectedCallbackRedirect(request, origin);
      await revokeRejectedCallbackSession(supabase);
      return rejectedCallbackRedirect(request, origin);
    }
  }

  if (!challenge || !challenge.oauthNonce || challenge.origin !== origin) {
    return rejectedCallbackRedirect(request, origin);
  }

  let supabase: CallbackSupabaseClient | null = null;
  try {
    supabase = await createCallbackSupabaseClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      await rejectOAuthCallbackSession(supabase);
      return rejectedCallbackRedirect(request, origin);
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    const candidateUserId = typeof user?.id === 'string' && UUID_PATTERN.test(user.id)
      ? user.id
      : null;
    if (userError || !candidateUserId) {
      await rejectOAuthCallbackSession(supabase);
      return rejectedCallbackRedirect(request, origin);
    }
    const userId = candidateUserId;

    let confirmed = false;
    try {
      confirmed = await confirmOAuthOnboarding(challenge, userId);
    } catch {
      confirmed = false;
    }
    const eligibility = confirmed ? await getCurrentPrivacyEligibility(supabase) : null;
    if (
      !hasLivePrivacyEligibilityReceipt(eligibility)
      || eligibility.receipt.policyVersionId !== challenge.policyVersionId
      || eligibility.receipt.contentSha256 !== challenge.contentSha256
    ) {
      await rejectOAuthCallbackSession(supabase);
      return rejectedCallbackRedirect(request, origin);
    }

    return await callbackSessionResponse(supabase, next);
  } catch {
    if (!supabase) return rejectedCallbackRedirect(request, origin);
    await rejectOAuthCallbackSession(supabase);
    return rejectedCallbackRedirect(request, origin);
  }
}
