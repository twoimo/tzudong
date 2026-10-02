import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { ADMIN_EVALUATION_RECORD_SELECT } from '@/lib/admin/evaluation-records';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { getEvaluationCatalog } from '@/lib/admin/evaluation-catalog-server';
import { evaluationCatalogPage } from '@/lib/admin/evaluation-catalog';
import { parseEvaluationPageQuery } from '@/lib/admin/evaluation-page-query';
import { normalizeEvaluationRecord, withAdminEvaluationDisplayName } from '@/lib/admin/normalize-evaluation-record';
import { findSameVideoDuplicateWarningCandidates, formatSameVideoDuplicateWarning } from '@/lib/admin-same-video-duplicate-warning';
import { findRestaurantIdentityWarnings } from '@/lib/admin-restaurant-identity-warning';
import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';
import { summarizeEvaluationRecord } from '@/lib/admin/evaluation-summary';

export const runtime = 'nodejs';

const PAGE_LIMIT = 1000;
const MAX_EVALUATION_RECORDS = 10000;

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const supabase = createSupabaseServiceRoleClient();

  try {
    if (request && new URL(request.url).searchParams.get('view') === 'page') {
      const { query, limit, cursor } = parseEvaluationPageQuery(new URL(request.url).searchParams);
      const catalog = await getEvaluationCatalog(supabase);
      const page = evaluationCatalogPage(catalog, query, limit, cursor);
      const ids = page.records.map(record => record.id);
      const result = ids.length ? await supabase.from('restaurants').select(ADMIN_EVALUATION_RECORD_SELECT).in('id', ids) : { data: [], error: null };
      if (result.error) throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
      const rows = new Map((result.data ?? []).map(value => {
        const record = normalizeEvaluationRecord(value);
        if (!record) throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
        return [record.id, { record: withAdminEvaluationDisplayName(record), raw: value as unknown as Record<string, unknown> }] as const;
      }));
      // Readback detects concurrent writes between index and row retrieval.
      const current = await getEvaluationCatalog(supabase);
      if (current.revision !== page.revision || ids.some(id => !rows.has(id))) throw new Error('EVALUATION_CURSOR_STALE');
      const fullRecords = ids.map(id => rows.get(id)!.record);
      const records = ids.map(id => summarizeEvaluationRecord(rows.get(id)!.raw, rows.get(id)!.record));
      const warnings = Object.fromEntries(fullRecords.map(record => {
        const related = catalog.byVideo.get(extractVideoIdFromYoutubeLink(record.youtube_link) ?? '') ?? [];
        const candidates = findSameVideoDuplicateWarningCandidates(record, related);
        return [record.id, { sameVideo: { count: candidates.length, candidates: candidates.slice(0, 3), message: formatSameVideoDuplicateWarning(candidates) }, identity: findRestaurantIdentityWarnings(record, related) }];
      }));
      return NextResponse.json({ ...page, records, warnings }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const records: Record<string, unknown>[] = [];

    for (let from = 0; from < MAX_EVALUATION_RECORDS; from += PAGE_LIMIT) {
      const { data, error } = await supabase
        .from('restaurants')
        .select(ADMIN_EVALUATION_RECORD_SELECT)
        .range(from, from + PAGE_LIMIT - 1)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true });

      if (error) {
        throw new Error('restaurants evaluation query failed');
      }

      if (!data || data.length === 0) break;

      records.push(...(data as unknown as Record<string, unknown>[]));

      if (data.length < PAGE_LIMIT) break;
    }

    return NextResponse.json({ records }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'EVALUATION_CURSOR_STALE') return NextResponse.json({ error: code }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
    if (code === 'EVALUATION_QUERY_INVALID' || code === 'EVALUATION_CURSOR_INVALID') return NextResponse.json({ error: code }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
    console.error('[admin/evaluations] failed:', {
      errorName: error instanceof Error ? error.name : typeof error,
    });

    return NextResponse.json(
      { error: 'Failed to load admin evaluation records.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
