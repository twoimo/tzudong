import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export const ONBOARDING_CHALLENGE_COOKIE = 'tzudong_onboarding_challenge';
export const ONBOARDING_CHALLENGE_TTL_MS = 15 * 60 * 1000;
export const ONBOARDING_PASSWORD_RECOVERY_COOKIE = 'privacy_onboarding_password_recovery';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOWER_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SUPABASE_AUTH_COOKIE_PATTERN = /^sb-[A-Za-z0-9_-]{1,160}-(?:auth-token(?:\.\d+)?|auth-token-code-verifier(?:\.\d+)?|code-verifier(?:\.\d+)?)$/;
const MAX_REJECTED_AUTH_COOKIE_CHUNKS = 32;
const AGE_BANDS = new Set(['age_14_plus', 'under_14']);
const ONBOARDING_INTENTS = new Set(['password', 'oauth']);
const ONBOARDING_CHALLENGE_REQUIRED_KEYS = [
  'version',
  'challengeId',
  'challengeToken',
  'policyVersionId',
  'contentSha256',
  'ageBand',
  'intent',
  'expiresAt',
  'origin',
] as const;
const ONBOARDING_CHALLENGE_OPTIONAL_KEYS = ['oauthNonce'] as const;
const ONBOARDING_START_REQUIRED_KEYS = ['policyVersion', 'ageBand', 'intent', 'policyAcknowledged'];
const ONBOARDING_START_OPTIONAL_KEYS = ['marketing'];
const MARKETING_OPTIONAL_KEYS = ['email', 'sms', 'push', 'nightByChannel'];
const NIGHT_MARKETING_OPTIONAL_KEYS = ['email', 'sms', 'push'];

export const UNDER_14_SIGNUP_UNAVAILABLE = {
  code: 'UNDER_14_SIGNUP_UNAVAILABLE',
  status: 'blocked',
  message: '만 14세 미만 이용자의 가입은 운영자 승인 보호자 확인 경로가 배포되고 읽기검증될 때까지 이용할 수 없습니다.',
} as const;

type AgeBand = 'age_14_plus' | 'under_14';
type OnboardingIntent = 'password' | 'oauth';
type MarketingChoices = {
  email: boolean;
  sms: boolean;
  push: boolean;
  night_email: boolean;
  night_sms: boolean;
  night_push: boolean;
};

export type OnboardingChallengeCookie = {
  version: 1;
  challengeId: string;
  challengeToken: string;
  policyVersionId: string;
  contentSha256: string;
  ageBand: AgeBand;
  intent: OnboardingIntent;
  oauthNonce?: string;
  origin: string;
  expiresAt: number;
};
export type PrivacyOnboardingConfirmationReceipt = Readonly<{
  schemaVersion: 1;
  operationId: string;
  challengeId: string;
  userId: string;
  policyVersionId: string;
  eligible: true;
  status: 'applied';
  disposition: 'fresh' | 'idempotent_replay';
  readback: Readonly<{
    passed: true;
    checks: Readonly<{
      challengeConsumed: true;
      ageProfileRecorded: true;
      requiredConsentRecorded: true;
      eligible: true;
    }>;
  }>;
  auditId: string;
  errorCode: null;
  ageStatus: 'eligible';
}>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasExactKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
) {
  return requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => requiredKeys.includes(key) || optionalKeys.includes(key));
}

function getCookieSecret() {
  const secret = process.env.PRIVACY_ONBOARDING_COOKIE_SECRET;
  return typeof secret === 'string' && secret.length >= 32 ? secret : null;
}

export function sha256(value: string) {
  return createHmac('sha256', 'tzudong:privacy-digest:v1').update(value).digest('hex');
}

