import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AdminSentryResponse } from '../types/admin-sentry';

let authStatus = 200;
const feed: AdminSentryResponse = { state: 'not_configured', collection: { browser: false, server: false }, dashboardUrl: null, issues: [], nextCursor: null, fetchedAt: null };
const read = mock(async () => feed);
mock.module('@/lib/auth/require-admin', () => ({ requireAdmin: async () => authStatus === 200 ? { ok: true } : { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: authStatus }) } }));
mock.module('@/lib/monitoring/sentry-admin', () => ({ getAdminSentryIssues: read, validSentryCursor: (cursor: string | null) => cursor === null || /^\d{1,20}:\d{1,10}:[01]$/.test(cursor) }));
const { GET } = await import('../app/api/admin/sentry/route');

beforeEach(() => { authStatus = 200; read.mockClear(); });
describe('Sentry admin authorization and query boundary', () => {
  test('denies unauthenticated and non-admin users before provider lookup', async () => {
    for (const status of [401, 403]) {
      authStatus = status;
      expect((await GET(new Request('https://tzudong.app/api/admin/sentry'))).status).toBe(status);
    }
    expect(read).not.toHaveBeenCalled();
  });
  test('returns only a private noncacheable admin response', async () => {
    const response = await GET(new Request('https://tzudong.app/api/admin/sentry'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(feed);
    expect(read).toHaveBeenCalledWith('unresolved', null);
  });
  test('rejects provider URLs, arbitrary search and malformed status/cursor', async () => {
    for (const query of ['status=invalid', 'cursor=secret', 'url=http://localhost', 'query=token', 'status=unresolved&other=x']) {
      expect((await GET(new Request(`https://tzudong.app/api/admin/sentry?${query}`))).status).toBe(400);
    }
    expect(read).not.toHaveBeenCalled();
  });
});
