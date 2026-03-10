import { describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

import type { AdminWorkflowRunRecord, AdminWorkflowStepRecord } from '@/lib/admin/workflow-contract';

type AuthState = 'ok' | 'unauthorized' | 'forbidden';

const storeMocks = {
  insertWorkflowRunRecord: mock(async () => undefined),
  updateWorkflowRunRecord: mock(async () => undefined),
  fetchWorkflowRuns: mock(async () => [] as AdminWorkflowRunRecord[]),
  fetchWorkflowStepsByRunIds: mock(async () => [] as AdminWorkflowStepRecord[]),
  fetchWorkflowRunById: mock(async () => null as AdminWorkflowRunRecord | null),
  fetchWorkflowStepsByRunId: mock(async () => [] as AdminWorkflowStepRecord[]),
};

const githubMocks = {
  dispatchDailyWorkflow: mock(async () => ({ ok: true, status: 204, retriedWithLegacyPayload: false, error: null })),
  fetchWorkflowRunStatus: mock(async () => ({
    runId: 123,
    status: 'completed',
    conclusion: 'success',
    runNumber: 77,
    runAttempt: 1,
    htmlUrl: 'https://github.com/example/actions/runs/123',
    updatedAt: '2026-03-10T00:00:00.000Z',
  })),
};

function setAuthMock(state: AuthState) {
  mock.module('@/lib/auth/require-admin', () => ({
    requireAdmin: async () => {
      if (state === 'ok') {
        return { ok: true, userId: 'admin-user' };
      }

      return {
        ok: false,
        response:
          state === 'unauthorized'
            ? new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
            : new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } }),
      };
    },
  }));
}

function installRouteDependencyMocks() {
  mock.module('@/lib/admin/workflow-store', () => storeMocks);
  mock.module('@/lib/admin/workflow-github', () => githubMocks);
}

