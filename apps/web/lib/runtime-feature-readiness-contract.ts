export const FEATURE_DATABASE_READINESS_SCHEMA_VERSION = 1 as const;
export const FEATURE_DATABASE_READY_CODE = 'FEATURE_DATABASE_READY' as const;
export const FEATURE_DATABASE_HELD_CODE = 'FEATURE_DATABASE_HELD' as const;
export const FEATURE_DATABASE_HELD_MESSAGE = '기능 준비가 완료될 때까지 잠시 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.';

export type FeatureDatabaseReadiness = Readonly<{
  schemaVersion: typeof FEATURE_DATABASE_READINESS_SCHEMA_VERSION;
  status: 'ready' | 'held';
  code: typeof FEATURE_DATABASE_READY_CODE | typeof FEATURE_DATABASE_HELD_CODE;
}>;

export const FEATURE_DATABASE_READY: FeatureDatabaseReadiness = Object.freeze({
  schemaVersion: FEATURE_DATABASE_READINESS_SCHEMA_VERSION,
  status: 'ready',
  code: FEATURE_DATABASE_READY_CODE,
});

export const FEATURE_DATABASE_HELD: FeatureDatabaseReadiness = Object.freeze({
  schemaVersion: FEATURE_DATABASE_READINESS_SCHEMA_VERSION,
  status: 'held',
  code: FEATURE_DATABASE_HELD_CODE,
});

export function parseFeatureDatabaseReadiness(value: unknown): FeatureDatabaseReadiness {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return FEATURE_DATABASE_HELD;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 3
    || Object.keys(candidate).some((key) => !['schemaVersion', 'status', 'code'].includes(key))) return FEATURE_DATABASE_HELD;
  if (candidate.schemaVersion !== FEATURE_DATABASE_READINESS_SCHEMA_VERSION) return FEATURE_DATABASE_HELD;
  if (candidate.status === 'ready' && candidate.code === FEATURE_DATABASE_READY_CODE) return FEATURE_DATABASE_READY;
  return FEATURE_DATABASE_HELD;
}

export async function fetchFeatureDatabaseReadiness(
  fetchImpl: typeof fetch = fetch,
): Promise<FeatureDatabaseReadiness> {
  try {
    const response = await fetchImpl('/api/runtime-compatibility/features', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      method: 'GET',
    });
    if (!response.ok) return FEATURE_DATABASE_HELD;
    return parseFeatureDatabaseReadiness(await response.json());
  } catch {
    return FEATURE_DATABASE_HELD;
  }
}
