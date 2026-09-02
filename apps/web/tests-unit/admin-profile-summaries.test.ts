import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

import {
  ADMIN_PROFILE_SUMMARY_BATCH_SIZE,
  ADMIN_PROFILE_SUMMARY_MAX_CONCURRENCY,
  fetchAdminProfileSummaries,
  mapAdminProfileSummaryRpcRows,
  parseAdminProfileSummaryRequest,
} from '../lib/admin/profile-summaries';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const userId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

describe('admin profile summary boundary', () => {
  test('strictly parses exact, distinct UUID batches capped at 100', () => {
    const oneHundredIds = Array.from({ length: ADMIN_PROFILE_SUMMARY_BATCH_SIZE }, (_, index) => userId(index));

    expect(parseAdminProfileSummaryRequest({ userIds: oneHundredIds })).toEqual(oneHundredIds);
    expect(parseAdminProfileSummaryRequest({ userIds: [] })).toBeNull();
    expect(parseAdminProfileSummaryRequest({ userIds: [...oneHundredIds, userId(100)] })).toBeNull();
    expect(parseAdminProfileSummaryRequest({ userIds: [userId(1), userId(1)] })).toBeNull();
    expect(parseAdminProfileSummaryRequest({ userIds: ['not-a-uuid'] })).toBeNull();
    expect(parseAdminProfileSummaryRequest({ userIds: [userId(1)], unexpected: true })).toBeNull();
  });

  test('projects complete RPC readback to userId and nickname only', () => {
    const requestedUserIds = [userId(1), userId(2)];
    const rows = mapAdminProfileSummaryRpcRows([
      {
        user_id: requestedUserIds[0],
        nickname: '첫 번째',
        username: 'must-not-leak',
        avatar_url: 'https://private.example/avatar',
        account_status: 'active',
        is_admin: true,
      },
      {
        user_id: requestedUserIds[1],
        nickname: null,
        username: 'must-not-leak-either',
      },
    ], requestedUserIds);

    expect(rows).toEqual([
      { userId: requestedUserIds[0], nickname: '첫 번째' },
      { userId: requestedUserIds[1], nickname: null },
    ]);
    expect(JSON.stringify(rows)).not.toContain('must-not-leak');
    expect(mapAdminProfileSummaryRpcRows([], requestedUserIds)).toBeNull();
    expect(mapAdminProfileSummaryRpcRows([
      { user_id: requestedUserIds[0], nickname: '첫 번째' },
    ], requestedUserIds)).toBeNull();
    expect(mapAdminProfileSummaryRpcRows([
      { user_id: requestedUserIds[0], nickname: '첫 번째' },
      { user_id: requestedUserIds[0], nickname: '중복' },
    ], requestedUserIds)).toBeNull();
  });

  test('uses at most four concurrent POST batches and preserves input order', async () => {
    const originalFetch = globalThis.fetch;
    const batchSizes: number[] = [];
    const methods: Array<string | undefined> = [];
    let inFlight = 0;
    let maximumInFlight = 0;

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body)) as { userIds: string[] };
      batchSizes.push(parsed.userIds.length);
      methods.push(init?.method);
      expect(init?.credentials).toBe('same-origin');
      expect(init?.cache).toBe('no-store');
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return Response.json({
          rows: parsed.userIds.map((id) => ({
            userId: id,
            nickname: `nickname-${id.slice(-3)}`,
          })),
        });
      } finally {
        inFlight -= 1;
      }
    }) as typeof fetch;

    try {
      const requestedUserIds = Array.from({ length: 901 }, (_, index) => userId(index));
      const rows = await fetchAdminProfileSummaries(
        requestedUserIds,
      );
      expect(rows.map((row) => row.userId)).toEqual(requestedUserIds);
      expect(batchSizes).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 100, 1]);
      expect(methods).toEqual(Array.from({ length: 10 }, () => 'POST'));
      expect(maximumInFlight).toBe(ADMIN_PROFILE_SUMMARY_MAX_CONCURRENCY);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects the whole multi-batch read when any bounded batch fails', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      const parsed = JSON.parse(String(init?.body)) as { userIds: string[] };
      if (callCount === 3) return Response.json({}, { status: 502 });
      return Response.json({
        rows: parsed.userIds.map((id) => ({ userId: id, nickname: null })),
      });
    }) as typeof fetch;

    try {
      await expect(fetchAdminProfileSummaries(
        Array.from({ length: 401 }, (_, index) => userId(index)),
      )).rejects.toThrow('admin-profile-summaries-failed');
      expect(callCount).toBe(ADMIN_PROFILE_SUMMARY_MAX_CONCURRENCY);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('normalizes a rejected fetch without preserving provider diagnostics', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      throw new Error('private provider password=must-not-leak');
    }) as typeof fetch;

    try {
      let error: unknown;
      try {
        await fetchAdminProfileSummaries([userId(1)]);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain('admin-profile-summaries-failed');
      expect(String(error)).not.toContain('must-not-leak');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('keeps the route auth-first, fixed-response, no-store, and service-role contained', async () => {
    type RouteState = {
      auth: 'ok' | 'forbidden';
      rpcError: unknown | null;
      serviceRoleCalls: number;
      rpcCalls: Array<{ functionName: string; args: unknown }>;
    };
    const state: RouteState = {
      auth: 'forbidden',
      rpcError: null,
      serviceRoleCalls: 0,
      rpcCalls: [],
    };

    mock.module('@/lib/auth/require-admin', () => ({
      requireAdmin: async () => state.auth === 'ok'
        ? { ok: true, userId: userId(999) }
        : { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) },
    }));
    mock.module('@/lib/supabase/service-role', () => ({
      createSupabaseServiceRoleClient: () => {
        state.serviceRoleCalls += 1;
        return {
          rpc(functionName: string, args: { p_user_ids: string[] }) {
            state.rpcCalls.push({ functionName, args });
            return Promise.resolve(state.rpcError
              ? { data: null, error: state.rpcError }
              : {
                  data: args.p_user_ids.map((id) => ({
                    user_id: id,
                    nickname: '관리자 표시 이름',
                    username: 'private-username',
                    avatar_url: 'https://private.example/avatar',
                    profile_role: 'admin',
                    is_admin: true,
                    account_status: 'active',
                  })),
                  error: null,
                });
          },
        };
      },
    }));

    const route = await import(`../app/api/admin/profile-summaries/route.ts?cache=${Math.random()}`);
    const request = (body: unknown, headers: HeadersInit = {}) => new NextRequest(
      'http://localhost:3000/api/admin/profile-summaries',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-only-token',
          ...headers,
        },
        body: JSON.stringify(body),
      },
    );

    try {
      const forbidden = await route.POST(request({ userIds: [userId(1)] }));
      expect(forbidden.status).toBe(403);
      expect(forbidden.headers.get('cache-control')).toBe('no-store');
      expect(state.serviceRoleCalls).toBe(0);

      state.auth = 'ok';
      const untrusted = await route.POST(request(
        { userIds: [userId(1)] },
        { Authorization: '', Cookie: 'sb-session=browser', Origin: 'https://evil.example' },
      ));
      expect(untrusted.status).toBe(403);
      expect(await untrusted.json()).toEqual({
        code: 'ADMIN_PROFILE_SUMMARIES_FORBIDDEN',
        error: 'Forbidden',
      });
      expect(state.serviceRoleCalls).toBe(0);

      const invalid = await route.POST(request({ userIds: [userId(1), userId(1)] }));
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({
        code: 'ADMIN_PROFILE_SUMMARIES_INVALID_REQUEST',
        error: 'Invalid request',
      });
      expect(state.serviceRoleCalls).toBe(0);

      const success = await route.POST(request({ userIds: [userId(1)] }));
      const successPayload = await success.json();
      expect(success.status).toBe(200);
      expect(success.headers.get('cache-control')).toBe('no-store');
      expect(successPayload).toEqual({
        rows: [{ userId: userId(1), nickname: '관리자 표시 이름' }],
      });
      expect(JSON.stringify(successPayload)).not.toContain('private-username');
      expect(JSON.stringify(successPayload)).not.toContain('avatar');
      expect(state.rpcCalls).toEqual([{
        functionName: 'read_admin_user_management_metadata',
        args: { p_user_ids: [userId(1)] },
      }]);

      const originalConsoleError = console.error;
      const logged: unknown[][] = [];
      console.error = (...args: unknown[]) => logged.push(args);
      state.rpcError = { message: 'provider password=must-not-leak', details: { token: 'secret' } };
      try {
        const unavailable = await route.POST(request({ userIds: [userId(2)] }));
        expect(unavailable.status).toBe(502);
        expect(await unavailable.json()).toEqual({
          code: 'ADMIN_PROFILE_SUMMARIES_UNAVAILABLE',
          error: 'Profile summaries unavailable',
        });
        expect(JSON.stringify(logged)).not.toContain('must-not-leak');
        expect(JSON.stringify(logged)).not.toContain('secret');
      } finally {
        console.error = originalConsoleError;
      }
    } finally {
      mock.restore();
    }
  });

  test('removes direct profiles reads from every converted admin caller', () => {
    const routeSource = source('app/api/admin/profile-summaries/route.ts');
    const helperSource = source('lib/admin/profile-summaries.ts');
    const reviewPanelSource = source('components/admin/AdminReviewPanel.tsx');
    const evaluationsSource = source('app/admin/evaluations/admin-evaluation-page.tsx');
    const routePost = routeSource.slice(routeSource.indexOf('export async function POST'));

    expect(routeSource).toContain("export const runtime = 'nodejs'");
    expect(routeSource).toContain("export const dynamic = 'force-dynamic'");
    expect(routeSource).toContain('readBoundedJsonRequest(request, MAX_PROFILE_SUMMARIES_REQUEST_BYTES)');
    expect(routeSource).toContain('isTrustedSameOriginMutation(request)');
    expect(routeSource).toContain("'read_admin_user_management_metadata'");
    expect(routeSource).not.toContain(".from('profiles')");
    expect(routeSource).not.toContain('request.json()');
    expect(routeSource).not.toContain('request.text()');
    expect(routePost.indexOf('await requireAdmin()')).toBeLessThan(
      routePost.indexOf('createSupabaseServiceRoleClient()'),
    );
    expect(routePost.indexOf('await requireAdmin()')).toBeLessThan(
      routePost.indexOf('readBoundedJsonRequest('),
    );
    expect(helperSource).toContain("fetch('/api/admin/profile-summaries', {");
    expect(helperSource).toContain("method: 'POST'");
    expect(helperSource).toContain('ADMIN_PROFILE_SUMMARY_MAX_CONCURRENCY = 4');
    expect(helperSource).toContain('.slice(offset, offset + ADMIN_PROFILE_SUMMARY_MAX_CONCURRENCY)');

    for (const callerSource of [reviewPanelSource, evaluationsSource]) {
      expect(callerSource).toContain('fetchAdminProfileSummaries');
      expect(callerSource).not.toMatch(/\.from\(['"]profiles['"]\)/);
      expect(callerSource).not.toContain('/api/admin/profile-summaries?');
    }
    expect(reviewPanelSource.match(/fetchAdminProfileSummaries\(/g)).toHaveLength(1);
    expect(evaluationsSource.match(/fetchAdminProfileSummaries\(/g)).toHaveLength(3);
  });
});
