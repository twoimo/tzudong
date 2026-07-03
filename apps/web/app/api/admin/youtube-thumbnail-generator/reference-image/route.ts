import { NextRequest, NextResponse } from 'next/server';

import { fetchThumbnailReferenceImageFromUrl } from '@/lib/admin/youtube-thumbnail-generator/request';
import { ThumbnailGenerationError, getPublicThumbnailGenerationErrorDetail } from '@/lib/admin/youtube-thumbnail-generator/types';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminSafeErrorName } from '@/lib/admin/guarded-mutation-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;

function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json({ error, detail }, { status, headers: noStoreHeaders });
}

function normalizeRouteError(error: unknown) {
  if (error instanceof ThumbnailGenerationError) {
    return jsonError(error.code, error.status, getPublicThumbnailGenerationErrorDetail(error));
  }

  console.error('[admin/youtube-thumbnail-generator/reference-image] unexpected failure', {
    domain: 'youtube_thumbnail_generator',
    action: 'fetch_reference_image',
    step: 'unexpected',
    errorName: getAdminSafeErrorName(error),
  });
  return jsonError('thumbnail_reference_image_failed', 500, '참고 이미지 URL을 처리하지 못했습니다.');
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as { url?: unknown } | null;
    const referenceImage = await fetchThumbnailReferenceImageFromUrl(body?.url);

    return new NextResponse(referenceImage.bytes, {
      headers: {
        ...noStoreHeaders,
        'Content-Type': referenceImage.mime,
        'Content-Length': String(referenceImage.bytes.byteLength),
        'X-Thumbnail-Reference-File-Name': encodeURIComponent(referenceImage.fileName),
      },
    });
  } catch (error) {
    return normalizeRouteError(error);
  }
}
