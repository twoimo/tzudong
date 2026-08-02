import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  clearOnboardingCookies,
  clearRejectedOnboardingCookies,
  ONBOARDING_CHALLENGE_COOKIE,
  parseFreshPrivacyOnboardingConfirmationReceipt,
  readOnboardingChallenge,
  sha256,
} from '@/lib/privacy/onboarding';
import { getSafeAuthNextPath } from '@/lib/auth/auth-redirect';
import {
  getCurrentPrivacyEligibility,
  hasLivePrivacyEligibilityReceipt,
} from '@/lib/privacy/eligibility';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createClient } from '@/lib/supabase/server';
import {
  emitPrivacyAuthEventFromServerEnvironment,
  type PrivacyAuthEventInput,
} from '@/lib/observability/privacy-auth-events';
import {
  PRIVACY_POLICY_CONTENT_SHA256,
  PRIVACY_POLICY_VERSION,
} from '@/lib/privacy/policy';

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
  'flow',
]);

type CallbackQuery = Readonly<{
  code: string | null;
  next: string;
  providerError: boolean;
  flow: string | null;
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
  const flow = searchParams.get('flow');
  const providerError = ['error', 'error_code', 'error_description']
    .some((key) => searchParams.has(key));
  if (providerError) {
    return code === null
      ? {
          code: null,
          next: getSafeAuthNextPath(searchParams.get('next')),
          providerError: true,
          flow,
        }
      : null;
  }
  if (
    !code
    || code.length > MAX_OAUTH_CODE_LENGTH
    || /[\u0000-\u0020]/.test(code)
    || (flow !== null && !/^[0-9a-f]{64}$/.test(flow))
  ) {
    return null;
  }

  return {
    code,
    next: getSafeAuthNextPath(searchParams.get('next')),
    providerError: false,
    flow,
  };
}
function emitCallbackPrivacyAuthEvent(
  outcomeReason: Extract<PrivacyAuthEventInput['outcomeReason'], 'admitted' | 'onboarding_required' | 'failed'>,
  correlationId: string,
) {
  try {
    emitPrivacyAuthEventFromServerEnvironment({
      event: 'auth_callback',
      policyVersion: PRIVACY_POLICY_VERSION,
      policySha: PRIVACY_POLICY_CONTENT_SHA256,
      routeClass: 'loop_safe_api',
      provider: 'oauth',
      outcomeReason,
      correlationId,
      subjectDigest: null,
    });
  } catch {
    // Telemetry must not affect OAuth callback handling.
  }
}


type CallbackSupabaseClient = Awaited<ReturnType<typeof createClient>>;
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




async function revokeRejectedCallbackSession(supabase: CallbackSupabaseClient) {
  try {
    await supabase.auth.signOut({ scope: 'global' });
  } catch {
    // A rejected callback must still attempt local cookie cleanup.
  }

  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // The rejection redirect clears onboarding and browser auth cookies.
  }
}

function clearOAuthTransaction(response: NextResponse) {
  response.cookies.set({
    name: OAUTH_TRANSACTION_COOKIE,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

function redirectWithOnboardingCookiesCleared(origin: string, path = '/') {
  const response = NextResponse.redirect(`${getTrustedRedirectOrigin(origin)}${path}`);
  response.headers.set('Cache-Control', 'no-store');
  clearOnboardingCookies(response);
  clearOAuthTransaction(response);
  return response;
}

function rejectedCallbackRedirect(request: Request, origin: string) {
  const response = NextResponse.redirect(`${getTrustedRedirectOrigin(origin)}/`);
  response.headers.set('Cache-Control', 'no-store');
  clearRejectedOnboardingCookies(response, request);
  clearOAuthTransaction(response);
  return response;
}


const OAUTH_TRANSACTION_COOKIE = 'tzudong_oauth_transaction';

type OAuthTransaction = Readonly<{
  version: 1;
  flow: string;
  correlationId: string;
  intent: 'login' | 'signup';
  challengeId: string | null;
  challengeTokenDigest: string | null;
  next: string;
  expiresAt: number;
}>;

function readOAuthTransaction(value: string | undefined): OAuthTransaction | null {
  const secret = process.env.PRIVACY_ONBOARDING_COOKIE_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32 || !value) return null;
  const [encoded, signature, ...extra] = value.split('.');
  if (!encoded || !signature || extra.length !== 0) return null;
  const expected = createHmac('sha256', secret).update(encoded, 'utf8').digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
      !payload
      || typeof payload !== 'object'
      || Array.isArray(payload)
      || Object.keys(payload).length !== 8
    ) return null;
    const transaction = payload as OAuthTransaction;
    return transaction.version === 1
      && /^[0-9a-f]{64}$/.test(transaction.flow)
      && UUID_PATTERN.test(transaction.correlationId)
      && (transaction.intent === 'login' || transaction.intent === 'signup')
      && (transaction.challengeId === null || UUID_PATTERN.test(transaction.challengeId))
      && (transaction.challengeTokenDigest === null || /^[0-9a-f]{64}$/.test(transaction.challengeTokenDigest))
      && (transaction.intent === 'signup'
        ? transaction.challengeId !== null && transaction.challengeTokenDigest !== null
        : transaction.challengeId === null && transaction.challengeTokenDigest === null)
      && typeof transaction.next === 'string'
      && transaction.next === getSafeAuthNextPath(transaction.next)
      && typeof transaction.expiresAt === 'number'
      && Number.isSafeInteger(transaction.expiresAt)
      && transaction.expiresAt > Date.now()
      ? transaction
      : null;
  } catch {
    return null;
  }
}