export function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
export function parseFreshPrivacyOnboardingConfirmationReceipt(
  value: unknown,
  challengeId: string,
  userId: string,
  policyVersionId: string,
): PrivacyOnboardingConfirmationReceipt | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'schemaVersion',
      'operationId',
      'challengeId',
      'userId',
      'policyVersionId',
      'eligible',
      'status',
      'disposition',
      'readback',
      'auditId',
      'errorCode',
      'ageStatus',
    ])
    || value.schemaVersion !== 1
    || value.operationId !== challengeId
    || value.challengeId !== challengeId
    || value.userId !== userId
    || value.policyVersionId !== policyVersionId
    || value.eligible !== true
    || value.status !== 'applied'
    || (value.disposition !== 'fresh' && value.disposition !== 'idempotent_replay')
    || typeof value.auditId !== 'string'
    || !UUID_PATTERN.test(value.auditId)
    || value.errorCode !== null
    || value.ageStatus !== 'eligible'
    || !isRecord(value.readback)
    || !hasExactKeys(value.readback, ['passed', 'checks'])
    || value.readback.passed !== true
    || !isRecord(value.readback.checks)
    || !hasExactKeys(value.readback.checks, [
      'challengeConsumed',
      'ageProfileRecorded',
      'requiredConsentRecorded',
      'eligible',
    ])
    || value.readback.checks.challengeConsumed !== true
    || value.readback.checks.ageProfileRecorded !== true
    || value.readback.checks.requiredConsentRecorded !== true
    || value.readback.checks.eligible !== true
  ) {
    return null;
  }

  return value as PrivacyOnboardingConfirmationReceipt;
}
function isCanonicalHttpOrigin(value: string) {
  try {
    const origin = new URL(value);
    return (origin.protocol === 'http:' || origin.protocol === 'https:') && origin.origin === value;
  } catch {
    return false;
  }
}


function isValidOnboardingChallengePayload(
  payload: Record<string, unknown>,
  now: number | null,
): payload is Record<string, unknown> & OnboardingChallengeCookie {
  if (
    !hasExactKeys(payload, ONBOARDING_CHALLENGE_REQUIRED_KEYS, ONBOARDING_CHALLENGE_OPTIONAL_KEYS)
    || payload.version !== 1
    || typeof payload.challengeId !== 'string' || !UUID_PATTERN.test(payload.challengeId)
    || typeof payload.challengeToken !== 'string' || !LOWER_SHA256_PATTERN.test(payload.challengeToken)
    || typeof payload.policyVersionId !== 'string' || !UUID_PATTERN.test(payload.policyVersionId)
    || typeof payload.contentSha256 !== 'string' || !LOWER_SHA256_PATTERN.test(payload.contentSha256)
    || typeof payload.ageBand !== 'string' || !AGE_BANDS.has(payload.ageBand)
    || typeof payload.intent !== 'string' || !ONBOARDING_INTENTS.has(payload.intent)
    || typeof payload.origin !== 'string' || !isCanonicalHttpOrigin(payload.origin)
    || typeof payload.expiresAt !== 'number' || !Number.isSafeInteger(payload.expiresAt)
    || (now !== null && payload.expiresAt <= now)
  ) {
    return false;
  }

  if (payload.intent === 'oauth') {
    return typeof payload.oauthNonce === 'string'
      && LOWER_SHA256_PATTERN.test(payload.oauthNonce)
      && safeEquals(payload.oauthNonce, payload.challengeToken);
  }
  return payload.oauthNonce === undefined;
}

