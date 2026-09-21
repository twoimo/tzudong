import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';

let moduleInstance = 0;

async function loadRecoveryModule() {
  moduleInstance += 1;
  return import(`../lib/auth/existing-account-recovery.ts?test=${moduleInstance}`);
}

afterEach(() => {
  setSystemTime();
});

describe('existing account privacy recovery', () => {
  test('issues a newer token greater than the previous token', async () => {
    const { beginExistingAccountPrivacyRecovery } = await loadRecoveryModule();

    const firstToken = beginExistingAccountPrivacyRecovery('first@example.com');
    const secondToken = beginExistingAccountPrivacyRecovery('second@example.com');

    expect(secondToken).toBeGreaterThan(firstToken);
  });

  test('end clears only the matching recovery token', async () => {
    const {
      beginExistingAccountPrivacyRecovery,
      endExistingAccountPrivacyRecovery,
      isExistingAccountPrivacyRecoveryActive,
    } = await loadRecoveryModule();

    const token = beginExistingAccountPrivacyRecovery('user@example.com');

    endExistingAccountPrivacyRecovery(token + 1);
    expect(isExistingAccountPrivacyRecoveryActive('user@example.com')).toBe(true);

    endExistingAccountPrivacyRecovery(token);
    expect(isExistingAccountPrivacyRecoveryActive('user@example.com')).toBe(false);
  });

  test('normalizes email casing and surrounding whitespace', async () => {
    const {
      beginExistingAccountPrivacyRecovery,
      isExistingAccountPrivacyRecoveryActive,
    } = await loadRecoveryModule();

    beginExistingAccountPrivacyRecovery('  User.Name@Example.COM  ');

    expect(isExistingAccountPrivacyRecoveryActive(' user.name@example.com ')).toBe(true);
  });

  test('treats null, undefined, and empty user email as inactive', async () => {
    const {
      beginExistingAccountPrivacyRecovery,
      isExistingAccountPrivacyRecoveryActive,
    } = await loadRecoveryModule();

    beginExistingAccountPrivacyRecovery('user@example.com');

    expect(isExistingAccountPrivacyRecoveryActive(null)).toBe(false);
    expect(isExistingAccountPrivacyRecoveryActive(undefined)).toBe(false);
    expect(isExistingAccountPrivacyRecoveryActive('')).toBe(false);
  });

  test('is active before the 30 second deadline and inactive at expiration', async () => {
    const {
      beginExistingAccountPrivacyRecovery,
      isExistingAccountPrivacyRecoveryActive,
    } = await loadRecoveryModule();
    const startedAt = new Date('2026-09-21T00:00:00.000Z');

    setSystemTime(startedAt);
    beginExistingAccountPrivacyRecovery('user@example.com');

    setSystemTime(new Date(startedAt.getTime() + 29_999));
    expect(isExistingAccountPrivacyRecoveryActive('user@example.com')).toBe(true);

    setSystemTime(new Date(startedAt.getTime() + 30_000));
    expect(isExistingAccountPrivacyRecoveryActive('user@example.com')).toBe(false);
  });

  test('expiration check clears the stored recovery state', async () => {
    const {
      beginExistingAccountPrivacyRecovery,
      isExistingAccountPrivacyRecoveryActive,
    } = await loadRecoveryModule();
    const startedAt = new Date('2026-09-21T00:00:00.000Z');

    setSystemTime(startedAt);
    beginExistingAccountPrivacyRecovery('user@example.com');

    setSystemTime(new Date(startedAt.getTime() + 30_000));
    expect(isExistingAccountPrivacyRecoveryActive('user@example.com')).toBe(false);

    setSystemTime(new Date(startedAt.getTime() + 1_000));
    expect(isExistingAccountPrivacyRecoveryActive('user@example.com')).toBe(false);
  });

  test('repeated begin keeps only the latest recovery active', async () => {
    const {
      beginExistingAccountPrivacyRecovery,
      isExistingAccountPrivacyRecoveryActive,
    } = await loadRecoveryModule();

    beginExistingAccountPrivacyRecovery('first@example.com');
    beginExistingAccountPrivacyRecovery('second@example.com');

    expect(isExistingAccountPrivacyRecoveryActive('first@example.com')).toBe(false);
    expect(isExistingAccountPrivacyRecoveryActive('second@example.com')).toBe(true);
  });
});
