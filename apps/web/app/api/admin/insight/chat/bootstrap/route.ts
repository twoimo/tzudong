import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminInsightChatBootstrap } from '@/lib/insight/chat';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const data = await getAdminInsightChatBootstrap();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[admin/insight/chat/bootstrap] failed:', error);
    return NextResponse.json(
      { error: 'Failed to build chat bootstrap.' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  }
}