export function sealOnboardingChallenge(payload: OnboardingChallengeCookie) {
  const secret = getCookieSecret();
  if (!secret || !isRecord(payload) || !isValidOnboardingChallengePayload(payload, null)) return null;

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function readOnboardingChallenge(
  value: string | undefined,
  now = Date.now(),
): OnboardingChallengeCookie | null {
  const secret = getCookieSecret();
  if (!secret || !value) return null;

  const [encoded, signature, ...rest] = value.split('.');
  if (!encoded || !signature || rest.length > 0) return null;

  const expectedSignature = createHmac('sha256', secret).update(encoded).digest('base64url');
  if (!safeEquals(signature, expectedSignature)) return null;

  try {
    const payload: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return isRecord(payload) && isValidOnboardingChallengePayload(payload, now)
      ? payload
      : null;
  } catch {
    return null;
  }
}

function expireCookie(response: NextResponse, name: string, path = '/') {
  response.cookies.set({
    name,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path,
    maxAge: 0,
  });
}

export function clearOnboardingChallenge(response: NextResponse) {
  expireCookie(response, ONBOARDING_CHALLENGE_COOKIE);
}

export function clearOnboardingPasswordRecovery(response: NextResponse) {
  expireCookie(response, ONBOARDING_PASSWORD_RECOVERY_COOKIE, '/api/privacy/onboarding');
}

export function clearOnboardingCookies(response: NextResponse) {
  clearOnboardingChallenge(response);
  clearOnboardingPasswordRecovery(response);
}

export function clearRejectedOnboardingCookies(response: NextResponse, request: Request) {
  clearOnboardingCookies(response);

  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return;

  const cookieNames = new Set<string>();
  for (const part of cookieHeader.split(';')) {
    if (cookieNames.size >= MAX_REJECTED_AUTH_COOKIE_CHUNKS) break;
    const separator = part.indexOf('=');
    const name = separator > 0 ? part.slice(0, separator).trim() : '';
    if (SUPABASE_AUTH_COOKIE_PATTERN.test(name)) cookieNames.add(name);
  }
  for (const name of cookieNames) expireCookie(response, name);
}

export function under14SignupUnavailableResponse() {
  return NextResponse.json(UNDER_14_SIGNUP_UNAVAILABLE, { status: 403 });
}

function parseMarketing(value: unknown): MarketingChoices | null {
  if (value === undefined) {
    return { email: false, sms: false, push: false, night_email: false, night_sms: false, night_push: false };
  }
  if (!isRecord(value) || !hasExactKeys(value, [], MARKETING_OPTIONAL_KEYS)) return null;

  const nightByChannel = value.nightByChannel;
  if (nightByChannel !== undefined
    && (!isRecord(nightByChannel) || !hasExactKeys(nightByChannel, [], NIGHT_MARKETING_OPTIONAL_KEYS))) return null;
  const channelValue = (key: string) => nightByChannel?.[key];
  const booleanOrFalse = (entry: unknown) => entry === undefined ? false : typeof entry === 'boolean' ? entry : null;

  const email = booleanOrFalse(value.email);
  const sms = booleanOrFalse(value.sms);
  const push = booleanOrFalse(value.push);
  const nightEmail = booleanOrFalse(channelValue('email'));
  const nightSms = booleanOrFalse(channelValue('sms'));
  const nightPush = booleanOrFalse(channelValue('push'));
  if ([email, sms, push, nightEmail, nightSms, nightPush].some((entry) => entry === null)
    || (nightEmail === true && email !== true)
    || (nightSms === true && sms !== true)
    || (nightPush === true && push !== true)) return null;

  return {
    email: email as boolean,
    sms: sms as boolean,
    push: push as boolean,
    night_email: nightEmail as boolean,
    night_sms: nightSms as boolean,
    night_push: nightPush as boolean,
  };
}

export function parseOnboardingStart(value: unknown) {
  if (!isRecord(value)
    || !hasExactKeys(value, ONBOARDING_START_REQUIRED_KEYS, ONBOARDING_START_OPTIONAL_KEYS)
    || value.policyAcknowledged !== true
    || typeof value.policyVersion !== 'string' || !UUID_PATTERN.test(value.policyVersion)
    || typeof value.ageBand !== 'string' || !AGE_BANDS.has(value.ageBand)
    || typeof value.intent !== 'string' || !ONBOARDING_INTENTS.has(value.intent)) {
    return null;
  }

  const marketing = parseMarketing(value.marketing);
  if (!marketing) return null;

  return {
    policyVersion: value.policyVersion,
    ageBand: value.ageBand as AgeBand,
    intent: value.intent as OnboardingIntent,
    marketing,
  };
}
