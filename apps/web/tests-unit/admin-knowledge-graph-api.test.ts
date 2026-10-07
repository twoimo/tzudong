import { beforeEach, describe, expect, mock, test } from 'bun:test';

let authStatus = 200;
mock.module('@/lib/auth/require-admin', () => ({ requireAdmin: async () => authStatus === 200 ? { ok: true } : { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: authStatus }) } }));
const { GET } = await import('../app/api/admin/knowledge-graph/route');
beforeEach(() => { authStatus = 200; });

describe('knowledge graph admin boundary', () => {
  test('denies both browser roles and keeps the valid admin feed private', async () => {
    for (const status of [401, 403]) { authStatus = status; expect((await GET(new Request('https://tzudong.app/api/admin/knowledge-graph'))).status).toBe(status); }
    authStatus = 200; const response = await GET(new Request('https://tzudong.app/api/admin/knowledge-graph'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json(); expect(body.coverage.analyzedCount).toBe(0); expect(body.nodes.length).toBeGreaterThan(0); expect(body.nodes.length).toBeLessThanOrEqual(100);
  });
  test('returns fixed bounded errors for malformed public input', async () => {
    const response = await GET(new Request('https://tzudong.app/api/admin/knowledge-graph?limit=999&url=http://localhost'));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'knowledge_query_invalid' });
  });
});
