import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseJsClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import {
  clearOnboardingChallenge,
  clearOnboardingPasswordRecovery,
  clearRejectedOnboardingCookies,
  hasExactKeys,
  isRecord,
  ONBOARDING_CHALLENGE_COOKIE,
  ONBOARDING_CHALLENGE_TTL_MS,
  ONBOARDING_PASSWORD_RECOVERY_COOKIE,
  parseOnboardingStart,
  readOnboardingChallenge,
  sealOnboardingChallenge,
  sha256,
  under14SignupUnavailableResponse,
  parseFreshPrivacyOnboardingConfirmationReceipt,
  type OnboardingChallengeCookie,
} from '@/lib/privacy/onboarding';
import {
  getPrivacyEligibilityForUser,
  privacyEligibilityMatchesPolicy,
} from '@/lib/privacy/eligibility';
import {
  PRIVACY_POLICY_CONTENT_SHA256,
  PRIVACY_POLICY_LOCALE,
  PRIVACY_POLICY_VERSION,
} from '@/lib/privacy/policy';
import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createClient } from '@/lib/supabase/server';
import {
  isSignupProfileStateReady,
  readSignupProfileState,
} from '@/lib/profile-mutation';

export const runtime = 'nodejs';

const MAX_REQUEST_BYTES = 16 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const PASSWORD_SIGNUP_KEYS = ['action', 'email', 'password', 'nickname'];
const EXISTING_ACCOUNT_KEYS = ['action'] as const;
const PASSWORD_RECOVERY_CODE = 'ONBOARDING_PASSWORD_LOGIN_REQUIRED';
const PASSWORD_RECOVERY_KEYS = [
  'version',
  'challengeId',
  'challengeToken',
  'userId',
  'policyVersionId',
  'origin',
  'expiresAt',
] as const;

type PasswordSignupRequest = {
  action: 'password_signup';
  email: string;
  password: string;
  nickname: string;
};
type ExistingAccountRequest = Readonly<{
  action: 'existing_account';
}>;

type PasswordRecoveryCookie = {
  version: 1;
  challengeId: string;
  challengeToken: string;
  userId: string;
  policyVersionId: string;
  origin: string;
  expiresAt: number;
};

function withNoStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function setOnboardingChallenge(response: NextResponse, value: string) {
  response.cookies.set({
    name: ONBOARDING_CHALLENGE_COOKIE,
    value,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ONBOARDING_CHALLENGE_TTL_MS / 1000,
  });
}

function setPasswordRecovery(response: NextResponse, value: string) {
  response.cookies.set({
    name: ONBOARDING_PASSWORD_RECOVERY_COOKIE,
    value,
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/api/privacy/onboarding',
    maxAge: ONBOARDING_CHALLENGE_TTL_MS / 1000,
  });
}

function rejectedResponse(response: NextResponse, request?: Request) {
  if (request) clearRejectedOnboardingCookies(response, request);
  return withNoStore(response);
}

function errorResponse(code: string, status: number, request?: Request) {
  return rejectedResponse(NextResponse.json({
    code,
    message: '요청을 처리할 수 없습니다. 입력 내용을 확인한 뒤 다시 시도해주세요.',
  }, { status }), request);
}

function passwordLoginRecoveryResponse(request?: Request) {
  return rejectedResponse(NextResponse.json({
    code: PASSWORD_RECOVERY_CODE,
    message: '가입 요청을 확인할 수 없습니다. 비밀번호로 로그인한 뒤 개인정보 처리 상태를 확인해주세요.',
  }, { status: 409 }), request);
}

function under14SignupRejectedResponse(request: Request) {
  return rejectedResponse(under14SignupUnavailableResponse(), request);
}

function getResultRecord(value: unknown) {
  return isRecord(value) ? value : null;
}

function passwordRecoverySignature(encoded: string) {
  const secret = process.env.PRIVACY_ONBOARDING_COOKIE_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) return null;
  return createHmac('sha256', secret).update(`tzudong:password-recovery:v1:${encoded}`, 'utf8').digest('base64url');
}

function sealPasswordRecovery(value: PasswordRecoveryCookie) {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const signature = passwordRecoverySignature(encoded);
  return signature ? `${encoded}.${signature}` : null;
}

