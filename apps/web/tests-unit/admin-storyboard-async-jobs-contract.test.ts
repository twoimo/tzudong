import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appRoot = join(import.meta.dir, '..');

function source(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function exportedHandlerBody(sourceText: string, method: string) {
  const marker = `export async function ${method}`;
  const start = sourceText.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = sourceText.indexOf('{', start + marker.length);
  let depth = 0;
  for (let index = open; index < sourceText.length; index += 1) {
    if (sourceText[index] === '{') depth += 1;
    if (sourceText[index] === '}') depth -= 1;
    if (depth === 0) return sourceText.slice(open, index + 1);
  }
  throw new Error(`missing ${method} body`);
}

describe('admin storyboard async job control plane contract', () => {
  test('legacy storyboard POST enqueues an async job instead of running heavy generation inline', () => {
    const route = source('app/api/admin/storyboard/route.ts');
    const postBody = exportedHandlerBody(route, 'POST');
    const authIndex = postBody.indexOf('await requireAdmin');
    const readJsonIndex = postBody.indexOf('readStoryboardRouteJson');
    const createJobIndex = postBody.indexOf('buildStoryboardJobInsert');

    expect(authIndex).toBeGreaterThanOrEqual(0);
    expect(readJsonIndex).toBeGreaterThan(authIndex);
    expect(createJobIndex).toBeGreaterThan(readJsonIndex);
    expect(postBody.indexOf('createSupabaseServiceRoleClient')).toBeGreaterThan(authIndex);
    expect(postBody).toContain('sanitizeStoryboardJobRow');
    expect(postBody).toContain("status: 202");
    expect(postBody).toContain("mode: 'async_job_control_plane'");
    expect(postBody).toContain("STORYBOARD_ROUTE_NO_STORE_HEADERS");
    expect(postBody).not.toContain('generateStoryboardWithBackendAgent');
    expect(postBody).not.toContain('persistLocalStoryboardHistory');
    expect(postBody).not.toContain('request_payload');
  });

  test('job routes expose create/list/status/cancel control-plane readback behind requireAdmin', () => {
    const createRoute = source('app/api/admin/storyboard/jobs/route.ts');
    const statusRoute = source('app/api/admin/storyboard/jobs/[jobId]/route.ts');
    const cancelRoute = source('app/api/admin/storyboard/jobs/[jobId]/cancel/route.ts');

    for (const route of [createRoute, statusRoute, cancelRoute]) {
      expect(route).toContain('await requireAdmin');
      expect(route).toContain("auth.response.headers.set('Cache-Control', 'no-store')");
      expect(route).toContain('STORYBOARD_ROUTE_NO_STORE_HEADERS');
    }
    expect(createRoute).toContain('createSupabaseServiceRoleClient');
    expect(createRoute).toContain('buildStoryboardJobInsert');
    expect(createRoute).toContain('sanitizeStoryboardJobRow');
    expect(statusRoute).toContain('sanitizeStoryboardJobRow');
    expect(cancelRoute).toContain('STORYBOARD_CANCELABLE_JOB_STATUSES');
    expect(cancelRoute).toContain('sanitizeStoryboardJobRow');
    expect(cancelRoute).toContain(".in('status', STORYBOARD_CANCELABLE_JOB_STATUSES)");
    expect(cancelRoute).toContain('replay: true');
  });

  test('job store reports truthful queued/cancelled readiness without fake storyboard success', () => {
    const jobs = source('lib/admin/storyboard/jobs.ts');

    expect(jobs).toContain("status: 'queued'");
    expect(jobs).toContain("fallbackReasonCode: 'storyboard_async_worker_pending'");
    expect(jobs).toContain('성공처럼 표시하지 않습니다');
    expect(jobs).toContain("'cancelled'");
    expect(jobs).not.toContain('generateLocalStoryboard');
    expect(jobs).not.toContain('generateStoryboardWithBackendAgent');
    expect(jobs).toContain('sanitizeStoryboardJobRow');
    expect(jobs).toContain('sanitizeStoryboardJobResult');
  });

  test('migration stores storyboard jobs behind service-role-only RLS', () => {
    const migration = source('../../backend/supabase/migrations/20260707000700_admin_storyboard_jobs.sql');

    expect(migration).toContain('create table if not exists public.admin_storyboard_jobs');
    expect(migration).toContain('request_payload jsonb');
    expect(migration).toContain('alter table public.admin_storyboard_jobs enable row level security');
    expect(migration).toContain('grant select, insert, update, delete on table public.admin_storyboard_jobs to service_role');
    expect(migration).toContain("auth.role() = 'service_role'");
  });

  test('admin storyboard UI preserves async job readback and stage/provider hooks', () => {
    const ui = source('components/admin/storyboard/AdminStoryboardGenerator.tsx');

    expect(ui).toContain('StoryboardJobAcceptedResponse');
    expect(ui).toContain('isStoryboardJobAcceptedResponse');
    expect(ui).toContain('async_job_control_plane');
    expect(ui).toContain('storyboard-job-queued');
    expect(ui).toContain('data-storyboard-job-status');
    expect(ui).toContain('data-storyboard-stage-progress');
    expect(ui).toContain('data-storyboard-provider-readiness');
    expect(ui).toContain('getStoryboardJobStatus');
    expect(ui).toContain('/api/admin/storyboard/jobs/${encodeURIComponent(jobId)}');
    expect(ui).toContain('hydrateStoryboardJobResultForDisplay');
    expect(ui).toContain('setAcceptedStoryboardJob(statusPayload.job)');
    expect(ui).toContain('data-storyboard-job-readback');
  });
});
