import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { ADMIN_EVALUATION_RECORD_SELECT } from '@/lib/admin/evaluation-records';

export const runtime = 'nodejs';
type EvaluationDetailContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: EvaluationDetailContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const headers = { 'Cache-Control': 'private, no-store' };
  const expected = new URL(request.url).searchParams.get('revision');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return NextResponse.json({ error: 'EVALUATION_ID_INVALID' }, { status: 400, headers });
  if (expected !== null && !/^\d{1,20}$/.test(expected)) return NextResponse.json({ error: 'EVALUATION_CURSOR_INVALID' }, { status: 400, headers });
  const supabase = createSupabaseServiceRoleClient();
  try {
    const rpc = supabase.rpc.bind(supabase) as unknown as (name: 'admin_evaluation_revision') => PromiseLike<{ data: unknown; error: unknown }>;
    const readRevision = async () => {
      const { data, error } = await rpc('admin_evaluation_revision');
      if (error || typeof data !== 'string') throw new Error('EVALUATION_READ_FAILED');
      return data;
    };
    const before = expected === null ? null : await readRevision();
    if (expected !== null && before !== expected) return NextResponse.json({ error: 'EVALUATION_CURSOR_STALE' }, { status: 409, headers });
    const { data, error } = await supabase.from('restaurants').select(ADMIN_EVALUATION_RECORD_SELECT).eq('id', id).maybeSingle();
    if (error) throw new Error('EVALUATION_READ_FAILED');
    if (expected !== null && await readRevision() !== before) return NextResponse.json({ error: 'EVALUATION_CURSOR_STALE' }, { status: 409, headers });
    return NextResponse.json({ record: data }, { status: data ? 200 : 404, headers });
  } catch {
    return NextResponse.json({ error: 'EVALUATION_READ_FAILED' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
