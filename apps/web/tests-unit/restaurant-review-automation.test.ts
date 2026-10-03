import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { parseReviewAutomationSnapshot, parseReviewAutomationPreview } from '@/lib/admin/restaurant-review-automation';
const uuid = '00000000-0000-4000-8000-000000000001';
const snapshot = { policy: { version: 1, enabled: false, batch_size: 50, daily_limit: 50, last_run_at: null }, runs: [], items: [], queue: { queued: 0, running: 0, failed: 0 } };
let allowed = true;
let failure: { message: string } | null = null;
const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
mock.module('@/lib/auth/require-admin', () => ({ requireAdmin: async () => allowed ? { ok: true, userId: uuid } : { ok: false, response: new Response(null, { status: 403 }) } }));
mock.module('@/lib/supabase/service-role', () => ({ createSupabaseServiceRoleClient: () => ({ rpc: async (name: string, args?: Record<string, unknown>) => { calls.push({ name, args }); return { data: snapshot, error: failure }; } }) }));
const { GET, POST } = await import('@/app/api/admin/evaluations/automation/route');
beforeEach(() => { allowed = true; failure = null; calls.length = 0; });
afterAll(() => mock.restore());
const request = (body: unknown, origin = 'http://127.0.0.1:18794') => new Request('http://127.0.0.1:18794/api/admin/evaluations/automation', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });

describe('restaurant automation boundaries', () => {
  test('requires administrator before reads or mutations', async () => {
    allowed = false;
    expect((await GET()).status).toBe(403);
    expect((await POST(request({ action: 'preview' }))).status).toBe(403);
    expect(calls.length).toBe(0);
  });
  test('rejects foreign origins, invalid actions, and bounds before RPC', async () => {
    expect((await POST(request({ action: 'preview' }, 'https://untrusted.test'))).status).toBe(403);
    for (const body of [{ action: 'delete' }, { action: 'preview', batchSize: 201 }, { action: 'preview', dailyLimit: 0 }, { action: 'preview', batchSize: 1.5 }]) expect((await POST(request(body))).status).toBe(400);
    expect(calls.length).toBe(0);
  });
  test('activation requires reviewed hash, version and exact confirmation', async () => {
    expect((await POST(request({ action: 'start', version: '1', previewHash: 'a'.repeat(32) }))).status).toBe(400);
    expect(calls.length).toBe(0);
    expect((await POST(request({ action: 'start', version: '1', previewHash: 'a'.repeat(32), confirmation: '자동 승인 시작' }))).status).toBe(200);
    expect(calls[0]).toEqual({ name: 'restaurant_review_automation_configure', args: { actor: uuid, action: 'start', expected_version: '1', preview_hash: 'a'.repeat(32), batch_size: 50, daily_limit: 50 } });
  });
  test('run reads durable state after applying the supplied idempotency id', async () => {
    const response = await POST(request({ action: 'run', requestId: uuid }));
    expect(response.status).toBe(200);
    expect(calls.map(call => call.name)).toEqual(['restaurant_review_automation_tick', 'restaurant_review_automation_status']);
    expect(calls[0]?.args).toEqual({ request_id: uuid });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  test('provider/database diagnostics are never returned or retried', async () => {
    failure = { message: 'sensitive-provider-diagnostic' };
    const response = await POST(request({ action: 'run', requestId: uuid }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'AUTOMATION_UNAVAILABLE' });
    expect(calls.length).toBe(1);
    failure = { message: 'REVIEW_AUTOMATION_STALE' };
    expect((await POST(request({ action: 'preview' }))).status).toBe(409);
  });
  test('malformed projections cannot crash the status UI or become preview authority', () => {
    expect(parseReviewAutomationSnapshot(snapshot)).toEqual(snapshot);
    for (const value of [{ record: null }, { ...snapshot, queue: { queued: -1, running: 0, failed: 0 } }, { ...snapshot, runs: Array(11).fill({}) }]) expect(() => parseReviewAutomationSnapshot(value)).toThrow();
    expect(parseReviewAutomationPreview({ version: '1', previewHash: 'a'.repeat(32), counts: { approve: 1 }, batchSize: 50, dailyLimit: 50 }).counts.approve).toBe(1);
    expect(() => parseReviewAutomationPreview({ version: '1', previewHash: 'a'.repeat(32), counts: { unknown: 1 }, batchSize: 50, dailyLimit: 50 })).toThrow();
  });
});
