import { NextRequest, NextResponse } from 'next/server';

import { readCurrentThumbnailDurableRelease } from '@/lib/admin/youtube-thumbnail-generator/release-registry';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;

function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json({ error, detail }, { status, headers: noStoreHeaders });
}

export async function GET(_request: NextRequest) {
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;

    const payload = await readCurrentThumbnailDurableRelease(process.env);
    if (payload.status === 'unavailable') {
      return NextResponse.json(payload, { status: 503, headers: noStoreHeaders });
    }
    return NextResponse.json(payload, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[admin/youtube-thumbnail-generator/releases/current] unexpected failure:', error);
    return jsonError('thumbnail_durable_release_current_failed', 500, '현재 릴리즈를 불러오지 못했습니다.');
  }
}
