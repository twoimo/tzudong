import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { ADMIN_EVALUATION_RECORD_SELECT, compareAdminEvaluationRecordsByPublishedAtDesc } from '@/lib/admin/evaluation-records';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

export const runtime = 'nodejs';

const PAGE_LIMIT = 1000;
const MAX_EVALUATION_RECORDS = 10000;

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const supabase = createSupabaseServiceRoleClient();

  try {
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

    records.sort(compareAdminEvaluationRecordsByPublishedAtDesc);

    return NextResponse.json({ records });
  } catch (error) {
    console.error('[admin/evaluations] failed:', {
      errorName: error instanceof Error ? error.name : typeof error,
    });

    return NextResponse.json(
      { error: 'Failed to load admin evaluation records.' },
      { status: 500 },
    );
  }
}
