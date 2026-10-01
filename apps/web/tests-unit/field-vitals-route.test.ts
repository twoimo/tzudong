import { afterAll, beforeEach, expect, mock, test } from 'bun:test';

const originalEnv = { VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA };
let calls: unknown[] = [];
let providerError: unknown = null;
mock.module('@/lib/supabase/service-role', () => ({
  createSupabaseServiceRoleClient: () => ({ rpc: (name: string, args: unknown) => {
    calls.push({ name, args });
    return { abortSignal: async () => ({ error: providerError }) };
  } }),
}));
const { POST } = await import('../app/api/performance/web-vitals/route');
beforeEach(() => { calls = []; providerError = null; process.env.VERCEL_ENV = 'production'; process.env.VERCEL_GIT_COMMIT_SHA = 'a'.repeat(40); });
afterAll(() => { for (const [key, value] of Object.entries(originalEnv)) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
} });
const sample = { version: 1, device: 'desktop', metric: 'LCP', navigation: 'navigate', bucket: 25, release: 'a'.repeat(40) };
function request(body: unknown, extra: Record<string, string> = {}) {
  return new Request('https://www.tzudong.app/api/performance/web-vitals', { method: 'POST',
    headers: { Origin: 'https://www.tzudong.app', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body),
  });
}
test('uses server release binding and sends only allowlisted aggregate coordinates', async () => {
  expect((await POST(request(sample))).status).toBe(204);
  expect(calls).toEqual([{ name: 'record_app_web_vitals', args: { p_release: 'a'.repeat(40), p_device: 'desktop', p_metric: 'LCP', p_navigation: 'navigate', p_bucket: 25 } }]);
});
test('rejects cross-origin, auth bypass, invalid bodies and oversize without RPC', async () => {
  expect((await POST(request(sample, { Origin: 'https://outside.invalid', Authorization: 'Bearer test-only' }))).status).toBe(403);
  expect((await POST(request(sample, { 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(403);
  expect((await POST(request({ ...sample, release: 'b'.repeat(40) }))).status).toBe(409);
  expect((await POST(request({ padding: 'x'.repeat(600) }))).status).toBe(400);
  expect(calls).toHaveLength(0);
});
test('fails closed outside production and returns fixed provider failures', async () => {
  process.env.VERCEL_ENV = 'preview';
  expect((await POST(request(sample))).status).toBe(503);
  expect(calls).toHaveLength(0);
  process.env.VERCEL_ENV = 'production'; providerError = { message: 'test-only-provider-detail' };
  const response = await POST(request(sample));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: 'field_collection_unavailable' });
});
