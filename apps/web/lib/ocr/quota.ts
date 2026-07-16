export const OCR_DAILY_QUOTA = 5;

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
};

export type QueryableSupabase = {
  from: (table: string) => QueryBuilder;
};

export type OcrQuotaSupabase = QueryableSupabase & {
  rpc: (
    functionName: 'get_ocr_daily_quota_status' | 'reserve_ocr_daily_quota',
    args?: { p_operation_id: string },
  ) => PromiseLike<{ data: unknown; error: unknown }>;
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

type OcrQuotaRpcRow = {
  allowed: boolean;
  used_count: number;
  quota_limit: number | null;
  remaining_count: number | null;
  unlimited: boolean;
  reset_at: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isNullableNonNegativeSafeInteger = (
  value: unknown,
): value is number | null => value === null || isNonNegativeSafeInteger(value);

function parseOcrQuotaRpcRow(data: unknown): OcrQuotaRpcRow {
  if (Array.isArray(data) && data.length !== 1) {
    throw new Error('OCR_QUOTA_RESPONSE_INVALID');
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row)) {
    throw new Error('OCR_QUOTA_RESPONSE_INVALID');
  }

  const {
    allowed,
    used_count: usedCount,
    quota_limit: quotaLimit,
    remaining_count: remainingCount,
    unlimited,
    reset_at: resetAt,
  } = row;

  if (
    typeof allowed !== 'boolean'
    || !isNonNegativeSafeInteger(usedCount)
    || !isNullableNonNegativeSafeInteger(quotaLimit)
    || !isNullableNonNegativeSafeInteger(remainingCount)
    || typeof unlimited !== 'boolean'
  ) {
    throw new Error('OCR_QUOTA_RESPONSE_INVALID');
  }

  if (
    typeof resetAt !== 'string'
    || !Number.isFinite(Date.parse(resetAt))
  ) {
    throw new Error('OCR_QUOTA_RESPONSE_INVALID');
  }

  const parsed: OcrQuotaRpcRow = {
    allowed,
    used_count: usedCount,
    quota_limit: quotaLimit,
    remaining_count: remainingCount,
    unlimited,
    reset_at: resetAt,
  };
  if (
    parsed.unlimited !== (parsed.quota_limit === null && parsed.remaining_count === null)
    || (
      !parsed.unlimited
      && (
        parsed.quota_limit !== OCR_DAILY_QUOTA
        || parsed.remaining_count === null
        || parsed.used_count > parsed.quota_limit
        || parsed.remaining_count !== parsed.quota_limit - parsed.used_count
      )
    )
  ) {
    throw new Error('OCR_QUOTA_RESPONSE_INVALID');
  }

  return parsed;
}

export async function hasAdminRole(
  userId: string,
  fallbackClient?: QueryableSupabase,
): Promise<boolean> {
  const client = fallbackClient;
  if (!client) return false;

  try {
    const { data: role, error: roleError } = await client
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();
    if (roleError || !role) return false;

    const { data: status, error: statusError } = await client
      .from('user_account_status')
      .select('account_status')
      .eq('user_id', userId)
      .eq('account_status', 'active')
      .maybeSingle();
    return !statusError && Boolean(status);
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

  return hasAdminRole(params.userId, params.roleClient);
}

export async function getOcrQuotaStatus(params: {
  quotaClient: OcrQuotaSupabase;
}): Promise<OcrQuotaStatus> {
  const { data, error } = await params.quotaClient.rpc('get_ocr_daily_quota_status');
  if (error) throw new Error('OCR_QUOTA_UNAVAILABLE');

  const quota = parseOcrQuotaRpcRow(data);
  return {
    used: quota.used_count,
    max: quota.quota_limit,
    remaining: quota.remaining_count,
    unlimited: quota.unlimited,
    resetAt: quota.reset_at,
  };
}

export async function checkOcrDailyQuota(params: {
  quotaClient: OcrQuotaSupabase;
  operationId: string;
}): Promise<OcrQuotaCheck> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.operationId)) {
    throw new Error('OCR_QUOTA_OPERATION_INVALID');
  }

  const { data, error } = await params.quotaClient.rpc('reserve_ocr_daily_quota', {
    p_operation_id: params.operationId,
  });
  if (error) throw new Error('OCR_QUOTA_UNAVAILABLE');

  const quota = parseOcrQuotaRpcRow(data);
  return {
    used: quota.used_count,
    max: quota.quota_limit,
    remaining: quota.remaining_count,
    unlimited: quota.unlimited,
    resetAt: quota.reset_at,
    exceeded: !quota.allowed,
  };
}
