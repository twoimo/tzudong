import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { getAdminSystemStatus } = await import('@/lib/admin/system-status/status');
    const data = await getAdminSystemStatus();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[admin/system-status] failed:', error);
    return NextResponse.json(
      { error: 'Failed to build admin system status.' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  }
}
