import { createSupabaseServiceRoleClient } from '@/lib/insight/supabase';

export const OCR_DAILY_QUOTA = 5;

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  gte: (column: string, value: unknown) => QueryBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
};

export type QueryableSupabase = {
  from: (table: string) => QueryBuilder;
};

export type OcrQuotaStatus = {
  used: number;
  max: number | null;
  remaining: number | null;
  unlimited: boolean;
  resetAt: string;
};

export type OcrQuotaCheck = OcrQuotaStatus & {
  exceeded: boolean;
};

function serviceRoleConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function getTodayWindow(now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const resetAt = new Date(today);
  resetAt.setDate(resetAt.getDate() + 1);

  return { today, resetAt };
}

export async function hasAdminRole(
  userId: string,
  fallbackClient?: QueryableSupabase,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const client = serviceRoleConfigured(env)
    ? (createSupabaseServiceRoleClient() as unknown as QueryableSupabase)
    : fallbackClient;

  if (!client) return false;

  try {
    const { data, error } = await client
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();

    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

export function isOcrForceRefreshRequested(input: {
  formData?: FormData;
  headers?: Headers;
}): boolean {
  const formValue = input.formData?.get('force');
  const headerValue = input.headers?.get('x-ocr-force-refresh');

  return formValue === '1' || formValue === 'true' || headerValue === '1' || headerValue === 'true';
}

export function isOcrForceRefreshAllowedInEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.OCR_FORCE_REFRESH_ENABLED === '1';
}

export async function canForceRefreshOcr(params: {
  userId: string;
  roleClient?: QueryableSupabase;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const env = params.env ?? process.env;
  if (isOcrForceRefreshAllowedInEnvironment(env)) return true;

  return hasAdminRole(params.userId, params.roleClient, env);
}

export async function getOcrQuotaStatus(params: {
  userId: string;
  logsClient: QueryableSupabase;
  roleClient?: QueryableSupabase;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<OcrQuotaStatus> {
  const { today, resetAt } = getTodayWindow(params.now);
  const [{ count, error: countError }, unlimited] = await Promise.all([
    params.logsClient
      .from('ocr_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', params.userId)
      .eq('success', true)
      .gte('created_at', today.toISOString()) as unknown as Promise<{ count: number | null; error: unknown }>,
    hasAdminRole(params.userId, params.roleClient ?? params.logsClient, params.env),
  ]);

  if (countError) {
    throw countError;
  }

  const used = count ?? 0;

  if (unlimited) {
    return {
      used,
      max: null,
      remaining: null,
      unlimited: true,
      resetAt: resetAt.toISOString(),
    };
  }

  return {
    used,
    max: OCR_DAILY_QUOTA,
    remaining: Math.max(0, OCR_DAILY_QUOTA - used),
    unlimited: false,
    resetAt: resetAt.toISOString(),
  };
}

export async function checkOcrDailyQuota(params: {
  userId: string;
  logsClient: QueryableSupabase;
  roleClient?: QueryableSupabase;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<OcrQuotaCheck> {
  const status = await getOcrQuotaStatus(params);

  return {
    ...status,
    exceeded: !status.unlimited && status.remaining === 0,
  };
}
