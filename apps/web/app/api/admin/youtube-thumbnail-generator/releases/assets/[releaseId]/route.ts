import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ releaseId: string }>;
};

function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json({ error, detail }, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function readThumbnailDurableReleaseAssetFromRoute(releaseId: string) {
  const { readThumbnailDurableReleaseAsset } = await import('@/lib/admin/youtube-thumbnail-generator/release-registry');
  return readThumbnailDurableReleaseAsset(releaseId, process.env);
}


export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;

    const { releaseId } = await context.params;
    const asset = await readThumbnailDurableReleaseAssetFromRoute(releaseId);
    return new NextResponse(new Uint8Array(asset.bytes), {
      status: 200,
      headers: {
        'Content-Type': asset.contentType || 'image/png',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[admin/youtube-thumbnail-generator/releases/assets] unexpected failure:', error);
    const message = error instanceof Error ? error.message : 'thumbnail_durable_release_asset_failed';
    if (message === 'thumbnail_durable_release_asset_not_found' || message === 'thumbnail_durable_release_id_invalid') {
      return jsonError('thumbnail_durable_release_asset_not_found', 404, '릴리즈 이미지를 찾을 수 없습니다.');
    }
    if (message === 'missing_supabase_env' || message === 'missing_release_table') {
      return jsonError('thumbnail_durable_release_unavailable', 503, '공용 릴리즈 저장소가 아직 준비되지 않았습니다.');
    }
    return jsonError('thumbnail_durable_release_asset_failed', 500, '릴리즈 이미지를 불러오지 못했습니다.');
  }
}
