import { NextRequest, NextResponse } from 'next/server';

import {
  buildCanonicalWorkflowSteps,
  calculateWorkflowProgressPercent,
  findWorkflowFailurePoint,
} from '@/lib/admin/workflow-contract';
import { fetchWorkflowRunStatus } from '@/lib/admin/workflow-github';
import {
  fetchWorkflowRunById,
  fetchWorkflowStepsByRunId,
  updateWorkflowRunRecord,
} from '@/lib/admin/workflow-store';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ runId: string }>;
}

const DISPATCH_MATCH_TIMEOUT_MS = 15 * 60 * 1000;

function isTerminalGitHubStatus(status: string | null, conclusion: string | null) {
  return status === 'completed' || Boolean(conclusion);
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { runId } = await context.params;
    if (!runId) {
      return NextResponse.json({ error: 'runId is required.' }, { status: 400 });
    }

    const shouldRefresh = request.nextUrl.searchParams.get('refresh') !== '0';
    let run = await fetchWorkflowRunById(runId);

    if (!run) {
      return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
    }

    let githubHtmlUrl: string | null = null;
    let refreshError: string | null = null;

    if (run.correlation_state === 'dispatched_unmatched' && !run.github_run_id) {
      const referenceTimestamp = run.dispatched_at || run.requested_at;
      if (referenceTimestamp) {
        const elapsedMs = Date.now() - new Date(referenceTimestamp).getTime();
        if (Number.isFinite(elapsedMs) && elapsedMs >= DISPATCH_MATCH_TIMEOUT_MS) {
          await updateWorkflowRunRecord(run.run_id, {
            correlation_state: 'reconciled_timeout',
            error_code: 'dispatch_unmatched_timeout',
            error_message: `GitHub run id not matched within ${Math.floor(DISPATCH_MATCH_TIMEOUT_MS / 60000)} minutes.`,
            completed_at: run.completed_at || new Date().toISOString(),
          });
          run = await fetchWorkflowRunById(runId);
        }
      }
    }

    if (!run) {
      return NextResponse.json({ error: 'Run not found after timeout reconciliation.' }, { status: 404 });
    }

    if (shouldRefresh && run.github_run_id) {
      try {
        const githubRun = await fetchWorkflowRunStatus(run.github_run_id);
        githubHtmlUrl = githubRun.htmlUrl;

        await updateWorkflowRunRecord(run.run_id, {
          github_status: githubRun.status,
          github_conclusion: githubRun.conclusion,
          github_run_number: githubRun.runNumber,
          github_run_attempt: githubRun.runAttempt,
          updated_at: githubRun.updatedAt || new Date().toISOString(),
          ...(isTerminalGitHubStatus(githubRun.status, githubRun.conclusion)
            ? {
                completed_at: run.completed_at || new Date().toISOString(),
                correlation_state: 'completed',
              }
            : {}),
        });

        run = await fetchWorkflowRunById(runId);
      } catch (error) {
        refreshError = error instanceof Error ? error.message : 'Unknown refresh error';
      }
    }

    if (!run) {
      return NextResponse.json({ error: 'Run not found after refresh.' }, { status: 404 });
    }

    const steps = await fetchWorkflowStepsByRunId(runId);
    const canonicalSteps = buildCanonicalWorkflowSteps(steps);
    const progressPercent = calculateWorkflowProgressPercent(canonicalSteps);
    const failurePoint = findWorkflowFailurePoint(canonicalSteps);

    return NextResponse.json({
      run,
      steps: canonicalSteps,
      progress_percent: progressPercent,
      failure_point: failurePoint
        ? {
            canonical_step_no: failurePoint.canonical_step_no,
            canonical_step_key: failurePoint.canonical_step_key,
            name: failurePoint.name,
            status: failurePoint.status,
            message: failurePoint.message,
          }
        : null,
      github_html_url: githubHtmlUrl,
      refresh_error: refreshError,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[admin/workflows/runs/:runId/status] failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
