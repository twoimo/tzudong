import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminSafeErrorName } from '@/lib/admin/guarded-mutation-contract';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;
const MAX_THUMBNAIL_RELEASE_CANDIDATE_PROMOTION_REQUEST_BYTES = 4 * 1024;

function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json({ error, detail }, { status, headers: noStoreHeaders });
}
async function promoteThumbnailReleaseCandidateFromRoute(candidateId: string) {
  const { promoteThumbnailReleaseCandidate } = await import('@/lib/admin/youtube-thumbnail-generator/release-candidates');
  return promoteThumbnailReleaseCandidate({ candidateId, promotedBy: 'local-dev-admin' }, process.env);
}


export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;
    if (!isTrustedSameOriginMutation(request)) {
      return jsonError('thumbnail_release_candidate_promote_request_forbidden', 403, '요청을 처리할 수 없습니다.');
    }

    const requestBody = await readBoundedJsonRequest(request, MAX_THUMBNAIL_RELEASE_CANDIDATE_PROMOTION_REQUEST_BYTES);
    const body = requestBody.ok ? requestBody.value as { candidateId?: unknown } | null : null;
    const candidateId = typeof body?.candidateId === 'string' ? body.candidateId : '';
    if (!candidateId.trim()) return jsonError('thumbnail_release_candidate_id_required', 400, '승격할 후보 ID가 필요합니다.');

    const payload = await promoteThumbnailReleaseCandidateFromRoute(candidateId);
    return NextResponse.json(payload, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[admin/youtube-thumbnail-generator/release-candidates/promote] unexpected failure', {
      domain: 'youtube_thumbnail_generator',
      action: 'promote_release_candidate',
      step: 'unexpected',
      errorName: getAdminSafeErrorName(error),
    });
    const message = error instanceof Error ? error.message : 'thumbnail_release_candidate_promote_failed';
    if (message === 'thumbnail_release_candidate_not_found') {
      return jsonError('thumbnail_release_candidate_not_found', 404, '현재 릴리즈 후보 목록에서 찾을 수 없습니다.');
    }
    return jsonError('thumbnail_release_candidate_promote_failed', 500, '릴리즈 후보를 승격하지 못했습니다.');
  }
}
