import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminSafeErrorName } from '@/lib/admin/guarded-mutation-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;

function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json({ error, detail }, { status, headers: noStoreHeaders });
}
async function readThumbnailHistoryFromRoute() {
  if (process.env.VERCEL === '1') {
    return {
      items: [],
      diagnostics: {
        status: 'unavailable',
        reason: 'thumbnail_history_skipped_on_vercel',
      },
    };
  }

  const { readThumbnailHistory } = await import('@/lib/admin/youtube-thumbnail-generator/history');
  return readThumbnailHistory(process.env);
}


export async function GET(_request: NextRequest) {
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;

    const history = await readThumbnailHistoryFromRoute();
    return NextResponse.json(history, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[admin/youtube-thumbnail-generator/history] unexpected failure', {
      domain: 'youtube_thumbnail_generator',
      action: 'read_history',
      step: 'unexpected',
      errorName: getAdminSafeErrorName(error),
    });
    return jsonError('thumbnail_history_failed', 500, '썸네일 생성 히스토리를 불러오지 못했습니다.');
  }
}
