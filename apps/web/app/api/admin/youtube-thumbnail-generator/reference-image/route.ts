import { NextRequest, NextResponse } from 'next/server';

import { fetchThumbnailReferenceImageFromUrl } from '@/lib/admin/youtube-thumbnail-generator/request';
import { ThumbnailGenerationError } from '@/lib/admin/youtube-thumbnail-generator/types';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;

function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json({ error, detail }, { status, headers: noStoreHeaders });
}

function normalizeRouteError(error: unknown) {
  if (error instanceof ThumbnailGenerationError) {
    return jsonError(error.code, error.status, error.message);
  }

  console.error('[admin/youtube-thumbnail-generator/reference-image] unexpected failure:', error);
  return jsonError('thumbnail_reference_image_failed', 500, '참고 이미지 URL을 처리하지 못했습니다.');
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
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
