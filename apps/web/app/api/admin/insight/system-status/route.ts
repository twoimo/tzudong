import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminInsightSystemStatus } from '@/lib/insight/chat-system-status';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const data = await getAdminInsightSystemStatus();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[admin/insight/system-status] failed:', error);
    return NextResponse.json(
      { error: 'Failed to build admin insight system status.' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  }
}
