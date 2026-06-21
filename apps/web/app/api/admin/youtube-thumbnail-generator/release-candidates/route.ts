import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;
const releaseCandidateManifestEnv = 'THUMBNAIL_RELEASE_CANDIDATE_MANIFEST' as const;
const releaseCandidatePromotionRootEnv = 'THUMBNAIL_RELEASE_PROMOTION_ROOT' as const;

function shouldSkipLocalReleaseCandidatesOnVercel() {
  return (
    process.env.VERCEL === '1' &&
    !process.env[releaseCandidateManifestEnv]?.trim() &&
    !process.env[releaseCandidatePromotionRootEnv]?.trim()
  );
}

function buildUnavailableReleaseCandidatesPayload() {
  return {
    updatedAt: null,
    sourceManifestId: null,
    candidates: [],
    promotionState: null,
    batchSummary: null,
    diagnostics: {
      manifestFound: false,
      promotionStateValid: false,
      ignoredPromotionReason: 'vercel_local_artifact_manifest_unavailable',
      warnings: ['local-release-candidate-manifest-unavailable-on-vercel'],
    },
  };
}


function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json({ error, detail }, { status, headers: noStoreHeaders });
}

export async function GET(_request: NextRequest) {
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;

    if (shouldSkipLocalReleaseCandidatesOnVercel()) {
      return NextResponse.json(buildUnavailableReleaseCandidatesPayload(), { headers: noStoreHeaders });
    }

    const { readThumbnailReleaseCandidates } = await import('@/lib/admin/youtube-thumbnail-generator/release-candidates');
    const payload = await readThumbnailReleaseCandidates(process.env);
    return NextResponse.json(payload, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[admin/youtube-thumbnail-generator/release-candidates] unexpected failure:', error);
    return jsonError('thumbnail_release_candidates_failed', 500, '릴리즈 후보를 불러오지 못했습니다.');
  }
}
