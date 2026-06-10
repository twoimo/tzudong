import { NextRequest, NextResponse } from 'next/server';

import { readThumbnailReleaseCandidates } from '@/lib/admin/youtube-thumbnail-generator/release-candidates';
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

    const payload = await readThumbnailReleaseCandidates(process.env);
    return NextResponse.json(payload, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[admin/youtube-thumbnail-generator/release-candidates] unexpected failure:', error);
    return jsonError('thumbnail_release_candidates_failed', 500, '릴리즈 후보를 불러오지 못했습니다.');
  }
}
