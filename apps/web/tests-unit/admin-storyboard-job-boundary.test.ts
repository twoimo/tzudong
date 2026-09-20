import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { NextRequest } from 'next/server';

const actorId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const diagnostic = 'authorization=Bearer private-provider-token user@example.com';
let deniedStatus = 0;
let clientFailure = false;
let calls: unknown[][] = [];
let results: { data: unknown; error: unknown }[] = [];
let rejectQuery = false;

mock.module('@/lib/auth/require-admin', () => ({
  requireAdmin: async () => deniedStatus
    ? { ok: false, response: Response.json({ error: 'Forbidden' }, { status: deniedStatus }) }
    : { ok: true, userId: actorId },
}));
mock.module('@/lib/supabase/service-role', () => ({
  createSupabaseServiceRoleClient: () => {
    calls.push(['client']);
    if (clientFailure) throw new Error(diagnostic);
    const builder = {
      from: (...args: unknown[]) => { calls.push(['from', ...args]); return builder; },
      select: (...args: unknown[]) => { calls.push(['select', ...args]); return builder; },
      update: (...args: unknown[]) => { calls.push(['update', ...args]); return builder; },
      eq: (...args: unknown[]) => { calls.push(['eq', ...args]); return builder; },
      in: (...args: unknown[]) => { calls.push(['in', ...args]); return builder; },
      maybeSingle: async () => {
        if (rejectQuery) throw new Error(diagnostic);
        return results.shift() ?? { data: null, error: null };
      },
    };
    return builder;
  },
}));

const statusRoute = await import('../app/api/admin/storyboard/jobs/[jobId]/route');
const cancelRoute = await import('../app/api/admin/storyboard/jobs/[jobId]/cancel/route');
const previousSite = process.env.NEXT_PUBLIC_SITE_URL;
let log: ReturnType<typeof spyOn>;

beforeEach(() => {
  deniedStatus = 0;
  clientFailure = false;
  rejectQuery = false;
  calls = [];
  results = [];
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com';
  log = spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  if (previousSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = previousSite;
});

const cases = [
  { name: 'status', invoke: (id = jobId, origin = 'https://example.com') => statusRoute.GET(request('GET', origin), { params: Promise.resolve({ jobId: id }) }), error: 'storyboard_job_status_failed' },
  { name: 'cancel', invoke: (id = jobId, origin = 'https://example.com') => cancelRoute.POST(request('POST', origin), { params: Promise.resolve({ jobId: id }) }), error: 'storyboard_job_cancel_failed' },
];

function request(method: string, origin: string) {
  return new Request('https://example.com/api/admin/storyboard/jobs/' + jobId, {
    method, headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
  }) as NextRequest;
}

function row() {
  return {
    id: jobId, requested_by_admin_id: actorId, status: 'queued', stage: 'queued',
    request_payload: { private: diagnostic }, result_payload: null, error_code: null,
    readiness: null, claimed_by: null, claimed_at: null, completed_at: null,
    cancelled_at: null, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z',
  };
}

describe('storyboard job route boundaries', () => {
  for (const route of cases) {
    test(`${route.name}: denies unauthenticated/non-admin access before client creation`, async () => {
      for (const status of [401, 403]) {
        deniedStatus = status;
        const response = await route.invoke();
        expect(response.status).toBe(status);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(calls).toEqual([]);
      }
    });

    test(`${route.name}: rejects empty, oversized, and injection IDs without reflecting them or querying`, async () => {
      for (const id of ['', ' ', 'null', diagnostic, 'id.eq.foo),or(id.neq.bar', '../secrets', 'a'.repeat(4096)]) {
        const response = await route.invoke(id);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ ok: false, error: 'invalid_storyboard_job_id' });
        expect(response.headers.get('Cache-Control')).toBe('no-store');
      }
      expect(calls).toEqual([]);
    });

    test(`${route.name}: retains success shape and actor ownership filters`, async () => {
      results.push({ data: row(), error: null });
      const response = await route.invoke();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.job.jobId).toBe(jobId);
      expect(JSON.stringify(body)).not.toContain(diagnostic);
      expect(calls).toContainEqual(['eq', 'requested_by_admin_id', actorId]);
      expect(calls).toContainEqual(['eq', 'id', jobId]);
    });

    test(`${route.name}: empty owner-scoped results remain not found`, async () => {
      const response = await route.invoke();
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe('storyboard_job_not_found');
    });

    for (const failure of ['client', 'rejection', 'returned'] as const) {
      test(`${route.name}: ${failure} failure returns a fixed code with sanitized correlated logs`, async () => {
        clientFailure = failure === 'client';
        rejectQuery = failure === 'rejection';
        if (failure === 'returned') results.push({ data: null, error: { message: diagnostic, code: diagnostic } });
        const response = await route.invoke();
        expect(response.status).toBe(502);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        const payload = await response.json();
        expect(payload.error).toBe(route.error);
        expect(payload.traceId).toMatch(/^[a-f0-9-]{36}$/);
        expect(log).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(log.mock.calls)).toContain(payload.traceId);
        expect(JSON.stringify([payload, log.mock.calls])).not.toContain(diagnostic);
        expect(JSON.stringify([payload, log.mock.calls])).not.toContain('private-provider-token');
      });
    }
  }

  test('cancel rejects cross-origin requests before the database boundary', async () => {
    expect((await cases[1].invoke(jobId, 'https://attacker.example')).status).toBe(403);
    expect(calls).toEqual([]);
  });

  test('cancel keeps replay readback scoped to the actor and handles readback errors', async () => {
    results.push({ data: null, error: null }, { data: row(), error: null });
    const replay = await cases[1].invoke();
    expect((await replay.json()).replay).toBe(true);
    expect(calls.filter((call) => call[0] === 'eq' && call[1] === 'requested_by_admin_id')).toHaveLength(2);
    expect(calls).toContainEqual(['in', 'status', ['queued', 'claimed']]);
    results.push({ data: null, error: null }, { data: null, error: { message: diagnostic } });
    const failure = await cases[1].invoke();
    expect(failure.status).toBe(502);
    expect((await failure.json()).error).toBe('storyboard_job_cancel_failed');
    expect(log).toHaveBeenCalledTimes(1);
  });
});
