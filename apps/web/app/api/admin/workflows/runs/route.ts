import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import {
  buildCanonicalWorkflowSteps,
  calculateWorkflowProgressPercent,
  findWorkflowFailurePoint,
  normalizeChannelInput,
} from '@/lib/admin/workflow-contract';
import { dispatchDailyWorkflow } from '@/lib/admin/workflow-github';
import {
  fetchWorkflowRuns,
  fetchWorkflowStepsByRunIds,
  insertWorkflowRunRecord,
  updateWorkflowRunRecord,
} from '@/lib/admin/workflow-store';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 30;

function normalizeMaxVideos(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.trunc(raw));
  }

  if (typeof raw === 'string' && raw.trim()) {
    const trimmed = raw.trim();
    if (/^-?\d+$/.test(trimmed)) {
      return String(Number.parseInt(trimmed, 10));
    }
  }

  return '-1';
}

function formatDispatchError(status: number, rawError: string | null): string {
  if (!rawError) {
    return `GitHub dispatch failed (${status}).`;
  }

  try {
    const parsed = JSON.parse(rawError) as { message?: string; error?: string };
    const message = parsed.message || parsed.error;
    if (message) {
      return `GitHub dispatch failed (${status}): ${message}`;
    }
  } catch {
    // JSON 형식이 아니면 원문 fallback
  }

  const compact = rawError.replace(/\s+/g, ' ').trim();
  return `GitHub dispatch failed (${status}): ${compact.slice(0, 280)}`;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const payload = (await request.json().catch(() => ({}))) as {
      channelUrl?: unknown;
      maxVideos?: unknown;
    };

    if (typeof payload.channelUrl !== 'string') {
      return NextResponse.json({ error: 'channelUrl is required.' }, { status: 400 });
    }

    const normalizedChannel = normalizeChannelInput(payload.channelUrl);
    if (!normalizedChannel) {
      return NextResponse.json({ error: 'Invalid channelUrl.' }, { status: 400 });
    }

    const dispatchRequestId = randomUUID();
    const runId = dispatchRequestId;
    const now = new Date().toISOString();
    const maxVideos = normalizeMaxVideos(payload.maxVideos);

    await insertWorkflowRunRecord({
      run_id: runId,
      dispatch_request_id: dispatchRequestId,
      correlation_key: `${normalizedChannel.channel_slug}|manual_admin|${maxVideos}`,
      trigger_source: 'manual_admin',
      requested_by_user_id: auth.userId,
      channel_url_raw: payload.channelUrl,
      channel_url_normalized: normalizedChannel.channel_url_normalized,
      channel_slug: normalizedChannel.channel_slug,
      channel_id: null,
      workflow_file: process.env.GITHUB_DAILY_WORKFLOW_FILE || 'daily-crawler.yml',
      workflow_ref: process.env.GITHUB_WORKFLOW_REF || 'data',
      github_status: 'queued',
      correlation_state: 'pending_dispatch',
      requested_at: now,
    });

    const dispatchResult = await dispatchDailyWorkflow({
      channelUrl: normalizedChannel.channel_url_normalized,
      channelSlug: normalizedChannel.channel_slug,
      dispatchRequestId,
      triggerSource: 'manual_admin',
      maxVideos,
    });

    if (!dispatchResult.ok) {
      const dispatchErrorMessage = formatDispatchError(dispatchResult.status, dispatchResult.error);

      await updateWorkflowRunRecord(runId, {
        correlation_state: 'reconciled_error',
        error_code: `github_dispatch_${dispatchResult.status}`,
        error_message: dispatchErrorMessage,
      });

      return NextResponse.json(
        {
          error: dispatchErrorMessage,
          dispatch_status: dispatchResult.status,
          dispatch_error: dispatchResult.error,
          run_id: runId,
          dispatch_request_id: dispatchRequestId,
          correlation_state: 'reconciled_error',
        },
        { status: 502 },
      );
    }

    await updateWorkflowRunRecord(runId, {
      correlation_state: 'dispatched_unmatched',
      dispatched_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    });

    return NextResponse.json(
      {
        run_id: runId,
        dispatch_request_id: dispatchRequestId,
        correlation_state: 'dispatched_unmatched',
        trigger_source: 'manual_admin',
        channel_url: normalizedChannel.channel_url_normalized,
        channel_slug: normalizedChannel.channel_slug,
        github_dispatch: {
          status: dispatchResult.status,
          retried_with_legacy_payload: dispatchResult.retriedWithLegacyPayload,
        },
      },
      { status: 202 },
    );
  } catch (error) {
    console.error('[admin/workflows/runs] trigger failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const rawLimit = Number(request.nextUrl.searchParams.get('limit') || DEFAULT_LIST_LIMIT);
    const listLimit = Math.min(MAX_LIST_LIMIT, Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_LIST_LIMIT);

    const runs = await fetchWorkflowRuns(listLimit);
    const runIds = runs.map((run) => run.run_id);
    const steps = await fetchWorkflowStepsByRunIds(runIds);

    const stepsByRunId = new Map<string, typeof steps>();
    for (const step of steps) {
      const existing = stepsByRunId.get(step.run_id) || [];
      existing.push(step);
      stepsByRunId.set(step.run_id, existing);
    }

    const records = runs.map((run) => {
      const canonicalSteps = buildCanonicalWorkflowSteps(stepsByRunId.get(run.run_id) || []);
      const progressPercent = calculateWorkflowProgressPercent(canonicalSteps);
      const failurePoint = findWorkflowFailurePoint(canonicalSteps);

      return {
        ...run,
        progress_percent: progressPercent,
        failure_point: failurePoint
          ? {
              canonical_step_no: failurePoint.canonical_step_no,
              canonical_step_key: failurePoint.canonical_step_key,
              name: failurePoint.name,
              status: failurePoint.status,
            }
          : null,
      };
    });

    return NextResponse.json({
      total: records.length,
      records,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[admin/workflows/runs] list failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
