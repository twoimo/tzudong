import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  clearOnboardingCookies,
  ONBOARDING_CHALLENGE_COOKIE,
  readOnboardingChallenge,
  sha256,
} from '@/lib/privacy/onboarding';
import { getSafeAuthNextPath } from '@/lib/auth/auth-redirect';
import { createClientForCookieStore } from '@/lib/supabase/server';
import {
  emitPrivacyAuthEventFromServerEnvironment,
  type PrivacyAuthEventInput,
} from '@/lib/observability/privacy-auth-events';
import {
  PRIVACY_POLICY_CONTENT_SHA256,
  PRIVACY_POLICY_VERSION,
} from '@/lib/privacy/policy';

export const runtime = 'nodejs';

const OAUTH_TRANSACTION_COOKIE = 'tzudong_oauth_transaction';
const OAUTH_TRANSACTION_TTL_SECONDS = 10 * 60;
const DEFAULT_PRODUCTION_REDIRECT_ORIGIN = 'https://www.tzudong.app';

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

type CookieWrite = Readonly<{ name: string; value: string; options: Record<string, unknown> }>;

function trustedOrigin(requestOrigin: string) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
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

function requestCookie(request: Request, name: string) {
  return request.headers.get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function transactionSignature(encoded: string) {
  const secret = process.env.PRIVACY_ONBOARDING_COOKIE_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) return null;
  return createHmac('sha256', secret).update(encoded, 'utf8').digest('base64url');
}

function sealOAuthTransaction(transaction: OAuthTransaction) {
  const encoded = Buffer.from(JSON.stringify(transaction), 'utf8').toString('base64url');
  const signature = transactionSignature(encoded);
  return signature ? `${encoded}.${signature}` : null;
}

function clearOAuthTransaction(response: NextResponse) {
  response.cookies.set({ name: OAUTH_TRANSACTION_COOKIE, value: '', httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

function rejectedResponse(origin: string) {
  const response = NextResponse.redirect(`${trustedOrigin(origin)}/`);
  response.headers.set('Cache-Control', 'no-store');
  clearOnboardingCookies(response);
  clearOAuthTransaction(response);
  return response;
}
function emitOAuthCallbackEvent(
  outcomeReason: Extract<PrivacyAuthEventInput['outcomeReason'], 'callback_started' | 'failed'>,
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
    // Telemetry must not affect OAuth initiation.
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const intent = url.searchParams.get('intent');
  const next = getSafeAuthNextPath(url.searchParams.get('next'));
  if ((intent !== 'login' && intent !== 'signup') || [...url.searchParams.keys()].some((key) => key !== 'intent' && key !== 'next')) {
    return rejectedResponse(url.origin);
  }

  const writes: CookieWrite[] = [];
  const requestCookies = (request.headers.get('cookie')?.split(';').flatMap((part) => {
    const index = part.indexOf('=');
    return index < 1 ? [] : [{ name: part.slice(0, index).trim(), value: part.slice(index + 1).trim() }];
  }) ?? []).filter(({ name }) => intent === 'signup'
    || (name !== ONBOARDING_CHALLENGE_COOKIE && name !== OAUTH_TRANSACTION_COOKIE));
  const supabase = createClientForCookieStore({
    getAll: () => requestCookies,
    set: (name, value, options) => writes.push({ name, value, options }),
  });

  const flow = randomBytes(32).toString('hex');
  const correlationId = randomUUID();
  const challenge = intent === 'signup'
    ? readOnboardingChallenge(requestCookie(request, ONBOARDING_CHALLENGE_COOKIE))
    : null;
  if (intent === 'signup' && (!challenge || challenge.intent !== 'oauth' || !challenge.oauthNonce || challenge.origin !== url.origin)) {
    return rejectedResponse(url.origin);
  }
  const transaction = sealOAuthTransaction({
    version: 1,
    flow,
    correlationId,
    intent,
    challengeId: challenge?.challengeId ?? null,
    challengeTokenDigest: challenge ? sha256(challenge.challengeToken) : null,
    next,
    expiresAt: Date.now() + OAUTH_TRANSACTION_TTL_SECONDS * 1000,
  });
  if (!transaction) return rejectedResponse(url.origin);

  const callback = new URL('/auth/callback', trustedOrigin(url.origin));
  callback.searchParams.set('next', next);
  callback.searchParams.set('flow', flow);
  emitOAuthCallbackEvent('callback_started', correlationId);
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback.toString() },
    });
    if (error || !data.url) {
      emitOAuthCallbackEvent('failed', correlationId);
      return rejectedResponse(url.origin);
    }

    const response = NextResponse.redirect(data.url);
    response.headers.set('Cache-Control', 'no-store');
    for (const write of writes) response.cookies.set(write.name, write.value, write.options);
    if (intent === 'login') clearOnboardingCookies(response);
    response.cookies.set({ name: OAUTH_TRANSACTION_COOKIE, value: transaction, httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: OAUTH_TRANSACTION_TTL_SECONDS });
    return response;
  } catch {
    emitOAuthCallbackEvent('failed', correlationId);
    return rejectedResponse(url.origin);
  }

}
