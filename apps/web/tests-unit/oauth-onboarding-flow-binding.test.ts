import { expect, test } from 'bun:test';

test('OAuth signup callbacks are transaction-bound without direct profile authority', async () => {
  const modalSource = await Bun.file('components/auth/AuthModal.tsx').text();
  const callbackSource = await Bun.file('app/auth/callback/route.ts').text();

  expect(modalSource).toContain('callbackUrl.searchParams.set("flow", await sha256Hex(challenge.oauthNonce))');
  expect(callbackSource).toContain("'flow',");
  expect(callbackSource).toContain("!/^[0-9a-f]{64}$/.test(flow)");
  expect(callbackSource).toContain("const onboardingRequested = callback.flow !== null");
  expect(callbackSource).toContain('sha256(challenge.oauthNonce) !== callback.flow');
  expect(callbackSource).not.toContain(".from('privacy_age_profiles'");
  expect(callbackSource).not.toContain('isPrivacyProfileStatusAllowed');
});
