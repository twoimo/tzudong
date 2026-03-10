import { NextResponse } from 'next/server';

import {
  buildCanonicalWorkflowSteps,
  calculateWorkflowProgressPercent,
  findWorkflowFailurePoint,
} from '@/lib/admin/workflow-contract';
import { fetchWorkflowRunById, fetchWorkflowStepsByRunId } from '@/lib/admin/workflow-store';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ runId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { runId } = await context.params;
    if (!runId) {
      return NextResponse.json({ error: 'runId is required.' }, { status: 400 });
    }

    const run = await fetchWorkflowRunById(runId);
    if (!run) {
      return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
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
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[admin/workflows/runs/:runId] detail failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
