import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { ADMIN_EVALUATION_RECORD_SELECT } from '@/lib/admin/evaluation-records';

export const runtime = 'nodejs';
type EvaluationDetailContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: EvaluationDetailContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return NextResponse.json({ error: 'EVALUATION_ID_INVALID' }, { status: 400 });
  const supabase = createSupabaseServiceRoleClient();
  try {
    const { data, error } = await supabase.from('restaurants').select(ADMIN_EVALUATION_RECORD_SELECT).eq('id', id).maybeSingle();
    if (error) throw new Error('EVALUATION_READ_FAILED');
    return NextResponse.json({ record: data }, { status: data ? 200 : 404, headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'EVALUATION_READ_FAILED' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
