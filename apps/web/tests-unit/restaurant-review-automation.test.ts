import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { parseReviewAutomationSnapshot, parseReviewAutomationPreview } from '@/lib/admin/restaurant-review-automation';
const uuid = '00000000-0000-4000-8000-000000000001';
const snapshot = { policy: { version: 1, enabled: false, batch_size: 50, daily_limit: 50, last_run_at: null }, runs: [], items: [], queue: { queued: 0, running: 0, failed: 0 }, judgmentEngine: { provider: 'gemini', model: 'gemini-3.8-flash', promptVersion: 'restaurant-review-v1', requiredForApproval: true, maxCallsPerClaim: 1 } };
let allowed = true;
let engineReady = true;
let failure: { message: string } | null = null;
const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
mock.module('@/lib/auth/require-admin', () => ({ requireAdmin: async () => allowed ? { ok: true, userId: uuid } : { ok: false, response: new Response(null, { status: 403 }) } }));
mock.module('@/lib/supabase/service-role', () => ({ createSupabaseServiceRoleClient: () => ({ rpc: async (name: string, args?: Record<string, unknown>) => { calls.push({ name, args }); return { data: engineReady ? snapshot : { ...snapshot, judgmentEngine: undefined }, error: failure }; } }) }));
const { GET, POST } = await import('@/app/api/admin/evaluations/automation/route');
beforeEach(() => { allowed = true; engineReady = true; failure = null; calls.length = 0; });
afterAll(() => mock.restore());
const request = (body: unknown, origin = 'http://127.0.0.1:18794') => new Request('http://127.0.0.1:18794/api/admin/evaluations/automation', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
const manualRun = { action: 'run', requestId: uuid, version: '1', previewHash: 'a'.repeat(32), confirmation: '지금 실행' };

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
    expect(calls[0]).toEqual({ name: 'restaurant_review_automation_status', args: undefined });
    expect(calls[1]).toEqual({ name: 'restaurant_review_automation_configure', args: { actor: uuid, action: 'start', expected_version: '1', preview_hash: 'a'.repeat(32), batch_size: 50, daily_limit: 50 } });
  });
  test('run reads durable state after applying the supplied idempotency id', async () => {
    const response = await POST(request(manualRun));
    expect(response.status).toBe(200);
    expect(calls.map(call => call.name)).toEqual(['restaurant_review_automation_status', 'restaurant_review_automation_manual']);
    expect(calls[1]?.args).toEqual({ actor: uuid, action: 'run', request_id: uuid, expected_version: '1', preview_hash: 'a'.repeat(32) });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  test('manual run and cancellation require a preview and exact confirmation', async () => {
    for (const body of [{ action: 'run', requestId: uuid }, { ...manualRun, confirmation: '자동 승인 시작' }, { ...manualRun, previewHash: '' }, { ...manualRun, requestId: 'invalid' }, { action: 'stop', version: '1' }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
    expect((await POST(request({ action: 'stop', version: '1', previewHash: 'a'.repeat(32), confirmation: '자동 운영 중지' }))).status).toBe(200);
    expect(calls[0]?.args).toEqual({ actor: uuid, action: 'stop', request_id: null, expected_version: '1', preview_hash: 'a'.repeat(32) });
  });
  test('manual previews read server policy and queue without applying work', async () => {
    for (const action of ['preview-run','preview-stop']) expect((await POST(request({ action }))).status).toBe(200);
    expect(calls).toEqual(['preview-run','preview-stop'].map(action => ({ name: 'restaurant_review_automation_manual', args: { actor: uuid, action, expected_version: '', preview_hash: '', request_id: null } })));
  });
  test('provider/database diagnostics are never returned or retried', async () => {
    failure = { message: 'sensitive-provider-diagnostic' };
    const response = await POST(request(manualRun));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'AUTOMATION_UNAVAILABLE' });
    expect(calls.length).toBe(1);
    failure = { message: 'REVIEW_AUTOMATION_STALE' };
    expect((await POST(request({ action: 'preview' }))).status).toBe(409);
  });
  test('missing Gemini contract blocks start and run before mutation while reads and stop remain available', async () => {
    engineReady = false;
    for (const body of [{ action: 'start', version: '1', previewHash: 'a'.repeat(32), confirmation: '자동 승인 시작' }, manualRun]) {
      calls.length = 0;
      const response = await POST(request(body));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'AUTOMATION_GEMINI_JUDGMENT_REQUIRED' });
      expect(calls.map(call => call.name)).toEqual(['restaurant_review_automation_status']);
    }
    calls.length = 0;
    expect((await GET()).status).toBe(200);
    expect((await POST(request({ action: 'stop', version: '1', previewHash: 'a'.repeat(32), confirmation: '자동 운영 중지' }))).status).toBe(200);
    expect(calls.map(call => call.name)).toEqual(['restaurant_review_automation_status', 'restaurant_review_automation_manual']);
  });
  test('malformed projections cannot crash the status UI or become preview authority', () => {
    expect(parseReviewAutomationSnapshot(snapshot)).toEqual(snapshot);
    for (const value of [{ record: null }, { ...snapshot, queue: { queued: -1, running: 0, failed: 0 } }, { ...snapshot, runs: Array(11).fill({}) }]) expect(() => parseReviewAutomationSnapshot(value)).toThrow();
    expect(parseReviewAutomationPreview({ version: '1', previewHash: 'a'.repeat(32), counts: { approve: 1 }, batchSize: 50, dailyLimit: 50 }).counts.approve).toBe(1);
    expect(() => parseReviewAutomationPreview({ version: '1', previewHash: 'a'.repeat(32), counts: { unknown: 1 }, batchSize: 50, dailyLimit: 50 })).toThrow();
    const manual = { version: '1', previewHash: 'a'.repeat(32), counts: { approve: 1 }, batchSize: 50, dailyLimit: 50, action: 'stop', queue: { queued: 2, running: 1 }, remainingApprovals: 1 };
    expect(parseReviewAutomationPreview(manual).queue).toEqual({ queued: 2, running: 1 });
    for (const changes of [{ action: 'delete' }, { queue: { queued: -1, running: 1 } }, { remainingApprovals: undefined }]) expect(() => parseReviewAutomationPreview({ ...manual, ...changes })).toThrow();
  });
});
