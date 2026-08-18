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
import {
  createCallbackSupabaseClient,
  revokeRejectedCallbackSession,
} from '@/lib/auth/callback-session';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

export const runtime = 'nodejs';

const DEFAULT_PRODUCTION_REDIRECT_ORIGIN = 'https://www.tzudong.app';
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
        return redirectWithOnboardingCookiesCleared(origin, buildHomePrivacyOnboardingPath());
      }

      return redirectWithOnboardingCookiesCleared(origin, next);
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

    return redirectWithOnboardingCookiesCleared(origin, next);
  } catch {
    if (!supabase) return rejectedCallbackRedirect(request, origin);
    await rejectOAuthCallbackSession(supabase);
    return rejectedCallbackRedirect(request, origin);
  }
}
