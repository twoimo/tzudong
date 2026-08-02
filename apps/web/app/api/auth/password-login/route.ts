import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentPrivacyEligibility, hasLivePrivacyEligibilityReceipt, signOutRejectedPrivacySession } from '@/lib/privacy/eligibility';
import { PRIVACY_POLICY_CONTENT_SHA256, PRIVACY_POLICY_VERSION } from '@/lib/privacy/policy';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { emitPrivacyAuthEventFromServerEnvironment, type PrivacyAuthEventInput } from '@/lib/observability/privacy-auth-events';
import { createClientForCookieStore } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const MAX_REQUEST_BYTES = 4 * 1024;
const PASSWORD_LOGIN_KEYS = ['email', 'password'] as const;

type CookieWrite = Readonly<{ name: string; value: string; options: Record<string, unknown> }>;
type PasswordLoginRequest = Readonly<{ email: string; password: string }>;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function parsePasswordLoginRequest(value: unknown): PasswordLoginRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, PASSWORD_LOGIN_KEYS)) return null;
  if (
    typeof record.email !== 'string' || record.email.length < 1 || record.email.length > 320
    || typeof record.password !== 'string' || record.password.length < 1 || record.password.length > 1_024
  ) return null;
  return { email: record.email, password: record.password };
}

function withNoStore(response: NextResponse, writes: CookieWrite[] = []) {
  response.headers.set('Cache-Control', 'no-store');
  for (const write of writes) response.cookies.set(write.name, write.value, write.options);
  return response;
}

function loginResponse(outcome: 'admitted' | 'onboarding_required' | 'auth_failed', status: number, writes: CookieWrite[] = []) {
  return withNoStore(NextResponse.json({ outcome }, { status }), writes);
}

function emitPasswordLoginEvent(correlationId: string, outcomeReason: PrivacyAuthEventInput['outcomeReason']) {
  try {
    emitPrivacyAuthEventFromServerEnvironment({
      event: 'middleware',
      policyVersion: PRIVACY_POLICY_VERSION,
      policySha: PRIVACY_POLICY_CONTENT_SHA256,
      routeClass: 'public_api',
      provider: 'password',
      outcomeReason,
      correlationId,
      subjectDigest: null,
    });
  } catch {
    // Telemetry must not affect password authentication.
  }
}

export async function POST(request: NextRequest) {
  if (!isTrustedSameOriginMutation(request)) return loginResponse('auth_failed', 403);

  const parsed = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
  if (!parsed.ok) return loginResponse('auth_failed', 400);
  const credentials = parsePasswordLoginRequest(parsed.value);
  if (!credentials) return loginResponse('auth_failed', 400);

  const correlationId = crypto.randomUUID();
  let terminalEmitted = false;
  const emitTerminal = (outcomeReason: 'admitted' | 'onboarding_required' | 'failed') => {
    if (terminalEmitted) return;
    terminalEmitted = true;
    emitPasswordLoginEvent(correlationId, outcomeReason);
  };
  emitPasswordLoginEvent(correlationId, 'auth_started');

  const writes: CookieWrite[] = [];
  try {
    const cookieStore = await cookies();
    const supabase = createClientForCookieStore({
      getAll: () => cookieStore.getAll(),
      set: (name, value, options) => writes.push({ name, value, options }),
    });
    const { data, error } = await supabase.auth.signInWithPassword(credentials);
    if (error || !data.session?.user) {
      emitTerminal('failed');
      return loginResponse('auth_failed', 401, writes);
    }

    const eligibility = await getCurrentPrivacyEligibility(supabase);
    if (!hasLivePrivacyEligibilityReceipt(eligibility)) {
      await signOutRejectedPrivacySession(supabase);
      emitTerminal('onboarding_required');
      return loginResponse('onboarding_required', 409, writes);
    }

    emitTerminal('admitted');
    return loginResponse('admitted', 200, writes);
  } catch {
    emitTerminal('failed');
    return loginResponse('auth_failed', 401, writes);
  }
}
