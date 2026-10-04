import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { ADMIN_EVALUATION_RECORD_SELECT } from '@/lib/admin/evaluation-records';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createHash } from 'node:crypto';
import { DatabaseEvaluationPageCache,type EvaluationPageClient } from '@/lib/admin/evaluation-page-server';
import { parseEvaluationPageQuery } from '@/lib/admin/evaluation-page-query';

export const runtime = 'nodejs';

const PAGE_LIMIT = 1000;
const MAX_EVALUATION_RECORDS = 10000;
const pageCache = new DatabaseEvaluationPageCache();

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const supabase = createSupabaseServiceRoleClient();

  try {
    if (request && new URL(request.url).searchParams.get('view') === 'page') {
      const { query, limit, cursor } = parseEvaluationPageQuery(new URL(request.url).searchParams);
      const scope=createHash('sha256').update(`${process.env.NEXT_PUBLIC_SUPABASE_URL??''}:${process.env.SUPABASE_SERVICE_ROLE_KEY??''}`).digest('hex');
      const page = await pageCache.read(supabase as unknown as EvaluationPageClient,scope,query,limit,cursor);
      return NextResponse.json(page, { headers: { 'Cache-Control': 'private, no-store' } });
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
    if (code === 'EVALUATION_READ_CAPACITY_EXCEEDED') return NextResponse.json({ error: code }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
    console.error('[admin/evaluations] failed');

    return NextResponse.json(
      { error: 'Failed to load admin evaluation records.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