function requestCookie(request: Request, name: string) {
  return request.headers.get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function matchingOAuthTransaction(
  transaction: OAuthTransaction | null,
  challenge: OnboardingChallenge | null,
  callback: CallbackQuery,
) {
  return transaction !== null
    && challenge !== null
    && callback.flow !== null
    && transaction.flow === callback.flow
    && transaction.next === callback.next
    && transaction.challengeId === challenge.challengeId
    && transaction.challengeTokenDigest === sha256(challenge.challengeToken);
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
  const freshCorrelationId = randomUUID();
  const callback = parseCallbackQuery(searchParams);
  if (!callback) {
    emitCallbackPrivacyAuthEvent('failed', freshCorrelationId);
    return rejectedCallbackRedirect(request, origin);
  }

  const transaction = readOAuthTransaction(requestCookie(request, OAUTH_TRANSACTION_COOKIE));
  if (
    !transaction
    || callback.flow === null
    || transaction.flow !== callback.flow
    || transaction.next !== callback.next
  ) {
    emitCallbackPrivacyAuthEvent('failed', freshCorrelationId);
    return rejectedCallbackRedirect(request, origin);
  }
  const correlationId = transaction.correlationId;
  const challengeCookie = requestCookie(request, ONBOARDING_CHALLENGE_COOKIE);
  const challenge = readOnboardingChallenge(challengeCookie);
  if (challengeCookie && !challenge) {
    emitCallbackPrivacyAuthEvent('failed', correlationId);
    return rejectedCallbackRedirect(request, origin);
  }

  const onboardingRequested = transaction.intent === 'signup';
  if (onboardingRequested && (
    challenge?.intent !== 'oauth'
    || !challenge.oauthNonce
    || challenge.origin !== origin
    || !matchingOAuthTransaction(transaction, challenge, callback)
  )) {
    emitCallbackPrivacyAuthEvent('failed', correlationId);
    return rejectedCallbackRedirect(request, origin);
  }
  if (callback.providerError || !callback.code) {
    emitCallbackPrivacyAuthEvent('failed', correlationId);
    return rejectedCallbackRedirect(request, origin);
  }

  const { code, next } = callback;
  if (!onboardingRequested) {
    let supabase: CallbackSupabaseClient | null = null;
    try {
      supabase = await createClient();
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        await revokeRejectedCallbackSession(supabase);
        emitCallbackPrivacyAuthEvent('failed', correlationId);
        return rejectedCallbackRedirect(request, origin);
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user?.id || !UUID_PATTERN.test(user.id)) {
        await revokeRejectedCallbackSession(supabase);
        emitCallbackPrivacyAuthEvent('failed', correlationId);
        return rejectedCallbackRedirect(request, origin);
      }
      const eligibility = await getCurrentPrivacyEligibility(supabase);
      if (!hasLivePrivacyEligibilityReceipt(eligibility)) {
        emitCallbackPrivacyAuthEvent('onboarding_required', correlationId);
        return redirectWithOnboardingCookiesCleared(origin, '/privacy/onboarding');
      }

      emitCallbackPrivacyAuthEvent('admitted', correlationId);
      return redirectWithOnboardingCookiesCleared(origin, next);
    } catch {
      if (supabase) await revokeRejectedCallbackSession(supabase);
      emitCallbackPrivacyAuthEvent('failed', correlationId);
      return rejectedCallbackRedirect(request, origin);
    }
  }

  if (!challenge || !challenge.oauthNonce || challenge.origin !== origin) {
    emitCallbackPrivacyAuthEvent('failed', freshCorrelationId);
    return rejectedCallbackRedirect(request, origin);
  }

  let supabase: CallbackSupabaseClient | null = null;
  try {
    supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      await rejectOAuthCallbackSession(supabase);
      emitCallbackPrivacyAuthEvent('failed', correlationId);
      return rejectedCallbackRedirect(request, origin);
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    const candidateUserId = typeof user?.id === 'string' && UUID_PATTERN.test(user.id)
      ? user.id
      : null;
    if (userError || !candidateUserId) {
      await rejectOAuthCallbackSession(supabase);
      emitCallbackPrivacyAuthEvent('failed', correlationId);
      return rejectedCallbackRedirect(request, origin);
    }

    let confirmed = false;
    try {
      confirmed = await confirmOAuthOnboarding(challenge, candidateUserId);
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
      emitCallbackPrivacyAuthEvent('failed', correlationId);
      return rejectedCallbackRedirect(request, origin);
    }

    emitCallbackPrivacyAuthEvent('admitted', correlationId);
    return redirectWithOnboardingCookiesCleared(origin, next);
  } catch {
    if (supabase) await rejectOAuthCallbackSession(supabase);
    emitCallbackPrivacyAuthEvent('failed', correlationId);
    return rejectedCallbackRedirect(request, origin);
  }
}
