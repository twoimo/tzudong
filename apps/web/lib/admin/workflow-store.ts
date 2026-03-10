import 'server-only';

import { createClient } from '@supabase/supabase-js';

import type { AdminWorkflowRunRecord, AdminWorkflowStepRecord } from '@/lib/admin/workflow-contract';

function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase admin env is not configured.');
  }

  return createClient(url, serviceRoleKey);
}

export async function insertWorkflowRunRecord(payload: Record<string, unknown>) {
  const supabase = createAdminSupabaseClient();

  const { error } = await supabase.from('admin_workflow_runs').insert(payload as never);
  if (error) {
    throw new Error(`Failed to insert admin_workflow_runs: ${error.message}`);
  }
}

export async function updateWorkflowRunRecord(runId: string, payload: Record<string, unknown>) {
  const supabase = createAdminSupabaseClient();

  const { error } = await supabase.from('admin_workflow_runs').update(payload as never).eq('run_id', runId);
  if (error) {
    throw new Error(`Failed to update admin_workflow_runs: ${error.message}`);
  }
}

export async function fetchWorkflowRunById(runId: string): Promise<AdminWorkflowRunRecord | null> {
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('admin_workflow_runs')
    .select('*')
    .eq('run_id', runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch workflow run: ${error.message}`);
  }

  return (data ?? null) as AdminWorkflowRunRecord | null;
}

export async function fetchWorkflowRuns(limit: number): Promise<AdminWorkflowRunRecord[]> {
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('admin_workflow_runs')
    .select('*')
    .order('requested_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list workflow runs: ${error.message}`);
  }

  return (data || []) as AdminWorkflowRunRecord[];
}

export async function fetchWorkflowStepsByRunId(runId: string): Promise<AdminWorkflowStepRecord[]> {
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('admin_workflow_steps')
    .select('*')
    .eq('run_id', runId)
    .order('canonical_step_no', { ascending: true });

  if (error) {
    throw new Error(`Failed to list workflow steps: ${error.message}`);
  }

  return (data || []) as AdminWorkflowStepRecord[];
}

export async function fetchWorkflowStepsByRunIds(runIds: string[]): Promise<AdminWorkflowStepRecord[]> {
  if (runIds.length === 0) {
    return [];
  }

  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('admin_workflow_steps')
    .select('*')
    .in('run_id', runIds)
    .order('canonical_step_no', { ascending: true });

  if (error) {
    throw new Error(`Failed to list workflow steps by run ids: ${error.message}`);
  }

  return (data || []) as AdminWorkflowStepRecord[];
}
