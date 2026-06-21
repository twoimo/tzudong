import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json({ error, detail }, { status, headers: noStoreHeaders });
}
async function publishThumbnailDurableReleaseFromRoute(
  request: Parameters<(typeof import('@/lib/admin/youtube-thumbnail-generator/release-registry'))['publishThumbnailDurableRelease']>[0],
) {
  const { publishThumbnailDurableRelease } = await import('@/lib/admin/youtube-thumbnail-generator/release-registry');
  return publishThumbnailDurableRelease(request, process.env);
}


export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as { candidateId?: unknown; textLayers?: unknown } | null;
    const candidateId = typeof body?.candidateId === 'string' ? body.candidateId : '';
    if (!candidateId.trim()) return jsonError('thumbnail_durable_release_candidate_id_required', 400, '게시할 릴리즈 후보 ID가 필요합니다.');

    const payload = await publishThumbnailDurableReleaseFromRoute({
      candidateId,
      textLayers: body?.textLayers,
      publishedBy: uuidPattern.test(auth.userId) ? auth.userId : null,
    });
    if (payload.status === 'unavailable') {
      return NextResponse.json(payload, { status: 503, headers: noStoreHeaders });
    }
    return NextResponse.json(payload, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[admin/youtube-thumbnail-generator/releases/publish] unexpected failure:', error);
    const message = error instanceof Error ? error.message : 'thumbnail_durable_release_publish_failed';
    if (message === 'thumbnail_durable_release_candidate_not_found') {
      return jsonError('thumbnail_durable_release_candidate_not_found', 404, '현재 릴리즈 후보 목록에서 찾을 수 없습니다.');
    }
    if (message === 'thumbnail_durable_release_candidate_sha_mismatch') {
      return jsonError('thumbnail_durable_release_candidate_sha_mismatch', 409, '후보 이미지 해시가 manifest와 달라 게시를 중단했습니다.');
    }
    if (message === 'missing_supabase_env' || message === 'missing_release_table') {
      return jsonError('thumbnail_durable_release_unavailable', 503, '공용 릴리즈 저장소가 아직 준비되지 않았습니다.');
    }
    return jsonError('thumbnail_durable_release_publish_failed', 500, '릴리즈를 게시하지 못했습니다.');
  }
}