function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readPasswordRecovery(value: string | undefined, origin: string): PasswordRecoveryCookie | null {
  if (!value || value.length > 2_048) return null;

  const [encoded, signature, ...extra] = value.split('.');
  const expectedSignature = encoded ? passwordRecoverySignature(encoded) : null;
  if (
    extra.length !== 0
    || !encoded
    || !signature
    || !expectedSignature
    || !/^[A-Za-z0-9_-]+$/.test(encoded)
    || !/^[A-Za-z0-9_-]+$/.test(signature)
    || !safeEquals(signature, expectedSignature)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
    if (!isRecord(parsed) || !hasExactKeys(parsed, PASSWORD_RECOVERY_KEYS)) return null;
    if (
      parsed.version !== 1
      || typeof parsed.challengeId !== 'string' || !UUID_PATTERN.test(parsed.challengeId)
      || typeof parsed.challengeToken !== 'string' || !HEX_TOKEN_PATTERN.test(parsed.challengeToken)
      || typeof parsed.userId !== 'string' || !UUID_PATTERN.test(parsed.userId)
      || typeof parsed.policyVersionId !== 'string' || !UUID_PATTERN.test(parsed.policyVersionId)
      || typeof parsed.origin !== 'string' || parsed.origin !== origin
      || typeof parsed.expiresAt !== 'number' || !Number.isSafeInteger(parsed.expiresAt)
      || parsed.expiresAt <= Date.now()
    ) {
      return null;
    }

    return {
      version: parsed.version,
      challengeId: parsed.challengeId,
      challengeToken: parsed.challengeToken,
      userId: parsed.userId,
      policyVersionId: parsed.policyVersionId,
      origin: parsed.origin,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function requestOrigin(request: NextRequest) {
  return new URL(request.url).origin;
}

type CurrentPolicyVersion = Readonly<{
  id: string;
  version: string;
  contentSha256: string;
  effectiveAt: string;
  publishedAt: string;
}>;

async function getCurrentPolicyVersion(): Promise<CurrentPolicyVersion | null> {
  const admin = createSupabaseServiceRoleClient();
  const { data, error } = await admin.rpc('get_current_privacy_policy_version');
  const policy = getResultRecord(data);
  const policyVersionId = policy?.policyVersionId;
  const version = policy?.version;
  const locale = policy?.locale;
  const contentSha256 = policy?.contentSha256;
  const approvalBound = policy?.approvalBound;
  const effectiveAt = policy?.effectiveAt;
  const publishedAt = policy?.publishedAt;
  if (
    error
    || !policy
    || !hasExactKeys(policy, [
      'schemaVersion',
      'policyVersionId',
      'version',
      'locale',
      'contentSha256',
      'effectiveAt',
      'publishedAt',
      'approvalBound',
    ])
    || policy.schemaVersion !== 1
    || typeof policyVersionId !== 'string'
    || !UUID_PATTERN.test(policyVersionId)
    || typeof version !== 'string'
    || version !== PRIVACY_POLICY_VERSION
    || locale !== PRIVACY_POLICY_LOCALE
    || typeof contentSha256 !== 'string'
    || contentSha256 !== PRIVACY_POLICY_CONTENT_SHA256
    || approvalBound !== true
    || typeof effectiveAt !== 'string'
    || typeof publishedAt !== 'string'
    || !Number.isFinite(Date.parse(effectiveAt))
    || !Number.isFinite(Date.parse(publishedAt))
  ) {
    return null;
  }
  return {
    id: policyVersionId,
    version,
    contentSha256,
    effectiveAt,
    publishedAt,
  };
}

type ChallengeReceipt = Readonly<{
  challengeId: string;
  expiresAt: string;
}>;

function isExactChallengeReceipt(
  value: unknown,
  input: NonNullable<ReturnType<typeof parseOnboardingStart>>,
  expiresAt: Date,
): value is ChallengeReceipt {
  return isRecord(value)
    && hasExactKeys(value, [
      'schemaVersion',
      'challengeId',
      'policyVersionId',
      'ageBand',
      'expiresAt',
      'auditId',
    ])
    && value.schemaVersion === 1
    && typeof value.challengeId === 'string'
    && UUID_PATTERN.test(value.challengeId)
    && value.policyVersionId === input.policyVersion
    && value.ageBand === input.ageBand
    && value.expiresAt === expiresAt.toISOString()
    && typeof value.auditId === 'string'
    && UUID_PATTERN.test(value.auditId);
}

async function createChallenge(
  input: NonNullable<ReturnType<typeof parseOnboardingStart>>,
  origin: string,
) {
  const currentPolicy = await getCurrentPolicyVersion();
  if (!currentPolicy || currentPolicy.id !== input.policyVersion) return null;

  const oauthNonce = input.intent === 'oauth' ? randomBytes(32).toString('hex') : undefined;
  const challengeToken = oauthNonce ?? randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ONBOARDING_CHALLENGE_TTL_MS);
  const admin = createSupabaseServiceRoleClient();
  const { data, error } = await admin.rpc('create_privacy_onboarding_challenge', {
    p_token_hash: sha256(challengeToken),
    p_policy_version_id: input.policyVersion,
    p_age_band: input.ageBand,
    p_requested_consents: input.marketing,
    p_oauth_nonce_hash: oauthNonce ? sha256(oauthNonce) : null,
    p_expires_at: expiresAt.toISOString(),
  });
  const result = getResultRecord(data);
  if (error || !isExactChallengeReceipt(result, input, expiresAt)) {
    return null;
  }

  return {
    challengeId: result.challengeId,
    challengeToken,
    policyVersionId: currentPolicy.id,
    contentSha256: currentPolicy.contentSha256,
    ageBand: input.ageBand,
    intent: input.intent,
    oauthNonce,
    origin,
    expiresAt: expiresAt.getTime(),
    publicExpiresAt: result.expiresAt,
  };
}

async function confirmChallenge(
  payload: OnboardingChallengeCookie,
  userId: string,
  source: Database['public']['Functions']['confirm_privacy_onboarding']['Args']['p_source'],
) {
  const admin = createSupabaseServiceRoleClient();
  const { data, error } = await admin.rpc('confirm_privacy_onboarding', {
    p_challenge_id: payload.challengeId,
    p_challenge_token: payload.challengeToken,
    p_user_id: userId,
    p_source: source,
    p_guardian_verification_id: null,
    p_oauth_nonce_hash: source === 'oauth' && payload.oauthNonce ? sha256(payload.oauthNonce) : null,
  });
  if (error) return null;
  return parseFreshPrivacyOnboardingConfirmationReceipt(
    data,
    payload.challengeId,
    userId,
    payload.policyVersionId,
  );
}

function validPasswordSignup(value: Record<string, unknown>): value is PasswordSignupRequest {
  return hasExactKeys(value, PASSWORD_SIGNUP_KEYS)
    && value.action === 'password_signup'
    && typeof value.email === 'string' && value.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)
    && typeof value.password === 'string' && value.password.length >= 8 && value.password.length <= 72
    && typeof value.nickname === 'string' && value.nickname.trim().length >= 2 && value.nickname.trim().length <= 20;
}
function validExistingAccountRequest(value: Record<string, unknown>): value is ExistingAccountRequest {
  return hasExactKeys(value, EXISTING_ACCOUNT_KEYS) && value.action === 'existing_account';
}

async function recoverExistingPasswordAccount(request: NextRequest, body: Record<string, unknown>) {
  if (!validExistingAccountRequest(body)) {
    return errorResponse('INVALID_ONBOARDING_REQUEST', 400, request);
  }

  const challenge = readOnboardingChallenge(request.cookies.get(ONBOARDING_CHALLENGE_COOKIE)?.value);
  if (!challenge || challenge.intent !== 'password' || challenge.ageBand !== 'age_14_plus') {
    return errorResponse('ONBOARDING_CHALLENGE_INVALID', 400, request);
  }

  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    userId = !error && typeof user?.id === 'string' && UUID_PATTERN.test(user.id) ? user.id : null;
  } catch {
    userId = null;
  }
  if (!userId) return errorResponse('ONBOARDING_AUTHENTICATION_REQUIRED', 401, request);

  let confirmation = null;
  let liveEligibility = null;
  let currentPolicy: CurrentPolicyVersion | null = null;
  try {
    // G014's password_signup source denotes a server-verified password-authenticated proof.
    confirmation = await confirmChallenge(challenge, userId, 'password_signup');
    if (confirmation) {
      const admin = createSupabaseServiceRoleClient();
      [liveEligibility, currentPolicy] = await Promise.all([
        getPrivacyEligibilityForUser(admin, userId),
        getCurrentPolicyVersion(),
      ]);
    }
  } catch {
    confirmation = null;
  }

  if (
    !confirmation
    || !currentPolicy
    || currentPolicy.id !== challenge.policyVersionId
    || currentPolicy.contentSha256 !== challenge.contentSha256
    || !liveEligibility?.eligible
    || !privacyEligibilityMatchesPolicy(liveEligibility.receipt, {
      policyVersionId: challenge.policyVersionId,
      contentSha256: challenge.contentSha256,
    })
  ) {
    return errorResponse('ONBOARDING_FINALIZATION_FAILED', 403, request);
  }

  const response = withNoStore(NextResponse.json({ status: 'onboarding_confirmed' }));
  clearOnboardingChallenge(response);
  return response;
}


