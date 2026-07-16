import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminSafeErrorName } from '@/lib/admin/guarded-mutation-contract';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_THUMBNAIL_DURABLE_RELEASE_PUBLISH_REQUEST_BYTES = 4 * 1024;

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
    if (!isTrustedSameOriginMutation(request)) {
      return jsonError('thumbnail_durable_release_publish_request_forbidden', 403, '요청을 처리할 수 없습니다.');
    }

    const requestBody = await readBoundedJsonRequest(request, MAX_THUMBNAIL_DURABLE_RELEASE_PUBLISH_REQUEST_BYTES);
    const body = requestBody.ok
      ? requestBody.value as { candidateId?: unknown; textLayers?: unknown } | null
      : null;
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
    console.error('[admin/youtube-thumbnail-generator/releases/publish] unexpected failure', {
      domain: 'youtube_thumbnail_generator',
      action: 'publish_release',
      step: 'unexpected',
      errorName: getAdminSafeErrorName(error),
    });
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
