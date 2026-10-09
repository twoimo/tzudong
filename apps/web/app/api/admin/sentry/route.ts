import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminSentryIssues, validSentryCursor } from '@/lib/monitoring/sentry-admin';
import type { SentryIssueStatus } from '@/types/admin-sentry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const params = new URL(request.url).searchParams;
    const status = params.get('status') ?? 'unresolved';
    const cursor = params.get('cursor');
    if (!['unresolved', 'resolved', 'ignored'].includes(status) || !validSentryCursor(cursor)
      || [...params.keys()].some((key) => !['status', 'cursor'].includes(key))) {
      return NextResponse.json({ error: 'sentry_query_invalid' }, { status: 400, headers });
    }
    return NextResponse.json(await getAdminSentryIssues(status as SentryIssueStatus, cursor), { headers });
  } catch {
    return NextResponse.json({ error: 'sentry_unavailable' }, { status: 503, headers });
  }
}
