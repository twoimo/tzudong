import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { runtimeImport } from '@/lib/server/runtime-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;

function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json({ error, detail }, { status, headers: noStoreHeaders });
}
async function promoteThumbnailReleaseCandidateFromRoute(candidateId: string) {
  const { promoteThumbnailReleaseCandidate } = await runtimeImport<typeof import('@/lib/admin/youtube-thumbnail-generator/release-candidates')>('@/lib/admin/youtube-thumbnail-generator/release-candidates');
  return promoteThumbnailReleaseCandidate({ candidateId, promotedBy: 'local-dev-admin' }, process.env);
}


export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as { candidateId?: unknown } | null;
    const candidateId = typeof body?.candidateId === 'string' ? body.candidateId : '';
    if (!candidateId.trim()) return jsonError('thumbnail_release_candidate_id_required', 400, '승격할 후보 ID가 필요합니다.');

    const payload = await promoteThumbnailReleaseCandidateFromRoute(candidateId);
    return NextResponse.json(payload, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[admin/youtube-thumbnail-generator/release-candidates/promote] unexpected failure:', error);
    const message = error instanceof Error ? error.message : 'thumbnail_release_candidate_promote_failed';
    if (message === 'thumbnail_release_candidate_not_found') {
      return jsonError('thumbnail_release_candidate_not_found', 404, '현재 릴리즈 후보 목록에서 찾을 수 없습니다.');
    }
    return jsonError('thumbnail_release_candidate_promote_failed', 500, '릴리즈 후보를 승격하지 못했습니다.');
  }
}