describe('admin workflows API routes', () => {
  test('POST /api/admin/workflows/runs enforces admin auth', async () => {
    mock.restore();
    installRouteDependencyMocks();
    setAuthMock('unauthorized');

    const { POST } = await import('@/app/api/admin/workflows/runs/route?auth-unauthorized');
    const request = new NextRequest('http://localhost:8080/api/admin/workflows/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@tzuyang' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });

    mock.restore();
    installRouteDependencyMocks();
    setAuthMock('forbidden');

    const { POST: forbiddenPost } = await import('@/app/api/admin/workflows/runs/route?auth-forbidden');
    const forbiddenResponse = await forbiddenPost(request);
    expect(forbiddenResponse.status).toBe(403);
    expect(await forbiddenResponse.json()).toEqual({ error: 'Forbidden' });
  });

  test('POST /api/admin/workflows/runs returns trigger contract for admin', async () => {
    mock.restore();
    installRouteDependencyMocks();
    setAuthMock('ok');

    const { POST } = await import('@/app/api/admin/workflows/runs/route?post-success');
    const request = new NextRequest('http://localhost:8080/api/admin/workflows/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@Tzuyang', maxVideos: 5 }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload).toMatchObject({
      run_id: expect.any(String),
      dispatch_request_id: expect.any(String),
      correlation_state: 'dispatched_unmatched',
      channel_slug: 'tzuyang',
    });

    expect(storeMocks.insertWorkflowRunRecord).toHaveBeenCalledTimes(1);
    expect(githubMocks.dispatchDailyWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        channelSlug: 'tzuyang',
        channelUrl: 'https://www.youtube.com/@Tzuyang',
      }),
    );
    expect(storeMocks.updateWorkflowRunRecord).toHaveBeenCalledTimes(1);
  });

  test('POST /api/admin/workflows/runs surfaces upstream GitHub dispatch errors', async () => {
    mock.restore();
    installRouteDependencyMocks();
    setAuthMock('ok');

    githubMocks.dispatchDailyWorkflow.mockResolvedValueOnce({
      ok: false,
      status: 401,
      retriedWithLegacyPayload: false,
      error: JSON.stringify({ message: 'Bad credentials' }),
    });

    const { POST } = await import('@/app/api/admin/workflows/runs/route?post-dispatch-fail');
    const request = new NextRequest('http://localhost:8080/api/admin/workflows/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@tzuyang', maxVideos: -1 }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toMatchObject({
      error: 'GitHub dispatch failed (401): Bad credentials',
      dispatch_status: 401,
      correlation_state: 'reconciled_error',
    });
  });

  test('GET /api/admin/workflows/runs returns progress + failure point contract', async () => {
    mock.restore();
    installRouteDependencyMocks();
    setAuthMock('ok');

    storeMocks.fetchWorkflowRuns.mockResolvedValueOnce([
      {
        run_id: 'run-1',
        dispatch_request_id: 'dispatch-1',
        correlation_state: 'matched',
        trigger_source: 'manual_admin',
        requested_by_user_id: 'admin-user',
        channel_url_raw: 'https://www.youtube.com/@tzuyang',
        channel_url_normalized: 'https://www.youtube.com/@tzuyang',
        channel_slug: 'tzuyang',
        channel_id: 'tzuyang',
        workflow_file: 'daily-crawler.yml',
        workflow_ref: 'data',
        github_run_id: 100,
        github_run_number: 20,
        github_run_attempt: 1,
        github_status: 'in_progress',
        github_conclusion: null,
        requested_at: '2026-03-10T00:00:00.000Z',
        dispatched_at: '2026-03-10T00:00:05.000Z',
        matched_at: '2026-03-10T00:00:10.000Z',
        completed_at: null,
        error_code: null,
        error_message: null,
        updated_at: '2026-03-10T00:00:20.000Z',
      },
    ]);
    storeMocks.fetchWorkflowStepsByRunIds.mockResolvedValueOnce([
      {
        id: 'step-1',
        run_id: 'run-1',
        canonical_step_no: 1,
        canonical_step_key: 'url_collection',
        script_step_label: 'Step 1',
        status: 'success',
        started_at: '2026-03-10T00:00:00.000Z',
        ended_at: '2026-03-10T00:00:01.000Z',
        duration_ms: 1000,
        message: 'done',
        row_delta: { new_urls: 10 },
        attempt: 1,
      },
      {
        id: 'step-2',
        run_id: 'run-1',
        canonical_step_no: 2,
        canonical_step_key: 'metadata_collection',
        script_step_label: 'Step 2',
        status: 'failed',
        started_at: '2026-03-10T00:00:01.000Z',
        ended_at: '2026-03-10T00:00:02.000Z',
        duration_ms: 1000,
        message: 'failed',
        row_delta: { meta_updated: 0 },
        attempt: 1,
      },
    ]);

    const { GET } = await import('@/app/api/admin/workflows/runs/route?list-contract');
    const response = await GET(new NextRequest('http://localhost:8080/api/admin/workflows/runs?limit=5'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.total).toBe(1);
    expect(payload.records[0]).toMatchObject({
      run_id: 'run-1',
      progress_percent: expect.any(Number),
      failure_point: {
        canonical_step_no: 2,
        canonical_step_key: 'metadata_collection',
        name: '메타데이터 수집',
        status: 'failed',
      },
    });
  });

  test('GET /api/admin/workflows/runs/[runId]/status returns 404 when run is missing', async () => {
    mock.restore();
    installRouteDependencyMocks();
    setAuthMock('ok');

    storeMocks.fetchWorkflowRunById.mockResolvedValueOnce(null);

    const { GET } = await import('@/app/api/admin/workflows/runs/[runId]/status/route?status-not-found');
    const response = await GET(new NextRequest('http://localhost:8080/api/admin/workflows/runs/run-404/status'), {
      params: Promise.resolve({ runId: 'run-404' }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Run not found.' });
  });

  test('GET /api/admin/workflows/runs/[runId]/status reconciles stale unmatched dispatch', async () => {
    mock.restore();
    installRouteDependencyMocks();
    setAuthMock('ok');

    const staleRun: AdminWorkflowRunRecord = {
      run_id: 'run-timeout',
      dispatch_request_id: 'dispatch-timeout',
      correlation_state: 'dispatched_unmatched',
      trigger_source: 'manual_admin',
      requested_by_user_id: 'admin-user',
      channel_url_raw: 'https://www.youtube.com/@tzuyang',
      channel_url_normalized: 'https://www.youtube.com/@tzuyang',
      channel_slug: 'tzuyang',
      channel_id: null,
      workflow_file: 'daily-crawler.yml',
      workflow_ref: 'data',
      github_run_id: null,
      github_run_number: null,
      github_run_attempt: null,
      github_status: 'queued',
      github_conclusion: null,
      requested_at: '2026-03-01T00:00:00.000Z',
      dispatched_at: '2026-03-01T00:00:05.000Z',
      matched_at: null,
      completed_at: null,
      error_code: null,
      error_message: null,
      updated_at: '2026-03-01T00:00:05.000Z',
    };

    storeMocks.fetchWorkflowRunById
      .mockResolvedValueOnce(staleRun)
      .mockResolvedValueOnce({
        ...staleRun,
        correlation_state: 'reconciled_timeout',
        error_code: 'dispatch_unmatched_timeout',
      });
    storeMocks.fetchWorkflowStepsByRunId.mockResolvedValueOnce([]);

    const { GET } = await import('@/app/api/admin/workflows/runs/[runId]/status/route?status-timeout-reconcile');
    const response = await GET(new NextRequest('http://localhost:8080/api/admin/workflows/runs/run-timeout/status'), {
      params: Promise.resolve({ runId: 'run-timeout' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(storeMocks.updateWorkflowRunRecord).toHaveBeenCalledWith(
      'run-timeout',
      expect.objectContaining({
        correlation_state: 'reconciled_timeout',
        error_code: 'dispatch_unmatched_timeout',
      }),
    );
    expect(payload.run.correlation_state).toBe('reconciled_timeout');
  });
});
