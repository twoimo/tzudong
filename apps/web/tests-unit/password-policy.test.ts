import { describe, expect, test } from 'bun:test';

import { isAcceptableNewPasswordLength } from '../lib/auth/password-policy';

describe('new password length', () => {
  test('accepts the signup bound and rejects both sides of it', () => {
    expect(isAcceptableNewPasswordLength('a'.repeat(7))).toBe(false);
    expect(isAcceptableNewPasswordLength('a'.repeat(8))).toBe(true);
    expect(isAcceptableNewPasswordLength('a'.repeat(12))).toBe(true);
    expect(isAcceptableNewPasswordLength('a'.repeat(72))).toBe(true);
    expect(isAcceptableNewPasswordLength('a'.repeat(73))).toBe(false);
  });
});
