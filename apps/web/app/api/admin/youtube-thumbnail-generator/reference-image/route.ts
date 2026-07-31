import { NextRequest, NextResponse } from 'next/server';

import { fetchThumbnailReferenceImageFromUrl } from '@/lib/admin/youtube-thumbnail-generator/request';
import { ThumbnailGenerationError, getPublicThumbnailGenerationErrorDetail } from '@/lib/admin/youtube-thumbnail-generator/types';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminSafeErrorName } from '@/lib/admin/guarded-mutation-contract';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;
const MAX_THUMBNAIL_REFERENCE_IMAGE_REQUEST_BYTES = 4 * 1024;

function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json({ error, detail }, { status, headers: noStoreHeaders });
}
function streamCanonicalImageBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
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
    if (!isTrustedSameOriginMutation(request)) {
      return jsonError('thumbnail_reference_image_request_forbidden', 403, '요청을 처리할 수 없습니다.');
    }

    const requestBody = await readBoundedJsonRequest(request, MAX_THUMBNAIL_REFERENCE_IMAGE_REQUEST_BYTES);
    const body = requestBody.ok ? requestBody.value as { url?: unknown } | null : null;
    const referenceImage = await fetchThumbnailReferenceImageFromUrl(body?.url);

    return new NextResponse(streamCanonicalImageBytes(referenceImage.bytes), {
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
