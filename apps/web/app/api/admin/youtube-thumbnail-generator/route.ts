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
import {
  generateYoutubeThumbnailWithBackendAgent,
  getThumbnailBackendAgentStatus,
  toPublicThumbnailBackendAgentStatus,
} from '@/lib/admin/youtube-thumbnail-generator/backend-agent';
import { persistLocalThumbnailHistory } from '@/lib/admin/youtube-thumbnail-generator/history';
import {
  generateYoutubeThumbnail,
  getThumbnailProviderAvailability,
} from '@/lib/admin/youtube-thumbnail-generator/providers';
import { resolveThumbnailRetrievalReferences } from '@/lib/admin/youtube-thumbnail-generator/retrieval';
import { ThumbnailGenerationError } from '@/lib/admin/youtube-thumbnail-generator/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SPECIFIC_CREATOR_HOST_PATTERN = /(쯔양|tzuyang)/i;
const HOST_PERSON_REFERENCE_ROLES = new Set(['host', 'person']);

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
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;

    return NextResponse.json(
      {
        target: { width: 1280, height: 720, aspectRatio: '16:9' },
        providers: getThumbnailProviderAvailability(process.env),
        backendAgent: toPublicThumbnailBackendAgentStatus(getThumbnailBackendAgentStatus(process.env)),
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
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
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
    if (
      SPECIFIC_CREATOR_HOST_PATTERN.test(payload.topic) &&
      !referenceImages.some((image) => HOST_PERSON_REFERENCE_ROLES.has(image.role))
    ) {
      throw new ThumbnailGenerationError(
        'host_reference_required',
        '쯔양님이 실제로 나오려면 host/person 참고 이미지를 먼저 추가해야 합니다. 참고 이미지 없이 쯔양님 얼굴을 추측 생성하지 않습니다.',
        400,
      );
    }
    const retrieval = await resolveThumbnailRetrievalReferences(payload, process.env);
    const payloadWithRetrieval = {
      ...payload,
      retrievalEvidence: retrieval.evidence,
      retrievalDiagnostics: retrieval.diagnostics,
    };
    const generationRunId = `thumbnail-generation-${randomUUID()}`;
    const providerRequestEnv = buildThumbnailProviderRequestEnv(process.env, payload.providerId, formData);
    const result = payload.generationMode === 'backend_agent'
      ? await generateYoutubeThumbnailWithBackendAgent(payloadWithRetrieval, referenceImages, process.env, {
        signal: request.signal,
        runId: generationRunId,
        providerEnv: providerRequestEnv,
      })
      : await generateYoutubeThumbnail(payloadWithRetrieval, referenceImages, providerRequestEnv, {
        signal: request.signal,
        runId: generationRunId,
      });

    const responseResult = {
      ...result,
      warnings: [
        ...result.warnings,
        `thumbnail_retrieval_status:${retrieval.diagnostics.status}`,
        ...(retrieval.diagnostics.fallbackReason ? [`thumbnail_retrieval_fallback:${retrieval.diagnostics.fallbackReason}`] : []),
      ],
      retrieval,
    };
    try {
      await persistLocalThumbnailHistory(responseResult, payloadWithRetrieval, process.env, { runId: generationRunId });
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
