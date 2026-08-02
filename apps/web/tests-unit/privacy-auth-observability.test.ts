import { describe, expect, test } from 'bun:test';
import {
  emitPrivacyAuthEvent,
  formatPrivacyAuthUtcMinute,
  type PrivacyAuthEvent,
} from '../lib/observability/privacy-auth-events';

const SHA = 'a'.repeat(64);
const SUBJECT_DIGEST = 'b'.repeat(64);

function validEvent(overrides: Partial<PrivacyAuthEvent> = {}): PrivacyAuthEvent {
  return {
    event: 'onboarding',
    buildCommit: '58b758470',
    deploymentId: 'dpl_privacy_auth_recovery',
    migrationManifestSha: SHA,
    policyVersion: '2026.08.01',
    policySha: SHA,
    routeClass: 'loop_safe_api',
    provider: 'password',
    outcomeReason: 'started',
    correlationId: '550e8400-e29b-41d4-a716-446655440000',
    subjectDigest: SUBJECT_DIGEST,
    ...overrides,
  };
}

describe('privacy auth observability', () => {
  test('emits only the allowlisted JSON fields', () => {
    const messages: unknown[] = [];
    const originalInfo = console.info;
    console.info = (message: unknown) => messages.push(message);

    try {
      const emitted = emitPrivacyAuthEvent(validEvent(), new Date('2026-08-02T14:35:59.999Z'));
      expect(messages).toEqual([JSON.stringify(emitted)]);
      expect(JSON.parse(messages[0] as string)).toEqual({
        utcMinute: '2026-08-02T14:35:00.000Z',
        ...validEvent(),
      });
    } finally {
      console.info = originalInfo;
    }
  });

  test('rejects raw identity, credential, SQL, audit, and arbitrary fields before logging', () => {
    const prohibitedFields = {
      email: 'person@example.com',
      userId: '550e8400-e29b-41d4-a716-446655440000',
      cookie: 'session=value',
      token: 'secret-token',
      sql: 'select * from privacy_audit_events',
      auditPayload: { consent: true },
      unexpected: 'value',
    };
    const originalInfo = console.info;
    const messages: unknown[] = [];
    console.info = (message: unknown) => messages.push(message);

    try {
      for (const [field, value] of Object.entries(prohibitedFields)) {
        expect(() => emitPrivacyAuthEvent({ ...validEvent(), [field]: value })).toThrow(
          'Privacy auth event contains forbidden fields.',
        );
      }
      expect(() => emitPrivacyAuthEvent(validEvent({ subjectDigest: 'person@example.com' }))).toThrow(
        'Invalid privacy auth event subjectDigest.',
      );
      expect(() => emitPrivacyAuthEvent({ ...validEvent(), [Symbol('audit')]: 'payload' })).toThrow(
        'Privacy auth event contains forbidden fields.',
      );
      expect(messages).toEqual([]);
    } finally {
      console.info = originalInfo;
    }
  });

  test('rejects values outside the closed enums', () => {
    expect(() => emitPrivacyAuthEvent(validEvent({ event: 'custom' as PrivacyAuthEvent['event'] }))).toThrow(
      'Invalid privacy auth event event.',
    );
    expect(() => emitPrivacyAuthEvent(validEvent({ provider: 'google' as PrivacyAuthEvent['provider'] }))).toThrow(
      'Invalid privacy auth event provider.',
    );
    expect(() => emitPrivacyAuthEvent(validEvent({ outcomeReason: 'success' as PrivacyAuthEvent['outcomeReason'] }))).toThrow(
      'Invalid privacy auth event outcomeReason.',
    );
  });

  test('formats timestamps deterministically at the UTC minute', () => {
    expect(formatPrivacyAuthUtcMinute(new Date('2026-08-02T23:59:59.999-07:00'))).toBe('2026-08-03T06:59:00.000Z');
    expect(() => formatPrivacyAuthUtcMinute(new Date('invalid'))).toThrow(
      'Privacy auth event timestamp must be a valid Date.',
    );
  });
});
