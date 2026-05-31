import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import {
  getContentLengthRejection,
  getMultipartContentTypeRejection,
  parseThumbnailPayload,
  readThumbnailReferenceImages,
} from '@/lib/admin/youtube-thumbnail-generator/request';
import {
  generateYoutubeThumbnail,
  getThumbnailProviderAvailability,
} from '@/lib/admin/youtube-thumbnail-generator/providers';
import { ThumbnailGenerationError } from '@/lib/admin/youtube-thumbnail-generator/types';

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

  console.error('[admin/youtube-thumbnail-generator] unexpected failure:', error);
  return jsonError('thumbnail_generation_failed', 500, '썸네일 생성 요청을 처리하지 못했습니다.');
}

export async function GET(_request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    return NextResponse.json(
      {
        target: { width: 1280, height: 720, aspectRatio: '16:9' },
        providers: getThumbnailProviderAvailability(process.env),
        limits: {
          maxFiles: 8,
          maxFileBytes: 8_388_608,
          maxTotalBytes: 33_554_432,
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        configuration: {
          liveApiGate: 'THUMBNAIL_GENERATOR_ENABLE_LIVE_API',
          openaiModelEnv: 'THUMBNAIL_OPENAI_IMAGE_MODEL',
          geminiModelEnv: 'THUMBNAIL_GEMINI_IMAGE_MODEL',
          localCodexGate: 'ALLOW_LOCAL_CLI_THUMBNAIL',
        },
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return normalizeRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const contentTypeRejection = getMultipartContentTypeRejection(request.headers);
    if (contentTypeRejection) {
      return jsonError(contentTypeRejection.error, contentTypeRejection.status);
    }

    const lengthRejection = getContentLengthRejection(request.headers);
    if (lengthRejection) {
      return jsonError(lengthRejection.error, lengthRejection.status);
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) return jsonError('malformed_multipart_form', 400);

    const payloadEntries = formData.getAll('payload');
    if (payloadEntries.length !== 1 || typeof payloadEntries[0] !== 'string') {
      return jsonError('payload_json_required_once', 400);
    }

    const rawPayload = JSON.parse(payloadEntries[0]) as unknown;
    const payload = parseThumbnailPayload(rawPayload);
    const files = formData
      .getAll('referenceImages')
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);
    const referenceImages = await readThumbnailReferenceImages(files);
    const result = await generateYoutubeThumbnail(payload, referenceImages, process.env);

    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError('payload_json_invalid', 400, 'payload 필드는 JSON 문자열이어야 합니다.');
    }

    return normalizeRouteError(error);
  }
}
