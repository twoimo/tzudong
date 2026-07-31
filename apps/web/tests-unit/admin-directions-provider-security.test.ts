import { describe, expect, mock, test } from 'bun:test';
import type { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const repositorySource = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', '..', '..', relativePath), 'utf8');
const directionsRoute = source('app/api/admin/routes/directions/route.ts');
const budgetHelper = source('lib/security/admin-provider-budget.ts');
const generatedTypes = source('integrations/supabase/types.ts');
const budgetMigration = repositorySource('backend/supabase/migrations/20260713000400_g013_provider_budget_extension.sql');

function postHandlerSource(routeSource: string) {
  return routeSource.slice(routeSource.indexOf('export async function POST'));
}
function buildDirectionsRequest(body: unknown) {
  return new Request('http://localhost/api/admin/routes/directions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
      'Sec-Fetch-Site': 'same-origin',
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function loadDirectionsRoute() {
  return import(`../app/api/admin/routes/directions/route.ts?cache=${Math.random()}`);
}

function clearNaverDirectionsCredentials() {
  const credentialKeys = [
    'NEXT_NAVER_CLIENT_ID',
    'NEXT_NAVER_CLIENT_ID_BYEON',
    'NEXT_PUBLIC_NAVER_CLIENT_ID',
    'NEXT_PUBLIC_NAVER_CLIENT_ID_BYEON',
    'NEXT_NAVER_CLIENT_SECRET',
    'NEXT_NAVER_CLIENT_SECRET_BYEON',
  ];
  const previousValues = credentialKeys.map((key) => ({ key, value: process.env[key] }));
  for (const { key } of previousValues) delete process.env[key];

  return () => {
    for (const { key, value } of previousValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

describe('admin Directions provider security', () => {
  test('reserves the durable Naver Directions budget before credentialed dispatch and fails closed when unavailable or denied', () => {
    const handler = postHandlerSource(directionsRoute);
    const reservationIndex = handler.indexOf('await reserveAdminProviderBudget({');
    const providerIndex = handler.indexOf('provider: "naver_directions"');
    const fetchIndex = handler.indexOf('await fetch(url, {');

    expect(directionsRoute).toContain('@/lib/security/admin-provider-budget');
    expect(reservationIndex).toBeGreaterThan(-1);
    expect(providerIndex).toBeGreaterThan(reservationIndex);
    expect(fetchIndex).toBeGreaterThan(providerIndex);
    expect(handler).toContain('error: "Provider budget unavailable"');
    expect(handler).toContain('status: 503');
    expect(handler).toContain('error: "Provider request limit exceeded"');
    expect(handler).toContain('status: 429');
    expect(handler).toContain('"Retry-After": String(budget.retryAfterSeconds)');
    expect(handler).not.toContain('adminDirectionsRateLimits');
    expect(handler).not.toContain('readAdminDirectionsRateLimit');
  });

  test('rejects redirect credential forwarding and stalled provider calls with one bounded fetch policy', () => {
    expect(directionsRoute).toContain('redirect: "error"');
    expect(directionsRoute).toContain('signal: AbortSignal.timeout(NAVER_DIRECTIONS_PROVIDER_TIMEOUT_MS)');
    expect(directionsRoute).toContain('const NAVER_DIRECTIONS_PROVIDER_TIMEOUT_MS = 7_500;');
    expect(directionsRoute).toContain('await response.body?.cancel();');
    expect(directionsRoute).toContain('cache: "no-store"');
    expect(directionsRoute).not.toContain('response.text()');
  });

  test('bounds streamed provider JSON before parsing and rejects oversized or malformed responses', () => {
    expect(directionsRoute).toContain('const MAX_NAVER_DIRECTIONS_RESPONSE_BYTES = 256 * 1024;');
    expect(directionsRoute).toContain('const reader = response.body.getReader();');
    expect(directionsRoute).toContain('totalBytes > MAX_NAVER_DIRECTIONS_RESPONSE_BYTES');
    expect(directionsRoute).toContain('await reader.cancel();');
    expect(directionsRoute).toContain('new TextDecoder("utf-8", { fatal: true })');
    expect(directionsRoute).toContain('value.code !== 0');
    expect(directionsRoute).toContain('NAVER_DIRECTIONS_RESPONSE_CONTENT_TYPE_INVALID');
  });

  test('allows only bounded request labels and route options while capping provider groups, candidates, and points', () => {
    expect(directionsRoute).toContain('const MAX_DIRECTIONS_POINT_ID_LENGTH = 96;');
    expect(directionsRoute).toContain('const MAX_DIRECTIONS_POINT_NAME_LENGTH = 160;');
    expect(directionsRoute).toContain('const MAX_NAVER_DIRECTIONS_ROUTE_GROUPS = 6;');
    expect(directionsRoute).toContain('const MAX_NAVER_DIRECTIONS_CANDIDATES_PER_GROUP = 3;');
    expect(directionsRoute).toContain('const MAX_NAVER_DIRECTIONS_PATH_POINTS = 2_000;');
    expect(directionsRoute).toContain('!isNaverDirectionsOption(label)');
    expect(directionsRoute).toContain('rawCandidates.length > MAX_NAVER_DIRECTIONS_CANDIDATES_PER_GROUP');
    expect(directionsRoute).toContain('rawCandidate.path.length > MAX_NAVER_DIRECTIONS_PATH_POINTS');
    expect(directionsRoute).toContain('!isValidLongitude(lng) || !isValidLatitude(lat)');
    expect(directionsRoute).toContain('error: "Invalid route option"');
    expect(directionsRoute).toContain('requestPoints.length > MAX_DIRECTIONS_POINTS');
    expect(directionsRoute).toContain('hasExactDirectionsRequestKeys(requestBody.value)');
    expect(directionsRoute).toContain('hasExactDirectionsPointKeys(point)');
    expect(directionsRoute).toContain('error: "Invalid route mode"');
  });

  test('rejects extra, missing, and mistyped Directions fields before budget reservation or provider egress', async () => {
    let budgetCalls = 0;
    let providerCalls = 0;
    const originalFetch = globalThis.fetch;
    const validPoints = [
      { lat: 37.5665, lng: 126.978 },
      { lat: 37.57, lng: 126.99 },
    ];
    const invalidBodies: unknown[] = [
      { points: validPoints, option: 'trafast', mode: 'driving', extra: true },
      {
        points: [{ lat: 37.5665, lng: 126.978, extra: true }, validPoints[1]],
        option: 'trafast',
        mode: 'driving',
      },
      {
        points: [{ lng: 126.978 }, validPoints[1]],
        option: 'trafast',
        mode: 'driving',
      },
      {
        points: [{ lat: '37.5665', lng: 126.978 }, validPoints[1]],
        option: 'trafast',
        mode: 'driving',
      },
      {
        points: [{ id: 1, lat: 37.5665, lng: 126.978 }, validPoints[1]],
        option: 'trafast',
        mode: 'driving',
      },
      { points: validPoints, option: 1, mode: 'driving' },
      { points: validPoints, option: 'trafast', mode: 'biking' },
      { points: validPoints, option: 'trafast', mode: 1 },
    ];
    mock.module('@/lib/auth/require-admin', () => ({
      requireAdmin: async () => ({ ok: true, userId: '11111111-1111-4111-8111-111111111111' }),
    }));
    mock.module('@/lib/security/admin-provider-budget', () => ({
      reserveAdminProviderBudget: async () => {
        budgetCalls += 1;
        throw new Error('budget must not run for invalid route requests');
      },
    }));
    globalThis.fetch = (async () => {
      providerCalls += 1;
      throw new Error('provider must not run for invalid route requests');
    }) as typeof fetch;

    try {
      const route = await loadDirectionsRoute();
      for (const body of invalidBodies) {
        const response = await route.POST(buildDirectionsRequest(body));
        expect(response.status).toBe(400);
      }
      expect(budgetCalls).toBe(0);
      expect(providerCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
      mock.restore();
    }
  });

  test('keeps coordinate-only callers compatible and reports no fallback distance without an artifact', async () => {
    const restoreCredentials = clearNaverDirectionsCredentials();
    let budgetCalls = 0;
    let providerCalls = 0;
    const originalFetch = globalThis.fetch;
    mock.module('@/lib/auth/require-admin', () => ({
      requireAdmin: async () => ({ ok: true, userId: '11111111-1111-4111-8111-111111111111' }),
    }));
    mock.module('@/lib/security/admin-provider-budget', () => ({
      reserveAdminProviderBudget: async () => {
        budgetCalls += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      },
    }));
    globalThis.fetch = (async () => {
      providerCalls += 1;
      throw new Error('provider must not run without credentials');
    }) as typeof fetch;

    try {
      const route = await loadDirectionsRoute();
      const response = await route.POST(buildDirectionsRequest({
        points: [
          { lat: 37.5665, lng: 126.978 },
          { lat: 37.57, lng: 126.99 },
        ],
        option: 'trafast',
        mode: 'driving',
      }));
      const payload = await response.json() as {
        fallbackContract: { distanceSource: string };
        path: unknown[];
        summary: unknown;
      };

      expect(response.status).toBe(200);
      expect(payload.path).toEqual([]);
      expect(payload.summary).toBeNull();
      expect(payload.fallbackContract.distanceSource).toBe('none');
      expect(budgetCalls).toBe(0);
      expect(providerCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
      restoreCredentials();
      mock.restore();
    }
  });

  test('extends the canonical budget contract and immutable policy table only through the additive migration', () => {
    for (const provider of ['naver_directions', 'openai_sponsor_analysis']) {
      expect(budgetHelper).toContain(`'${provider}'`);
      expect(generatedTypes).toContain(`'${provider}'`);
      expect(budgetMigration).toContain(`'${provider}'`);
    }

    const dropConstraintIndex = budgetMigration.indexOf('DROP CONSTRAINT admin_provider_budget_policies_provider_check');
    const disableTriggerIndex = budgetMigration.indexOf('DISABLE TRIGGER admin_provider_budget_policies_immutable');
    const insertIndex = budgetMigration.indexOf('INSERT INTO provider_budget_private.admin_provider_budget_policies');
    const enableTriggerIndex = budgetMigration.indexOf('ENABLE TRIGGER admin_provider_budget_policies_immutable');

    expect(budgetHelper).toContain(".rpc('reserve_admin_provider_budget'");
    expect(dropConstraintIndex).toBeGreaterThan(-1);
    expect(disableTriggerIndex).toBeGreaterThan(dropConstraintIndex);
    expect(insertIndex).toBeGreaterThan(disableTriggerIndex);
    expect(enableTriggerIndex).toBeGreaterThan(insertIndex);
    expect(budgetMigration).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
