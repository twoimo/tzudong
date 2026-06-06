import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { requireAdmin } from '@/lib/auth/require-admin';
import {
  buildThumbnailProviderRequestEnv,
  getContentLengthRejection,
  getMultipartContentTypeRejection,
  parseThumbnailPayload,
  readThumbnailReferenceImages,
} from '@/lib/admin/youtube-thumbnail-generator/request';
import { generateYoutubeThumbnailWithBackendAgent, getThumbnailBackendAgentStatus } from '@/lib/admin/youtube-thumbnail-generator/backend-agent';
import { persistLocalThumbnailHistory } from '@/lib/admin/youtube-thumbnail-generator/history';
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
        backendAgent: getThumbnailBackendAgentStatus(process.env),
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
          backendAgentCommandEnv: 'THUMBNAIL_AGENT_COMMAND',
          backendAgentRootEnv: 'THUMBNAIL_AGENT_ROOT',
          backendAgentRuntimeEnv: 'THUMBNAIL_AGENT_RUNTIME',
          backendAgentCodexModelEnv: 'THUMBNAIL_AGENT_CODEX_MODEL',
          backendAgentCodexEffortEnv: 'THUMBNAIL_AGENT_CODEX_EFFORT',
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
    const referenceImages = await readThumbnailReferenceImages(files, payload.referenceImageRoles);
    const generationRunId = `thumbnail-generation-${randomUUID()}`;
    const providerRequestEnv = buildThumbnailProviderRequestEnv(process.env, payload.providerId, formData);
    const result = payload.generationMode === 'backend_agent'
      ? await generateYoutubeThumbnailWithBackendAgent(payload, referenceImages, process.env, {
        signal: request.signal,
        runId: generationRunId,
        providerEnv: providerRequestEnv,
      })
      : await generateYoutubeThumbnail(payload, referenceImages, providerRequestEnv, {
        signal: request.signal,
        runId: generationRunId,
      });

    const responseResult = { ...result, warnings: [...result.warnings] };
    try {
      await persistLocalThumbnailHistory(responseResult, payload, process.env, { runId: generationRunId });
    } catch (historyError) {
      console.error('[admin/youtube-thumbnail-generator] history persistence failed:', historyError);
      responseResult.warnings.push('thumbnail_history_persist_failed');
    }

    return NextResponse.json(responseResult, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError('payload_json_invalid', 400, 'payload 필드는 JSON 문자열이어야 합니다.');
    }

    return normalizeRouteError(error);
  }
}
