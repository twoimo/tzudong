import { NextRequest, NextResponse } from 'next/server';

import { readThumbnailHistory } from '@/lib/admin/youtube-thumbnail-generator/history';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;

function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json({ error, detail }, { status, headers: noStoreHeaders });
}

export async function GET(_request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const history = await readThumbnailHistory(process.env);
    return NextResponse.json(history, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[admin/youtube-thumbnail-generator/history] unexpected failure:', error);
    return jsonError('thumbnail_history_failed', 500, '썸네일 생성 히스토리를 불러오지 못했습니다.');
  }
}
