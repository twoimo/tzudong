import { createHash } from 'node:crypto';
import type { EvaluationRecord } from '@/types/evaluation';
import { normalizeEvaluationRecord, withAdminEvaluationDisplayName, isRecord } from './normalize-evaluation-record';
import { filterEvaluationRecords, evaluationStats, type EvaluationQuery } from './evaluation-query';
import { compareAdminEvaluationsByLatestDesc } from './evaluation-records';
import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';

export interface EvaluationCatalog {
  revision: string;
  records: EvaluationRecord[];
  byVideo: Map<string, EvaluationRecord[]>;
  stats: ReturnType<typeof evaluationStats>;
}

export function buildEvaluationCatalog(value: unknown): EvaluationCatalog {
  if (!isRecord(value) || typeof value.revision !== 'string' || !/^\d+$/.test(value.revision)
      || !Array.isArray(value.records) || value.records.length > 50000) throw new Error('EVALUATION_CATALOG_INVALID');
  const records = value.records.map(normalizeEvaluationRecord).filter((record): record is EvaluationRecord => record !== null).map(withAdminEvaluationDisplayName).sort(compareAdminEvaluationsByLatestDesc);
  if (records.length !== value.records.length) throw new Error('EVALUATION_CATALOG_INVALID');
  const byVideo = new Map<string, EvaluationRecord[]>();
  const relatedOrder = [...records].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at) || left.id.localeCompare(right.id));
  for (const record of relatedOrder) {
    const video = extractVideoIdFromYoutubeLink(record.youtube_link);
    if (!video) continue;
    const related = byVideo.get(video) ?? [];
    related.push(record);
    byVideo.set(video, related);
  }
  return { revision: value.revision, records, byVideo, stats: evaluationStats(records) };
}

export class EvaluationCatalogCache {
  private cached: EvaluationCatalog | null = null;
  private pending: Promise<EvaluationCatalog> | null = null;
  async get(revision: string, load: () => Promise<unknown>): Promise<EvaluationCatalog> {
    if (this.cached?.revision === revision) return this.cached;
    // Concurrent requests coalesce, but a different revision must never reuse a stale result.
    if (this.pending) {
      const result = await this.pending;
      if (result.revision === revision) return result;
    }
    const promise = load().then(buildEvaluationCatalog);
    this.pending = promise;
    try {
      const result = await promise;
      this.cached = result;
      return result;
    } finally {
      if (this.pending === promise) this.pending = null;
    }
  }
}

export function evaluationCatalogPage(catalog: EvaluationCatalog, query: EvaluationQuery, limit = 50, cursor: string | null = null) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('EVALUATION_QUERY_INVALID');
  const queryKey = createHash('sha256').update(JSON.stringify(query)).digest('hex');
  let after: string | null = null;
  if (cursor) {
    if (cursor.length > 4096) throw new Error('EVALUATION_CURSOR_INVALID');
    let decoded: unknown;
    try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()); }
    catch { throw new Error('EVALUATION_CURSOR_INVALID'); }
    if (!isRecord(decoded) || typeof decoded.id !== 'string' || decoded.query !== queryKey) throw new Error('EVALUATION_CURSOR_INVALID');
    if (decoded.revision !== catalog.revision) throw new Error('EVALUATION_CURSOR_STALE');
    after = decoded.id;
  }
  const filtered = filterEvaluationRecords(catalog.records, query, true);
  const offset = after ? filtered.findIndex(record => record.id === after) + 1 : 0;
  if (after && offset === 0) throw new Error('EVALUATION_CURSOR_STALE');
  const records = filtered.slice(offset, offset + limit);
  const nextCursor = offset + records.length < filtered.length
    ? Buffer.from(JSON.stringify({ revision: catalog.revision, query: queryKey, id: records.at(-1)?.id })).toString('base64url') : null;
  return { records, nextCursor, stats: catalog.stats, filteredTotal: filtered.length, revision: catalog.revision };
}
