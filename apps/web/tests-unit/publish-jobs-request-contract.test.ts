import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PUBLISH_JOB_RESULT_CODES,
  PUBLISH_JOB_STATUSES,
  PublishJobRequestError,
  PublishJobRowError,
  isPublishJobId,
  isLocalPublishQueueAvailable,
  mapPublishJobRow,
  normalizePublishJobRequestBody,
  statusUrlForPublishJob,
} from '../lib/admin-publish-jobs';

const webRoot = join(import.meta.dir, '..');
const repoRoot = join(webRoot, '..', '..');

function source(path: string) {
  return readFileSync(join(webRoot, path), 'utf8');
}

function repoSource(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('admin publish job queue helpers', () => {
  test('normalizes only an empty request body and rejects any payload keys', () => {
    expect(normalizePublishJobRequestBody({})).toEqual({});

    for (const invalid of [
      { targetTable: 'restaurants' },
      { publishJobId: 'x' },
      [],
      null,
      'requested',
      42,
    ]) {
      expect(() => normalizePublishJobRequestBody(invalid)).toThrow(PublishJobRequestError);
    }
  });

  test('validates publish job identifiers and builds a status URL', () => {
    expect(isPublishJobId('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isPublishJobId('not-a-uuid')).toBe(false);
    expect(isPublishJobId(42)).toBe(false);
    expect(statusUrlForPublishJob('11111111-1111-4111-8111-111111111111')).toBe(
      '/api/admin/publish-jobs?publishJobId=11111111-1111-4111-8111-111111111111',
    );
  });

  test('admits the queue only behind an explicit loopback Supabase target', () => {
    expect(isLocalPublishQueueAvailable({
      TZUDONG_PUBLISH_QUEUE_ENABLED: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    })).toBe(true);
    expect(isLocalPublishQueueAvailable({
      TZUDONG_PUBLISH_QUEUE_ENABLED: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    })).toBe(false);
    expect(isLocalPublishQueueAvailable({
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    })).toBe(false);
    expect(isLocalPublishQueueAvailable({
      TZUDONG_PUBLISH_QUEUE_ENABLED: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
    })).toBe(false);
  });

  test('maps only bounded queue-status fields with no leaked columns', () => {
    const mapped = mapPublishJobRow({
      publish_job_id: '11111111-1111-4111-8111-111111111111',
      requested_by: 'admin-user-id',
      status: 'requested',
      preview_hash: 'deadbeef',
      result_code: null,
      requested_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    });

    expect(mapped).toEqual({
      publishJobId: '11111111-1111-4111-8111-111111111111',
      status: 'requested',
      resultCode: null,
      requestedAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    // Requester and preview hash are never surfaced to the console.
    expect(Object.keys(mapped)).not.toContain('requestedBy');
    expect(Object.keys(mapped)).not.toContain('previewHash');
  });

  test('rejects malformed or non-enumerated database status rows', () => {
    const valid = {
      publish_job_id: '11111111-1111-4111-8111-111111111111',
      status: 'requested',
      result_code: null,
      requested_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    };
    for (const invalid of [
      { ...valid, publish_job_id: 'not-a-uuid' },
      { ...valid, status: 'provider_error' },
      { ...valid, result_code: 'database_error_text' },
      { ...valid, requested_at: 'yesterday' },
      { ...valid, updated_at: { leaked: true } },
    ]) {
      expect(() => mapPublishJobRow(invalid)).toThrow(PublishJobRowError);
    }
  });

  test('status and result-code vocabularies mirror the queue migration and worker closed set', () => {
    const migration = repoSource('backend/supabase/migrations/20260901000100_local_analytics_schema.sql');
    const worker = repoSource('backend/pipeline_control/publish_worker.py');

    for (const status of PUBLISH_JOB_STATUSES) {
      expect(migration).toContain(`'${status}'`);
    }
    for (const code of PUBLISH_JOB_RESULT_CODES) {
      expect(worker).toContain(code);
    }
    expect(PUBLISH_JOB_RESULT_CODES).toHaveLength(7);
  });
});

describe('admin publish job route source contract', () => {
  const route = source('app/api/admin/publish-jobs/route.ts');

  test('guards with requireAdmin before any body or service-role work', () => {
    const adminGate = route.indexOf('const admin = await requireAdmin();');
    expect(adminGate).toBeGreaterThanOrEqual(0);
    expect(route.indexOf('if (!admin.ok)')).toBeGreaterThan(adminGate);
    expect(route.indexOf('createSupabaseServiceRoleClient()')).toBeGreaterThan(route.indexOf('if (!admin.ok)'));
    expect(route.indexOf('readBoundedJsonRequest(request, MAX_PUBLISH_JOB_REQUEST_BYTES)')).toBeGreaterThan(adminGate);
    expect(route).toContain("response.headers.set('Cache-Control', 'no-store')");
  });

  test('POST enforces trusted same-origin mutation and bounded request body', () => {
    expect(route).toContain('isTrustedSameOriginMutation(request)');
    expect(route).toContain("error: 'publish_job_request_forbidden'");
    expect(route).toContain('const MAX_PUBLISH_JOB_REQUEST_BYTES = 4 * 1024;');
    expect(route).toContain('BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge ? 413 : 400');
    expect(route).toContain('isLocalPublishQueueAvailable()');
    expect(route).toContain("error: 'publish_job_queue_unavailable'");
  });

  test('POST only enqueues a requested row into the local_analytics publish queue', () => {
    expect(route).toContain("status: 'requested'");
    expect(route).toContain("requested_by: admin.userId");
    expect(route).toContain("publish_job_id: publishJobId");
    expect(route).toContain(".schema('local_analytics')");
    expect(route).toContain(".from('publish_jobs')");
    expect(route).toContain('.insert(');
    // Queue-only: the route must not invoke the worker or run apply/readback work.
    expect(route).not.toContain('publish_worker');
    expect(route).not.toContain('Publish_Worker');
    expect(route).not.toContain('readback');
    expect(route).not.toContain('.upsert(');
    expect(route).not.toContain('batch_upsert');
  });

  test('GET returns bounded publish status via a status-only query', () => {
    expect(route).toContain('export async function GET');
    expect(route).toContain(".eq('publish_job_id', publishJobId)");
    expect(route).toContain('.maybeSingle()');
    expect(route).toContain(".order('requested_at', { ascending: false })");
    expect(route).toContain('PUBLISH_JOB_STATUS_LIST_LIMIT');
  });

  test('all handlers return fixed codes and never leak provider or database errors', () => {
    expect(route).toContain("error: 'publish_job_enqueue_failed'");
    expect(route).toContain("error: 'invalid_publish_job_request'");
    expect(route).toContain("error: 'publish_job_status_unavailable'");
    expect(route).toContain("error: 'publish_job_not_found'");
    expect(route).toContain("error: 'publish_job_queue_unavailable'");
    // Provider/database error objects must not be forwarded to the client.
    expect(route).not.toContain('error.message');
    expect(route).not.toContain('error: error');
    expect(route).not.toContain('JSON.stringify(error)');
  });
});