const PASSWORD_COMPENSATION_HOLD_REASON = 'ONBOARDING_PASSWORD_COMPENSATION_UNVERIFIED';

type PasswordSignupCreationProvenance = Readonly<{
  challengeId: string;
  userId: string;
}>;
type PasswordCleanupProof = Readonly<{
  sessionAbsent: boolean;
  identityAbsent: boolean | null;
  creationProvenance: boolean;
}>;

function passwordSignupCreationProvenance(
  challenge: OnboardingChallengeCookie,
  user: unknown,
): PasswordSignupCreationProvenance | null {
  if (
    !UUID_PATTERN.test(challenge.challengeId)
    || !HEX_TOKEN_PATTERN.test(challenge.challengeToken)
    || !UUID_PATTERN.test(challenge.policyVersionId)
    || !HEX_TOKEN_PATTERN.test(challenge.contentSha256)
    || !isRecord(user)
    || typeof user.id !== 'string'
    || !UUID_PATTERN.test(user.id)
    || !Array.isArray(user.identities)
    || user.identities.length === 0
  ) {
    return null;
  }

  return { challengeId: challenge.challengeId, userId: user.id };
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

async function revokePasswordSignupSession(
  signupClient: SupabaseClient<Database>,
): Promise<Pick<PasswordCleanupProof, 'sessionAbsent'>> {
  try {
    await signupClient.auth.signOut({ scope: 'global' });
  } catch {
    // Only the strict getUser readback below can prove that a session is absent.
  }

  try {
    await signupClient.auth.signOut({ scope: 'local' });
  } catch {
    // Only the strict getUser readback below can prove that a session is absent.
  }

  try {
    const { data: { user }, error } = await signupClient.auth.getUser();
    return { sessionAbsent: isExplicitAuthAbsence(user, error) };
  } catch {
    return { sessionAbsent: false };
  }
}

async function readPasswordIdentityAbsence(
  admin: ReturnType<typeof createSupabaseServiceRoleClient>,
  userId: string,
) {
  try {
    const { data: { user }, error } = await admin.auth.admin.getUserById(userId);
    return isExplicitAuthAbsence(user, error);
  } catch {
    return false;
  }
}

async function compensateFreshPasswordAccount(
  creationProvenance: PasswordSignupCreationProvenance | null,
  signupClient: SupabaseClient<Database>,
): Promise<PasswordCleanupProof> {
  const session = await revokePasswordSignupSession(signupClient);
  if (!creationProvenance) {
    return {
      sessionAbsent: session.sessionAbsent,
      identityAbsent: null,
      creationProvenance: false,
    };
  }

  let admin: ReturnType<typeof createSupabaseServiceRoleClient>;
  try {
    admin = createSupabaseServiceRoleClient();
  } catch {
    return {
      sessionAbsent: session.sessionAbsent,
      identityAbsent: false,
      creationProvenance: true,
    };
  }

  try {
    await admin.auth.admin.updateUserById(creationProvenance.userId, { ban_duration: '876000h' });
  } catch {
    // The deletion readback below determines whether durable compensation completed.
  }

  try {
    await admin.auth.admin.deleteUser(creationProvenance.userId);
  } catch {
    // The strict Auth readback below determines whether the identity is absent.
  }

  return {
    sessionAbsent: session.sessionAbsent,
    identityAbsent: await readPasswordIdentityAbsence(admin, creationProvenance.userId),
    creationProvenance: true,
  };
}

function passwordCompensationRequiresHold(proof: PasswordCleanupProof) {
  return !proof.sessionAbsent || (proof.creationProvenance && proof.identityAbsent !== true);
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

async function holdUnverifiedPasswordCompensation(
  challenge: OnboardingChallengeCookie,
  userId: string,
) {
  if (!UUID_PATTERN.test(userId)) return false;

  try {
    const admin = createSupabaseServiceRoleClient();
    const reasonCode = PASSWORD_COMPENSATION_HOLD_REASON;
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

async function enforcePasswordCompensation(
  challenge: OnboardingChallengeCookie,
  userId: string | null,
  proof: PasswordCleanupProof,
) {
  if (!passwordCompensationRequiresHold(proof)) return true;
  return userId !== null && await holdUnverifiedPasswordCompensation(challenge, userId);
}

async function recoverPasswordSignup(
  request: NextRequest,
  body: Record<string, unknown>,
) {
  if (!validPasswordSignup(body)) return null;

  const recovery = readPasswordRecovery(
    request.cookies.get(ONBOARDING_PASSWORD_RECOVERY_COOKIE)?.value,
    requestOrigin(request),
  );
  if (!recovery) return null;

  try {
    const admin = createSupabaseServiceRoleClient();
    await getPrivacyEligibilityForUser(admin, recovery.userId);
  } catch {
    // Recovery remains non-enumerating when the live read is temporarily unavailable.
  }

  return passwordLoginRecoveryResponse(request);
}

async function createPasswordAccount(request: NextRequest, body: Record<string, unknown>) {
  const recoveryResponse = await recoverPasswordSignup(request, body);
  if (recoveryResponse) return recoveryResponse;

  const challenge = readOnboardingChallenge(request.cookies.get(ONBOARDING_CHALLENGE_COOKIE)?.value);
  if (!challenge || challenge.intent !== 'password' || !validPasswordSignup(body)) {
    return errorResponse('ONBOARDING_CHALLENGE_INVALID', 400, request);
  }
  if (challenge.ageBand !== 'age_14_plus') {
    return under14SignupRejectedResponse(request);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return errorResponse('ONBOARDING_ACCOUNT_CREATE_UNAVAILABLE', 503, request);
  }

  const signupClient = createSupabaseJsClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { data, error } = await signupClient.auth.signUp({
    email: body.email,
    password: body.password,
    options: { data: { nickname: body.nickname.trim() } },
  });
  const user = data.user;
  const userId = isRecord(user) && typeof user.id === 'string' && UUID_PATTERN.test(user.id)
    ? user.id
    : null;
  const creationProvenance = passwordSignupCreationProvenance(challenge, user);
  if (error || !creationProvenance) {
    const proof = await compensateFreshPasswordAccount(creationProvenance, signupClient);
    if (!await enforcePasswordCompensation(challenge, userId, proof)) {
      return errorResponse('ONBOARDING_COMPENSATION_HOLD_UNAVAILABLE', 503, request);
    }
    return passwordLoginRecoveryResponse(request);
  }

  let signupProfileReady = false;
  try {
    const admin = createSupabaseServiceRoleClient();
    const signupProfileState = await readSignupProfileState(
      admin,
      creationProvenance.userId,
      body.nickname.trim(),
    );
    signupProfileReady = isSignupProfileStateReady(signupProfileState);
  } catch {
    signupProfileReady = false;
  }

  if (!signupProfileReady) {
    const proof = await compensateFreshPasswordAccount(creationProvenance, signupClient);
    if (!await enforcePasswordCompensation(challenge, creationProvenance.userId, proof)) {
      return errorResponse('ONBOARDING_COMPENSATION_HOLD_UNAVAILABLE', 503, request);
    }
    return passwordLoginRecoveryResponse(request);
  }

  let confirmation: Record<string, unknown> | null = null;
  try {
    confirmation = await confirmChallenge(challenge, creationProvenance.userId, 'password_signup');
  } catch {
    confirmation = null;
  }

  let liveEligibility = null;
  try {
    const admin = createSupabaseServiceRoleClient();
    liveEligibility = confirmation
      ? await getPrivacyEligibilityForUser(admin, creationProvenance.userId)
      : null;
  } catch {
    liveEligibility = null;
  }

  if (!confirmation) {
    const proof = await compensateFreshPasswordAccount(creationProvenance, signupClient);
    if (!await enforcePasswordCompensation(challenge, creationProvenance.userId, proof)) {
      return errorResponse('ONBOARDING_COMPENSATION_HOLD_UNAVAILABLE', 503, request);
    }
    return passwordLoginRecoveryResponse(request);
  }

  if (
    !liveEligibility?.eligible
    || !privacyEligibilityMatchesPolicy(liveEligibility.receipt, {
      policyVersionId: challenge.policyVersionId,
      contentSha256: challenge.contentSha256,
    })
  ) {
    const proof = await compensateFreshPasswordAccount(creationProvenance, signupClient);
    if (!await enforcePasswordCompensation(challenge, creationProvenance.userId, proof)) {
      return errorResponse('ONBOARDING_COMPENSATION_HOLD_UNAVAILABLE', 503, request);
    }
    return errorResponse('ONBOARDING_FINALIZATION_FAILED', 403, request);
  }

  const recoveryCookie = sealPasswordRecovery({
    version: 1,
    challengeId: challenge.challengeId,
    challengeToken: challenge.challengeToken,
    userId: creationProvenance.userId,
    policyVersionId: challenge.policyVersionId,
    origin: requestOrigin(request),
    expiresAt: challenge.expiresAt,
  });
  if (!recoveryCookie) return passwordLoginRecoveryResponse(request);

  const response = withNoStore(NextResponse.json({
    status: 'created',
    emailConfirmationRequired: !data.session,
  }, { status: 201 }));
  setPasswordRecovery(response, recoveryCookie);
  clearOnboardingChallenge(response);
  return response;
}

export async function GET(request: NextRequest) {
  if ([...request.nextUrl.searchParams.keys()].length > 0) {
    return errorResponse('ONBOARDING_QUERY_INVALID', 400, request);
  }
  try {
    const policy = await getCurrentPolicyVersion();
    if (!policy) return errorResponse('POLICY_UNAVAILABLE', 503, request);
    return NextResponse.json(policy, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return errorResponse('POLICY_UNAVAILABLE', 503, request);
  }
}

export async function POST(request: NextRequest) {
  if ([...request.nextUrl.searchParams.keys()].length > 0) {
    return errorResponse('ONBOARDING_QUERY_INVALID', 400, request);
  }
  try {
    if (!isTrustedSameOriginMutation(request)) {
      return errorResponse('ONBOARDING_ORIGIN_INVALID', 403, request);
    }

    const requestBody = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
    if (!requestBody.ok) {
      return errorResponse(
        'INVALID_ONBOARDING_REQUEST',
        requestBody.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge ? 413 : 400,
        request,
      );
    }

    const body = requestBody.value;
    if (!isRecord(body)) return errorResponse('INVALID_ONBOARDING_REQUEST', 400, request);

    if (body.action === 'password_signup') {
      return await createPasswordAccount(request, body);
    }
    if (body.action === 'existing_account') {
      return await recoverExistingPasswordAccount(request, body);
    }

    const input = parseOnboardingStart(body);
    if (!input) return errorResponse('INVALID_ONBOARDING_REQUEST', 400, request);
    if (input.ageBand === 'under_14') {
      return under14SignupRejectedResponse(request);
    }

    const challenge = await createChallenge(input, requestOrigin(request));
    if (!challenge) return errorResponse('ONBOARDING_CHALLENGE_UNAVAILABLE', 409, request);

    const signedChallenge = sealOnboardingChallenge({
      version: 1,
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      policyVersionId: challenge.policyVersionId,
      contentSha256: challenge.contentSha256,
      ageBand: challenge.ageBand,
      intent: challenge.intent,
      ...(challenge.oauthNonce ? { oauthNonce: challenge.oauthNonce } : {}),
      origin: challenge.origin,
      expiresAt: challenge.expiresAt,
    });
    if (!signedChallenge) return errorResponse('ONBOARDING_CHALLENGE_UNAVAILABLE', 503, request);

    const responseBody = {
      challengeId: challenge.challengeId,
      policyVersionId: challenge.policyVersionId,
      contentSha256: challenge.contentSha256,
      expiresAt: challenge.publicExpiresAt,
      oauthNonce: challenge.oauthNonce,
    };
    const response = withNoStore(NextResponse.json(responseBody, { status: 201 }));
    setOnboardingChallenge(response, signedChallenge);
    clearOnboardingPasswordRecovery(response);
    return response;
  } catch {
    return errorResponse('ONBOARDING_UNAVAILABLE', 503, request);
  }
}
