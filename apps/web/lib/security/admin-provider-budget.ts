import { randomUUID } from 'node:crypto';

import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

export type AdminProviderBudgetName =
  | 'naver_local_search'
  | 'naver_geocode'
  | 'youtube_metadata'
  | 'naver_directions'
  | 'openai_sponsor_analysis';

export type AdminProviderBudgetResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type ProviderBudgetRow = {
  allowed: boolean;
  retry_after_seconds: number;
};

function parseProviderBudgetRow(data: unknown): ProviderBudgetRow {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error('ADMIN_PROVIDER_BUDGET_RESPONSE_INVALID');
  }
  const row = data[0];
  if (
    !row
    || typeof row !== 'object'
    || typeof (row as ProviderBudgetRow).allowed !== 'boolean'
    || !Number.isSafeInteger((row as ProviderBudgetRow).retry_after_seconds)
    || (row as ProviderBudgetRow).retry_after_seconds < 0
    || (row as ProviderBudgetRow).retry_after_seconds > 86_400
    || ((row as ProviderBudgetRow).allowed && (row as ProviderBudgetRow).retry_after_seconds !== 0)
    || (!(row as ProviderBudgetRow).allowed && (row as ProviderBudgetRow).retry_after_seconds < 1)
  ) {
    throw new Error('ADMIN_PROVIDER_BUDGET_RESPONSE_INVALID');
  }
  return row as ProviderBudgetRow;
}

export async function reserveAdminProviderBudget(input: {
  actorUserId: string;
  provider: AdminProviderBudgetName;
  operationId?: string;
}): Promise<AdminProviderBudgetResult> {
  const operationId = input.operationId ?? randomUUID();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.actorUserId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)
  ) {
    throw new Error('ADMIN_PROVIDER_BUDGET_INPUT_INVALID');
  }

  let client;
  try {
    client = createSupabaseServiceRoleClient();
  } catch {
    throw new Error('ADMIN_PROVIDER_BUDGET_UNAVAILABLE');
  }

  const { data, error } = await client.rpc('reserve_admin_provider_budget', {
    p_actor_user_id: input.actorUserId,
    p_provider: input.provider,
    p_operation_id: operationId,
  });
  if (error) throw new Error('ADMIN_PROVIDER_BUDGET_UNAVAILABLE');

  const row = parseProviderBudgetRow(data);
  return {
    allowed: row.allowed,
    retryAfterSeconds: row.retry_after_seconds,
  };
}
