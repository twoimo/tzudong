import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildTrendJobParametersHash,
  buildTrendJobRequestHash,
  normalizeTrendJobRequestBody,
} from '../lib/admin-trend-jobs';

const webRoot = join(import.meta.dir, '..');
const repoRoot = join(webRoot, '..', '..');

function source(path: string) {
  return readFileSync(join(webRoot, path), 'utf8');
}

function repoSource(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('trend job request source contract', () => {
  test('normalizes and hashes trend job enqueue requests deterministically', () => {
    const normalized = normalizeTrendJobRequestBody({
      requestKind: 'dry_run',
      parameters: {
        z: undefined,
        sourceProfile: 'youtube_snapshot_plus_seasonal_v1',
        window: { to: '2026-07-08T00:00:00.000Z', from: '2026-07-07T00:00:00.000Z' },
        dryRun: true,
      },
      correlationId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: 'trend-job-001',
    });

    expect(buildTrendJobParametersHash(normalized.parameters)).toHaveLength(64);
    expect(buildTrendJobRequestHash(normalized)).toHaveLength(64);
    expect(buildTrendJobParametersHash({ dryRun: true, sourceProfile: 'youtube_snapshot_plus_seasonal_v1', window: { from: '2026-07-07T00:00:00.000Z', to: '2026-07-08T00:00:00.000Z' } })).toBe(
      buildTrendJobParametersHash(normalized.parameters),
    );
    expect(() => normalizeTrendJobRequestBody({
      requestKind: 'dry_run',
      parameters: { window: { from: '2026-07-08T00:00:00.000Z', to: '2026-07-07T00:00:00.000Z' } },
      correlationId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: 'trend-job-002',
    })).toThrow('trend_job_request_window_invalid');
  });

  test('admin trend job routes guard before body/service-role work and do not run collectors inline', () => {
    const enqueue = source('app/api/admin/trend-job-requests/route.ts');
    const status = source('app/api/admin/trend-job-requests/[requestId]/route.ts');
    const cancel = source('app/api/admin/trend-job-requests/[requestId]/cancel/route.ts');

    for (const route of [enqueue, status, cancel]) {
      expect(route.indexOf('const admin = await requireAdmin();')).toBeGreaterThanOrEqual(0);
      expect(route.indexOf('createSupabaseServiceRoleClient()')).toBeGreaterThan(route.indexOf('if (!admin.ok)'));
      expect(route).toContain("response.headers.set('Cache-Control', 'no-store')");
      expect(route).not.toContain('run_trend_dry_run');
      expect(route).not.toContain('collect_google_cse');
      expect(route).not.toContain('score_trend_candidate');
    }

    expect(enqueue).toContain('buildTrendJobParametersHash');
    expect(enqueue).toContain('buildTrendJobRequestHash');
    expect(enqueue).toContain('trend_job_request_idempotency_conflict');
    expect(enqueue).toContain('statusUrlForTrendJobRequest');
    expect(enqueue).toContain('const { data: racedData, error: racedError } = await supabase');
    expect(enqueue).toContain('const raced = racedError ? null : readRowObject(racedData)');
    expect(enqueue).toContain('const replayedRow = mapTrendJobRequestRow(raced)');
    expect((enqueue.match(/\.eq\('requested_by_admin_id', admin\.userId\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(status).toContain('trend_job_request_not_found');
    expect(status).toContain(".eq('requested_by_admin_id', admin.userId)");
    expect(cancel).toContain("current.status === 'claimed'");
    expect(cancel).toContain('trend_job_request_already_claimed');
    expect(cancel).toContain('trend_job_request_terminal');
    expect(cancel).toContain(".select('status')");
    expect(cancel).toContain("raced?.status === 'claimed'");
    expect((cancel.match(/\.eq\('requested_by_admin_id', admin\.userId\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(cancel).not.toContain('cancel_requested');
  });

  test('service-role RPC migration claims and finalizes queued/stale claimed jobs only', () => {
    const migration = repoSource('backend/supabase/migrations/20260707000400_admin_trend_job_request_rpcs.sql');

    expect(migration).not.toContain('cancel_requested');
    for (const functionName of [
      'claim_admin_trend_job_request',
      'complete_admin_trend_job_request',
      'fail_admin_trend_job_request',
    ]) {
      expect(migration).toContain(`public.${functionName}`);
      expect(migration).toContain('auth.role() <> \'service_role\'');
      expect(migration).toContain(`grant execute on function public.${functionName}`);
      expect(migration).toContain(`revoke all on function public.${functionName}`);
    }

    expect(migration).toContain('for update skip locked');
    expect(migration).toContain("status = 'queued'");
    expect(migration).toContain("status = 'claimed' and claimed_at < timezone('utc'::text, now()) - p_stale_after and completed_at is null");
    expect(migration).toContain("set status = 'claimed'");
    expect(migration).toContain("set status = 'succeeded'");
    expect(migration).toContain("set status = 'failed'");
    expect(migration).toContain("and status = 'claimed'");
    expect(migration).toContain('and claimed_by = p_claimed_by');
  });

  test('Supabase types expose trend job table statuses and worker RPC signatures', () => {
    const types = source('integrations/supabase/types.ts');

    expect(types).not.toContain('cancel_requested');
    expect(types).toContain("status: 'queued' | 'claimed' | 'succeeded' | 'failed' | 'cancelled'");
    expect(types).toContain('claim_admin_trend_job_request');
    expect(types).toContain('complete_admin_trend_job_request');
    expect(types).toContain('fail_admin_trend_job_request');
    expect(types).toContain('p_claimed_by: string');
    expect(types).toContain('p_result_summary?: Json');
  });
});
