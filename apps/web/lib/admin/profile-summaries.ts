export const ADMIN_PROFILE_SUMMARY_BATCH_SIZE = 100;
export const ADMIN_PROFILE_SUMMARY_MAX_CONCURRENCY = 4;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NICKNAME_LENGTH = 100;

export type AdminProfileSummary = {
  userId: string;
  nickname: string | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function normalizeDistinctUserIds(value: unknown, maximumIds: number | null): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (maximumIds !== null && value.length > maximumIds) return null;

  const userIds: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string' || !UUID_PATTERN.test(candidate)) return null;
    const userId = candidate.toLowerCase();
    if (seen.has(userId)) return null;
    seen.add(userId);
    userIds.push(userId);
  }
  return userIds;
}

export function parseAdminProfileSummaryRequest(value: unknown): string[] | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ['userIds'])) return null;
  return normalizeDistinctUserIds(value.userIds, ADMIN_PROFILE_SUMMARY_BATCH_SIZE);
}

export function mapAdminProfileSummaryRpcRows(
  value: unknown,
  requestedUserIds: readonly string[],
): AdminProfileSummary[] | null {
  if (!Array.isArray(value) || value.length !== requestedUserIds.length) return null;

  const requested = new Set(requestedUserIds);
  const returned = new Map<string, AdminProfileSummary>();
  for (const candidate of value) {
    if (!isPlainObject(candidate)) return null;
    const userId = candidate.user_id;
    const nickname = candidate.nickname;
    if (
      typeof userId !== 'string'
      || !UUID_PATTERN.test(userId)
      || (nickname !== null && (typeof nickname !== 'string' || nickname.length > MAX_NICKNAME_LENGTH))
    ) {
      return null;
    }

    const normalizedUserId = userId.toLowerCase();
    if (!requested.has(normalizedUserId) || returned.has(normalizedUserId)) return null;
    returned.set(normalizedUserId, { userId: normalizedUserId, nickname });
  }

  if (returned.size !== requestedUserIds.length) return null;
  return requestedUserIds.map((userId) => returned.get(userId) as AdminProfileSummary);
}

function parseAdminProfileSummaryResponse(
  value: unknown,
  requestedUserIds: readonly string[],
): AdminProfileSummary[] | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ['rows']) || !Array.isArray(value.rows)) return null;
  if (value.rows.length !== requestedUserIds.length) return null;

  const requested = new Set(requestedUserIds);
  const returned = new Map<string, AdminProfileSummary>();
  for (const candidate of value.rows) {
    if (!isPlainObject(candidate) || !hasExactKeys(candidate, ['userId', 'nickname'])) return null;
    const userId = candidate.userId;
    const nickname = candidate.nickname;
    if (
      typeof userId !== 'string'
      || !UUID_PATTERN.test(userId)
      || (nickname !== null && (typeof nickname !== 'string' || nickname.length > MAX_NICKNAME_LENGTH))
    ) {
      return null;
    }

    const normalizedUserId = userId.toLowerCase();
    if (!requested.has(normalizedUserId) || returned.has(normalizedUserId)) return null;
    returned.set(normalizedUserId, { userId: normalizedUserId, nickname });
  }

  if (returned.size !== requestedUserIds.length) return null;
  return requestedUserIds.map((userId) => returned.get(userId) as AdminProfileSummary);
}

async function fetchAdminProfileSummaryBatch(userIds: readonly string[]): Promise<AdminProfileSummary[]> {
  let response: Response;
  try {
    response = await fetch('/api/admin/profile-summaries', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ userIds }),
    });
  } catch {
    throw new Error('admin-profile-summaries-failed');
  }

  if (!response.ok) throw new Error('admin-profile-summaries-failed');

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('admin-profile-summaries-invalid-response');
  }

  const rows = parseAdminProfileSummaryResponse(payload, userIds);
  if (!rows) throw new Error('admin-profile-summaries-invalid-response');
  return rows;
}

export async function fetchAdminProfileSummaries(userIds: readonly string[]): Promise<AdminProfileSummary[]> {
  if (userIds.length === 0) return [];

  const normalizedUserIds = normalizeDistinctUserIds(userIds, null);
  if (!normalizedUserIds) throw new Error('admin-profile-summaries-invalid-request');

  const batches: string[][] = [];
  for (let offset = 0; offset < normalizedUserIds.length; offset += ADMIN_PROFILE_SUMMARY_BATCH_SIZE) {
    batches.push(
      normalizedUserIds.slice(offset, offset + ADMIN_PROFILE_SUMMARY_BATCH_SIZE),
    );
  }

  const rowsByBatch: AdminProfileSummary[][] = [];
  for (let offset = 0; offset < batches.length; offset += ADMIN_PROFILE_SUMMARY_MAX_CONCURRENCY) {
    const windowRows = await Promise.all(
      batches
        .slice(offset, offset + ADMIN_PROFILE_SUMMARY_MAX_CONCURRENCY)
        .map((batch) => fetchAdminProfileSummaryBatch(batch)),
    );
    rowsByBatch.push(...windowRows);
  }
  return rowsByBatch.flat();
}
