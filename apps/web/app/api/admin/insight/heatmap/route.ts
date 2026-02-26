import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminInsightHeatmap } from '@/lib/insight/heatmap';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const data = await getAdminInsightHeatmap(false);
    return NextResponse.json(data);
  } catch (error) {
    console.error('[admin/insight/heatmap] failed:', error);
    return NextResponse.json(
      { error: 'Failed to build insight heatmap.' },
      { status: 500 },
    );
  }
}

