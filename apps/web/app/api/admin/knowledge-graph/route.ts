import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { readLocalKnowledgeGraph } from '@/lib/admin/knowledge-graph-local';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const page = await readLocalKnowledgeGraph(new URL(request.url).searchParams);
    return NextResponse.json(page, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'knowledge_query_invalid') return NextResponse.json({ error: code }, { status: 400, headers });
    if (code === 'knowledge_cursor_stale') return NextResponse.json({ error: code }, { status: 409, headers });
    return NextResponse.json({ error: 'knowledge_unavailable' }, { status: 503, headers });
  }
}
