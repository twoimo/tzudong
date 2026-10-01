import type { CategoryStats } from '@/types/evaluation';
import { isRecord } from './normalize-evaluation-record';
import type { findSameVideoDuplicateWarningCandidates } from '@/lib/admin-same-video-duplicate-warning';
import type { findRestaurantIdentityWarnings } from '@/lib/admin-restaurant-identity-warning';

export type EvaluationWarnings = Record<string, {
  sameVideo: { count: number; candidates: ReturnType<typeof findSameVideoDuplicateWarningCandidates>; message: string };
  identity: ReturnType<typeof findRestaurantIdentityWarnings>;
}>;

export function isEvaluationCursorStale(error: unknown): boolean {
  return error instanceof Error && error.name === 'EVALUATION_CURSOR_STALE';
}

export interface AdminEvaluationPage {
  records: Record<string, unknown>[];
  stats: CategoryStats;
  filteredTotal: number;
  nextCursor: string | null;
  warnings: EvaluationWarnings;
}

export async function fetchAdminEvaluationPage(query: string, cursor: string | null = null, signal?: AbortSignal): Promise<AdminEvaluationPage> {
  const params = new URLSearchParams(query);
  params.set('view', 'page');
  params.set('limit', '50');
  if (cursor) params.set('cursor', cursor);
  const response = await fetch(`/api/admin/evaluations?${params}`, { cache: 'no-store', signal, headers: { Accept: 'application/json' } });
  if (response.status === 409) { const failure = new Error('EVALUATION_CURSOR_STALE'); failure.name = 'EVALUATION_CURSOR_STALE'; throw failure; }
  if (!response.ok) throw new Error('EVALUATION_PAGE_UNAVAILABLE');
  const value: unknown = await response.json();
  if (!isRecord(value) || !Array.isArray(value.records) || !value.records.every(isRecord)
      || !isRecord(value.stats) || !Object.values(value.stats).every(count => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
      || typeof value.filteredTotal !== 'number' || !Number.isSafeInteger(value.filteredTotal) || value.filteredTotal < 0
      || !(value.nextCursor === null || typeof value.nextCursor === 'string') || !isRecord(value.warnings)) throw new Error('EVALUATION_PAGE_INVALID');
  const stats = value.stats;
  const requiredStats = ['total', 'pending', 'approved', 'hold', 'db_conflict', 'missing', 'not_selected', 'deleted'];
  if (requiredStats.some(key => typeof stats[key] !== 'number')) throw new Error('EVALUATION_PAGE_INVALID');
  for (const record of value.records) {
    if (typeof record.id !== 'string') throw new Error('EVALUATION_PAGE_INVALID');
    const warning = value.warnings[record.id];
    if (!isRecord(warning) || !isRecord(warning.sameVideo) || typeof warning.sameVideo.count !== 'number' || !Number.isSafeInteger(warning.sameVideo.count) || warning.sameVideo.count < 0 || !Array.isArray(warning.sameVideo.candidates) || warning.sameVideo.candidates.length > 3 || typeof warning.sameVideo.message !== 'string' || !Array.isArray(warning.identity)) throw new Error('EVALUATION_PAGE_INVALID');
  }
  return value as unknown as AdminEvaluationPage;
}
