import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminInsightSeason } from '@/lib/insight/season';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const data = await getAdminInsightSeason(false);
    return NextResponse.json(data);
  } catch (error) {
    console.error('[admin/insight/season] failed:', error);
    return NextResponse.json(
      { error: 'Failed to build season insight.' },
      { status: 500 },
    );
  }
}

