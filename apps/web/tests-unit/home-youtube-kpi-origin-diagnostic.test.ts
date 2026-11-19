import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { isTrustedSameOriginMutation } from '../lib/security/same-origin-mutation';
import { runDiagnostic as runOriginalDiagnostic } from '../performance/kpi-rpc-20261115/diagnose.mjs';
import { runDiagnostic as runOriginDiagnostic } from '../performance/kpi-rpc-20261115-origin-v2/diagnose.mjs';

// Synthetic requests enter the real application guard. No HTTP, route handler,
// database, provider or receipt I/O is used by these authorization tests.
const canonicalOrigin = 'https://diagnostic.fixture.invalid';
const ids = Array.from({ length: 100 }, (_, index) => 'fixture_' + String(index).padStart(3, '0'));
const provenance = {
  schemaVersion: 1, mode: 'legacy', sourceSha: 'a'.repeat(40), deploymentId: 'dpl_fixture12345678',
  origin: canonicalOrigin, observedAtUtc: '2026-11-15T09:00:00.000Z',
  providerReadbackSha256: 'b'.repeat(64),
};
const productionEnv = {
  NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_SITE_URL: canonicalOrigin,
} as NodeJS.ProcessEnv;

const originalFetch = globalThis.fetch;
let externalFetchAttempts = 0;
beforeAll(() => {
  globalThis.fetch = (async () => {
    externalFetchAttempts++;
    throw new Error('EXTERNAL_FETCH_FORBIDDEN');
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  expect(externalFetchAttempts).toBe(0);
});

async function observeGuard(
  runner: typeof runOriginDiagnostic,
  env: NodeJS.ProcessEnv,
  origin = canonicalOrigin,
) {
  const calls: { request: Request; init: RequestInit; trusted: boolean }[] = [];
  const samples = await runner({
    ids, provenance: { ...provenance, origin }, emit: () => {},
    fetchImpl: async (url: string, init: RequestInit) => {
      const request = new Request(url, init);
      const trusted = isTrustedSameOriginMutation(request, env);
      calls.push({ request, init, trusted });
      // The fixture only exercises admission to the application. A 204 here
      // deliberately provides no valid KPI sample or performance evidence.
      return new Response(null, { status: trusted ? 204 : 403 });
    },
  });
  expect(calls).toHaveLength(5);
  expect(samples).toHaveLength(5);
  expect(samples.every((sample: { admitted: boolean }) => !sample.admitted)).toBe(true);
  return calls;
}

describe('homepage KPI diagnostic Origin compatibility with the application guard', () => {
  test('the frozen original request is rejected because Origin is absent', async () => {
    const calls = await observeGuard(runOriginalDiagnostic, productionEnv);
    for (const { request, trusted } of calls) {
      expect(request.method).toBe('POST');
      expect(request.headers.has('origin')).toBe(false);
      expect(request.headers.has('authorization')).toBe(false);
      expect(request.headers.has('cookie')).toBe(false);
      expect(trusted).toBe(false);
    }
  });

  test('v2 sends its provenance origin and passes an exactly matching canonical origin', async () => {
    const calls = await observeGuard(runOriginDiagnostic, productionEnv);
    for (const { request, init, trusted } of calls) {
      expect(request.url).toBe(canonicalOrigin + '/api/home/youtube-kpi');
      expect(request.headers.get('origin')).toBe(canonicalOrigin);
      expect(request.headers.has('authorization')).toBe(false);
      expect(request.headers.has('cookie')).toBe(false);
      expect(request.headers.has('sec-fetch-site')).toBe(false);
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('manual');
      expect(trusted).toBe(true);
    }
  });

  test('a different provenance origin is still rejected by the configured canonical origin', async () => {
    const otherOrigin = 'https://other.fixture.invalid';
    const calls = await observeGuard(runOriginDiagnostic, productionEnv, otherOrigin);
    for (const { request, trusted } of calls) {
      expect(request.url).toBe(otherOrigin + '/api/home/youtube-kpi');
      expect(request.headers.get('origin')).toBe(otherOrigin);
      expect(trusted).toBe(false);
    }
  });

  test('v2 fails closed when production has no configured canonical origin', async () => {
    const calls = await observeGuard(runOriginDiagnostic, {
      NODE_ENV: 'production', VERCEL_ENV: 'production',
    } as NodeJS.ProcessEnv);
    for (const { request, trusted } of calls) {
      expect(request.headers.get('origin')).toBe(canonicalOrigin);
      expect(trusted).toBe(false);
    }
  });
});
