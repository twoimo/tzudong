import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  emitPrivacyAuthEvent,
  emitPrivacyAuthEventFromServerEnvironment,
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
  test('allows the closed recovery monitor outcomes', () => {
    for (const outcomeReason of [
      'auth_started',
      'callback_started',
      'onboarding_started',
      'workflow_42501',
      'audit_write_failed',
      'eligibility_error',
      'policy_drift',
      'catalog_drift',
      'roster_conservation_mismatch',
    ] as const) {
      expect(() => emitPrivacyAuthEvent(validEvent({ outcomeReason }))).not.toThrow();
    }
  });

  test('uses validated server metadata and suppresses missing provenance without event data', () => {
    const infos: unknown[] = [];
    const warnings: unknown[] = [];
    const originalInfo = console.info;
    const originalWarn = console.warn;
    console.info = (message: unknown) => infos.push(message);
    console.warn = (message: unknown) => warnings.push(message);

    try {
      const { buildCommit, deploymentId, migrationManifestSha, ...input } = validEvent();
      expect(emitPrivacyAuthEventFromServerEnvironment(input, {
        VERCEL_GIT_COMMIT_SHA: buildCommit,
        VERCEL_DEPLOYMENT_ID: deploymentId,
        RELEASE_MIGRATION_MANIFEST_SHA256: migrationManifestSha,
      })).toMatchObject({ buildCommit, migrationManifestSha });
      expect(emitPrivacyAuthEventFromServerEnvironment(input, {})).toBeNull();
      expect(infos).toHaveLength(1);
      expect(warnings).toEqual(['privacy_auth_event_suppressed: invalid_server_metadata']);
    } finally {
      console.info = originalInfo;
      console.warn = originalWarn;
    }
  });
  test('wires fail-safe no-PII telemetry at callback, onboarding, middleware, and roster transitions', () => {
    const root = resolve(import.meta.dir, '..');
    const callback = readFileSync(resolve(root, 'app/auth/callback/route.ts'), 'utf8');
    const onboarding = readFileSync(resolve(root, 'app/api/privacy/onboarding/route.ts'), 'utf8');
    const middleware = readFileSync(resolve(root, 'lib/supabase/middleware.ts'), 'utf8');
    const roster = readFileSync(resolve(root, 'lib/privacy/roster-classification.ts'), 'utf8');

    expect(callback).toContain("emitCallbackPrivacyAuthEvent('admitted', correlationId)");
    expect(callback).toContain("subjectDigest: null");
    expect(onboarding).toContain("'onboarding_started'");
    expect(onboarding).toContain("'workflow_42501'");
    expect(onboarding).toContain("'audit_write_failed'");
    expect(onboarding).toContain("'policy_drift'");
    expect(onboarding).toContain('correlationId');
    expect(middleware).not.toContain("emitMiddlewarePrivacyAuthEvent(request, 'auth_started')");
    expect(middleware).toContain("'eligibility_error'");
    expect(middleware).toContain("'admitted'");
    expect(roster).toContain("'roster_conservation_mismatch'");
    expect(roster).toContain("event: 'roster_classification'");
    expect(roster).toContain('randomUUID');
    expect(middleware).toContain('Telemetry must not affect privacy enforcement.');
  });

  test('routes password login through the server cookie client with one fail-safe telemetry terminal', () => {
    const root = resolve(import.meta.dir, '..');
    const route = readFileSync(resolve(root, 'app/api/auth/password-login/route.ts'), 'utf8');
    const modal = readFileSync(resolve(root, 'components/auth/AuthModal.tsx'), 'utf8');
    const passwordLoginHandler = modal.slice(modal.indexOf('const handleLogin'), modal.indexOf('const handleSignup'));

    expect(route).toContain("const correlationId = crypto.randomUUID();");
    expect(route).toContain("emitPasswordLoginEvent(correlationId, 'auth_started');");
    expect(route).toContain("let terminalEmitted = false;");
    expect(route).toContain("emitTerminal('admitted');");
    expect(route).toContain("emitTerminal('onboarding_required');");
    expect(route).toContain("emitTerminal('failed');");
    expect(route).toContain("await signOutRejectedPrivacySession(supabase);");
    expect(route).toContain("createClientForCookieStore({");
    expect(route).toContain("return loginResponse('admitted', 200, writes);");
    expect(route).toContain("return loginResponse('onboarding_required', 409, writes);");
    expect(route).toContain("return loginResponse('auth_failed', 401, writes);");
    expect(route).toContain('Telemetry must not affect password authentication.');
    expect(route).not.toContain('console.');
    expect(route).not.toContain('JSON.stringify(credentials)');
    expect(passwordLoginHandler).toContain('fetch("/api/auth/password-login"');
    expect(passwordLoginHandler).not.toContain('supabase.auth.signInWithPassword');
  });
  test('formats timestamps deterministically at the UTC minute', () => {
    expect(formatPrivacyAuthUtcMinute(new Date('2026-08-02T23:59:59.999-07:00'))).toBe('2026-08-03T06:59:00.000Z');
    expect(() => formatPrivacyAuthUtcMinute(new Date('invalid'))).toThrow(
      'Privacy auth event timestamp must be a valid Date.',
    );
  });
});
