import { expect, test } from 'bun:test';

test('OAuth initiation binds login and signup callbacks to one opaque correlation ID', async () => {
  const modalSource = await Bun.file('components/auth/AuthModal.tsx').text();
  const initiationSource = await Bun.file('app/api/auth/oauth/route.ts').text();
  const callbackSource = await Bun.file('app/auth/callback/route.ts').text();

  expect(modalSource).toContain('window.location.assign(`/api/auth/oauth?${params.toString()}`)');
  expect(modalSource).not.toContain('supabase.auth.signInWithOAuth');
  expect(initiationSource).toContain("const OAUTH_TRANSACTION_COOKIE = 'tzudong_oauth_transaction'");
  expect(initiationSource).toContain("intent: 'login' | 'signup'");
  expect(initiationSource).toContain('const correlationId = randomUUID();');
  expect(initiationSource).toContain('correlationId,');
  expect(initiationSource).toContain("callback.searchParams.set('flow', flow)");
  expect(initiationSource).toContain("emitOAuthCallbackEvent('callback_started', correlationId)");
  expect(initiationSource).toContain("emitOAuthCallbackEvent('failed', correlationId)");
  expect(initiationSource).toContain('supabase.auth.signInWithOAuth');
  expect(initiationSource).toContain('response.cookies.set({ name: OAUTH_TRANSACTION_COOKIE, value: transaction');

  // The signed transaction is mandatory for both login and signup, and its
  // correlation is reused only after the flow and redirect binding validate.
  expect(callbackSource).toContain('const transaction = readOAuthTransaction(requestCookie(request, OAUTH_TRANSACTION_COOKIE));');
  expect(callbackSource).toContain('const correlationId = transaction.correlationId;');
  expect(callbackSource).toContain('transaction.flow !== callback.flow');
  expect(callbackSource).toContain('transaction.next !== callback.next');
  expect(callbackSource).toContain("emitCallbackPrivacyAuthEvent('failed', freshCorrelationId)");
  expect(callbackSource.indexOf('transaction.flow !== callback.flow'))
    .toBeLessThan(callbackSource.indexOf('exchangeCodeForSession(code)'));

  // Incomplete ordinary logins have their own terminal denominator; both
  // successful login and signup admissions are terminal and identity-free.
  expect(callbackSource).toContain("emitCallbackPrivacyAuthEvent('onboarding_required', correlationId)");
  expect(callbackSource).toContain("emitCallbackPrivacyAuthEvent('admitted', correlationId)");
  expect(callbackSource).toContain("outcomeReason: Extract<PrivacyAuthEventInput['outcomeReason'], 'admitted' | 'onboarding_required' | 'failed'>");
  expect(callbackSource).toContain('subjectDigest: null');
  expect(callbackSource).not.toContain('email');
  expect(callbackSource).not.toContain('user.id,');
  expect(callbackSource).toContain('parseFreshPrivacyOnboardingConfirmationReceipt');
  expect(callbackSource).not.toContain(".from('privacy_age_profiles'");
});
