import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type { Database } from '@/integrations/supabase/types';
import {
  PUBLISH_JOB_STATUS_LIST_LIMIT,
  PublishJobRequestError,
  isPublishJobId,
  mapPublishJobRow,
  normalizePublishJobRequestBody,
  statusUrlForPublishJob,
} from '@/lib/admin-publish-jobs';
import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PUBLISH_JOB_REQUEST_BYTES = 4 * 1024;
const PUBLISH_JOB_SELECT = 'publish_job_id, status, result_code, requested_at, updated_at';

// `local_analytics` is a Local_Only_Schema and is intentionally absent from the
// generated public Supabase types. The route only enqueues and reads status, so
// a narrow structural view over the queue table is sufficient and keeps the
// service-role client strongly typed everywhere else.
type QueueRowResult = { data: Record<string, unknown> | null; error: unknown };
type QueueRowsResult = { data: Record<string, unknown>[] | null; error: unknown };

type PublishJobsSelectBuilder = {
  eq: (column: string, value: string) => PublishJobsSelectBuilder;
  order: (column: string, options: { ascending: boolean }) => PublishJobsSelectBuilder;
  limit: (count: number) => PromiseLike<QueueRowsResult>;
  maybeSingle: () => PromiseLike<QueueRowResult>;
};

type PublishJobsTable = {
  insert: (values: Record<string, unknown>) => {
    select: (columns: string) => { single: () => PromiseLike<QueueRowResult> };
  };
  select: (columns: string) => PublishJobsSelectBuilder;
};

type LocalAnalyticsSchema = {
  from: (table: 'publish_jobs') => PublishJobsTable;
};

function localAnalyticsPublishJobs(client: SupabaseClient<Database>): PublishJobsTable {
  return (client as unknown as { schema: (name: string) => LocalAnalyticsSchema })
    .schema('local_analytics')
    .from('publish_jobs');
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function readRowObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// POST enqueues a publish request row and returns a bounded fixed-code response.
// It never invokes the backend publish worker or performs any apply/read-back work.
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }
  if (!isTrustedSameOriginMutation(request)) {
    return noStoreJson({ ok: false, error: 'publish_job_request_forbidden' }, { status: 403 });
  }

  const requestBody = await readBoundedJsonRequest(request, MAX_PUBLISH_JOB_REQUEST_BYTES);
  if (!requestBody.ok) {
    return noStoreJson(
      { ok: false, error: 'invalid_publish_job_request' },
      { status: requestBody.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge ? 413 : 400 },
    );
  }

  try {
    normalizePublishJobRequestBody(requestBody.value);
  } catch (error) {
    if (error instanceof PublishJobRequestError) {
      return noStoreJson({ ok: false, error: 'invalid_publish_job_request' }, { status: 400 });
    }
    return noStoreJson({ ok: false, error: 'publish_job_enqueue_failed' }, { status: 502 });
  }

  try {
    const publishJobId = randomUUID();
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await localAnalyticsPublishJobs(supabase)
      .insert({
        publish_job_id: publishJobId,
        requested_by: admin.userId,
        status: 'requested',
      })
      .select(PUBLISH_JOB_SELECT)
      .single();

    const row = error ? null : readRowObject(data);
    if (error || !row) {
      return noStoreJson({ ok: false, error: 'publish_job_enqueue_failed' }, { status: 502 });
    }

    const mapped = mapPublishJobRow(row);
    return noStoreJson(
      {
        ok: true,
        status: mapped.status,
        publishJobId: mapped.publishJobId,
        statusUrl: statusUrlForPublishJob(String(mapped.publishJobId)),
      },
      { status: 202 },
    );
  } catch {
    return noStoreJson({ ok: false, error: 'publish_job_enqueue_failed' }, { status: 502 });
  }
}

// GET reads bounded publish job status only. A `publishJobId` query selects a
// single job; otherwise the most recent jobs are returned.
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }

  const publishJobId = new URL(request.url).searchParams.get('publishJobId');

  try {
    const supabase = createSupabaseServiceRoleClient();

    if (publishJobId !== null) {
      if (!isPublishJobId(publishJobId)) {
        return noStoreJson({ ok: false, error: 'publish_job_not_found' }, { status: 404 });
      }
      const { data, error } = await localAnalyticsPublishJobs(supabase)
        .select(PUBLISH_JOB_SELECT)
        .eq('publish_job_id', publishJobId)
        .maybeSingle();

      if (error) return noStoreJson({ ok: false, error: 'publish_job_status_unavailable' }, { status: 502 });
      const row = readRowObject(data);
      if (!row) return noStoreJson({ ok: false, error: 'publish_job_not_found' }, { status: 404 });
      return noStoreJson({ ok: true, job: mapPublishJobRow(row) });
    }

    const { data, error } = await localAnalyticsPublishJobs(supabase)
      .select(PUBLISH_JOB_SELECT)
      .order('requested_at', { ascending: false })
      .limit(PUBLISH_JOB_STATUS_LIST_LIMIT);

    if (error) return noStoreJson({ ok: false, error: 'publish_job_status_unavailable' }, { status: 502 });
    const rows = Array.isArray(data) ? data : [];
    return noStoreJson({ ok: true, jobs: rows.map((row) => mapPublishJobRow(row)) });
  } catch {
    return noStoreJson({ ok: false, error: 'publish_job_status_unavailable' }, { status: 502 });
  }
}
