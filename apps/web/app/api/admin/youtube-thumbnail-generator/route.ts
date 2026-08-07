import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminSafeErrorName } from '@/lib/admin/guarded-mutation-contract';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import {
  buildThumbnailProviderRequestEnv,
  getContentLengthRejection,
  getMultipartFieldRejection,
  getMultipartContentTypeRejection,
  parseThumbnailPayload,
  readThumbnailReferenceImages,
} from '@/lib/admin/youtube-thumbnail-generator/request';

import {
  ThumbnailGenerationError,
  getPublicThumbnailGenerationErrorDetail,
  type ThumbnailProviderReadinessBlocker,
} from '@/lib/admin/youtube-thumbnail-generator/types';
import { getThumbnailProviderReadinessBlocker } from '@/lib/admin/youtube-thumbnail-generator/readiness-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SPECIFIC_CREATOR_HOST_PATTERN = /(쯔양|tzuyang)/i;
const HOST_PERSON_REFERENCE_ROLES = new Set(['host', 'person']);
const TZUYANG_CHANNEL_PRESET = 'tzuyang-food-travel-collage';

function shouldSkipLocalThumbnailBackendAgentOnVercel() {
  return (
    process.env.VERCEL === '1' &&
    !process.env.THUMBNAIL_AGENT_COMMAND?.trim() &&
    !process.env.THUMBNAIL_AGENT_ROOT?.trim()
  );
}

function buildUnavailableBackendAgentStatus() {
  return {
    available: false,
    mode: 'local_adapter' as const,
    commandConfigured: false,
    commandAvailable: false,
    commandRejectionReason: 'vercel_local_backend_agent_unavailable',
    localAdapterAvailable: false,
    missingPythonModules: [],
    runtime: 'unavailable',
    codexModel: 'unavailable',
    codexEffort: 'unavailable',
    streamingAvailable: false,
    diagnosticsRedacted: true,
  };
}
async function getPublicThumbnailBackendAgentStatus() {
  if (shouldSkipLocalThumbnailBackendAgentOnVercel()) {
    return buildUnavailableBackendAgentStatus();
  }

  const {
    getThumbnailBackendAgentStatus,
    toPublicThumbnailBackendAgentStatus,
  } = await import('@/lib/admin/youtube-thumbnail-generator/backend-agent');

  return toPublicThumbnailBackendAgentStatus(getThumbnailBackendAgentStatus(process.env));
}

async function runThumbnailBackendAgentGeneration(
  payloadWithRetrieval: ReturnType<typeof parseThumbnailPayload> & {
    retrievalEvidence: unknown;
    retrievalDiagnostics: unknown;
  },
  generationReferenceImages: Awaited<ReturnType<typeof readThumbnailReferenceImages>>,
  generationRunId: string,
  providerRequestEnv: NodeJS.ProcessEnv,
  request: NextRequest,
) {
  if (shouldSkipLocalThumbnailBackendAgentOnVercel()) {
    throw new ThumbnailGenerationError(
      'provider_unavailable',
      'Vercel production does not include the local thumbnail backend agent. Use direct provider mode or configure THUMBNAIL_AGENT_COMMAND.',
      503,
    );
  }

  const { generateYoutubeThumbnailWithBackendAgent } = await import('@/lib/admin/youtube-thumbnail-generator/backend-agent');
  return await generateYoutubeThumbnailWithBackendAgent(payloadWithRetrieval, generationReferenceImages, process.env, {
    signal: request.signal,
    runId: generationRunId,
    providerEnv: providerRequestEnv,
  });
}

function buildVercelThumbnailProviderAvailability() {
  const openAiModel = process.env.THUMBNAIL_OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-2';
  const openAiStrictBlock = openAiModel !== 'gpt-image-2'
    ? {
      available: false,
      reason: 'openai_model_not_allowed' as const,
      model: openAiModel === 'gpt-image-2' ? 'gpt-image-2' : 'unsupported',
    }
    : !process.env.OPENAI_API_KEY?.trim()
      ? {
        available: false,
        reason: 'openai_api_key_required' as const,
        model: openAiModel,
      }
      : null;

  return {
    localCodex: {
      available: false,
      reason: 'local_codex_unavailable_on_vercel' as const,
      model: 'unconfigured:gpt-image-2',
      strictExactModelRequired: true,
      command: null,
      providerId: 'local-codex' as const,
      modelProvenance: 'unverified' as const,
    },
    openaiGptImage2: openAiStrictBlock
      ? {
        ...openAiStrictBlock,
        providerId: 'openai-gpt-image-2' as const,
        modelProvenance: 'requested-label' as const,
        liveEnabled: true,
        browserKeyStorage: 'memory_only_operation_scoped' as const,
        strictExactModelRequired: false,
      }
      : {
        available: true,
        reason: 'ready' as const,
        model: 'gpt-image-2',
        providerId: 'openai-gpt-image-2' as const,
        modelProvenance: 'requested-label' as const,
        liveEnabled: true,
        browserKeyStorage: 'memory_only_operation_scoped' as const,
        strictExactModelRequired: false,
      },
  };
}

async function getPublicThumbnailProviderAvailability() {
  if (process.env.VERCEL === '1') {
    return buildVercelThumbnailProviderAvailability();
  }

  const { getThumbnailProviderAvailability } = await import('@/lib/admin/youtube-thumbnail-generator/providers');
  return getThumbnailProviderAvailability(process.env);
}

async function runDirectThumbnailProviderGeneration(
  payloadWithRetrieval: ReturnType<typeof parseThumbnailPayload> & {
    retrievalEvidence: unknown;
    retrievalDiagnostics: unknown;
  },
  generationReferenceImages: Awaited<ReturnType<typeof readThumbnailReferenceImages>>,
  providerRequestEnv: NodeJS.ProcessEnv,
  generationRunId: string,
  request: NextRequest,
) {
  const { generateYoutubeThumbnail } = await import('@/lib/admin/youtube-thumbnail-generator/providers');
  return await generateYoutubeThumbnail(payloadWithRetrieval, generationReferenceImages, providerRequestEnv, {
    signal: request.signal,
    runId: generationRunId,
  });
}
const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;

function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json({ error, detail }, { status, headers: noStoreHeaders });
}

function jsonReadinessBlocker(blocker: ThumbnailProviderReadinessBlocker) {
  return NextResponse.json(blocker, { status: 503, headers: noStoreHeaders });
}

function isRouteRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toPublicStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 160))
    : [];
}

function buildPublicThumbnailBackendAgent(value: unknown) {
  if (!isRouteRecord(value)) return undefined;
  return {
    mode: value.mode,
    runtime: value.runtime,
    concept: value.concept,
    layoutBrief: value.layoutBrief,
    promptAddendum: value.promptAddendum,
    safetyReview: value.safetyReview,
    nextActions: toPublicStringArray(value.nextActions),
    diagnostics: { diagnosticsRedacted: true },
  };
}

function buildPublicThumbnailRetrieval(value: unknown) {
  if (!isRouteRecord(value)) return undefined;
  const diagnostics = isRouteRecord(value.diagnostics) ? value.diagnostics : {};
  const evidence = Array.isArray(value.evidence)
    ? value.evidence
      .filter(isRouteRecord)
      .map((item) => ({
        id: item.id,
        source: item.source,
        intent: item.intent,
        uploadRole: item.uploadRole,
        videoId: item.videoId,
        title: typeof item.title === 'string' ? item.title.slice(0, 120) : undefined,
        startSec: item.startSec,
        endSec: item.endSec,
        hybridScore: item.hybridScore,
        mmrRank: item.mmrRank,
        rerankScore: item.rerankScore,
      }))
    : [];

  return {
    evidence,
    diagnostics: {
      status: diagnostics.status,
      candidateCount: diagnostics.candidateCount,
      selectedReferenceIds: Array.isArray(diagnostics.selectedReferenceIds)
        ? diagnostics.selectedReferenceIds.filter((item): item is string => typeof item === 'string')
        : [],
      fallbackReason: diagnostics.fallbackReason,
      usedModels: diagnostics.usedModels,
      operations: diagnostics.operations,
      commandRuntime: diagnostics.commandRuntime,
      elapsedMs: diagnostics.elapsedMs,
    },
  };
}

function buildThumbnailGenerationRouteResponse(result: Record<string, unknown>) {
  return {
    baseImage: result.baseImage,
    prompt: result.prompt,
    warnings: toPublicStringArray(result.warnings),
    backendAgent: buildPublicThumbnailBackendAgent(result.backendAgent),
    retrieval: buildPublicThumbnailRetrieval(result.retrieval),
  };
}

function normalizeRouteError(error: unknown) {
  if (error instanceof ThumbnailGenerationError) {
    return jsonError(error.code, error.status, getPublicThumbnailGenerationErrorDetail(error));
  }

  console.error('[admin/youtube-thumbnail-generator] unexpected failure', {
    domain: 'youtube_thumbnail_generator',
    action: 'generate_thumbnail',
    step: 'unexpected',
    errorName: getAdminSafeErrorName(error),
  });
  return jsonError('thumbnail_generation_failed', 500, '썸네일 생성 요청을 처리하지 못했습니다.');
}

async function resolveThumbnailReferencesForRoute(
  payload: ReturnType<typeof parseThumbnailPayload>,
  referenceImages: Awaited<ReturnType<typeof readThumbnailReferenceImages>>,
  requestsSpecificCreatorHost: boolean,
) {
  if (process.env.VERCEL === '1') {
    return {
      retrieval: {
        evidence: [],
        diagnostics: {
          status: 'fallback' as const,
          candidateCount: 0,
          selectedReferenceIds: [],
          fallbackReason: 'disabled' as const,
          commandRuntime: 'none' as const,
        },
      },
      automaticReferenceImages: {
        images: [],
        selectedReferenceIds: [],
        warnings: ['thumbnail_retrieval_skipped_on_vercel'],
      },
    };
  }

  const { resolveThumbnailRetrievalReferences } = await import('@/lib/admin/youtube-thumbnail-generator/retrieval');
  const { readThumbnailRetrievalReferenceImages } = await import('@/lib/admin/youtube-thumbnail-generator/retrieval-reference-images');
  const retrieval = await resolveThumbnailRetrievalReferences(payload, process.env);
  const automaticReferenceImages = await readThumbnailRetrievalReferenceImages(
    retrieval.evidence,
    referenceImages.length,
    {},
    { allowHostPersonFromRetrievedThumbnails: requestsSpecificCreatorHost },
  );
  return { retrieval, automaticReferenceImages };
}
function shouldUseTzuyangHostReferences(payload: ReturnType<typeof parseThumbnailPayload>) {
  return SPECIFIC_CREATOR_HOST_PATTERN.test(payload.topic)
    || payload.stylePreset === TZUYANG_CHANNEL_PRESET;
}

export async function GET(_request: NextRequest) {
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;

    const backendAgentStatus = await getPublicThumbnailBackendAgentStatus();

    return NextResponse.json(
      {
        target: { width: 1280, height: 720, aspectRatio: '16:9' },
        providers: await getPublicThumbnailProviderAvailability(),
        // backendAgent: toPublicThumbnailBackendAgentStatus(getThumbnailBackendAgentStatus(process.env))
        backendAgent: backendAgentStatus,
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
    if (!isTrustedSameOriginMutation(request)) {
      return jsonError('thumbnail_generation_request_forbidden', 403, '요청을 처리할 수 없습니다.');
    }

    // generateYoutubeThumbnail and generateYoutubeThumbnailWithBackendAgent both stay behind the admin gate above.

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
    const fieldRejection = getMultipartFieldRejection(formData);
    if (fieldRejection) return jsonError(fieldRejection.error, fieldRejection.status);

    const payloadEntries = formData.getAll('payload');
    if (payloadEntries.length !== 1 || typeof payloadEntries[0] !== 'string') {
      return jsonError('payload_json_required_once', 400);
    }

    const rawPayload = JSON.parse(payloadEntries[0]) as unknown;
    const routeStartedAt = Date.now();
    const payload = parseThumbnailPayload(rawPayload);
    const readinessBlocker = await getThumbnailProviderReadinessBlocker(process.env);
    if (readinessBlocker) return jsonReadinessBlocker(readinessBlocker);
    const files = formData
      .getAll('referenceImages')
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);
    const referenceImages = await readThumbnailReferenceImages(files, payload.referenceImageRoles);
    const requestsSpecificCreatorHost = shouldUseTzuyangHostReferences(payload);
    const retrievalStartedAt = Date.now();
    const {
      retrieval,
      automaticReferenceImages,
    } = await resolveThumbnailReferencesForRoute(
      payload,
      referenceImages,
      requestsSpecificCreatorHost,
    );
    const retrievalElapsedMs = Date.now() - retrievalStartedAt;
    const automaticReferenceElapsedMs = 0;
    const generationReferenceImages = [
      ...referenceImages,
      ...automaticReferenceImages.images,
    ];
    if (
      requestsSpecificCreatorHost &&
      !generationReferenceImages.some((image) => HOST_PERSON_REFERENCE_ROLES.has(image.role))
    ) {
      throw new ThumbnailGenerationError(
        'host_reference_required',
        '쯔양님이 실제로 나오려면 기보유 쯔양 썸네일 레퍼런스 또는 업로드한 인물 참고 이미지가 필요합니다. 레퍼런스를 불러오지 못하면 사람 없는 음식 썸네일로 대신 만들지 않습니다.',
        400,
      );
    }
    const payloadWithRetrieval = {
      ...payload,
      retrievalEvidence: retrieval.evidence,
      retrievalDiagnostics: retrieval.diagnostics,
    };
    const generationRunId = `thumbnail-generation-${randomUUID()}`;
    const providerRequestEnv = buildThumbnailProviderRequestEnv(process.env, payload.providerId, formData);
    const generationStartedAt = Date.now();
    const result = payload.generationMode === 'backend_agent'
      ? await runThumbnailBackendAgentGeneration(
        payloadWithRetrieval,
        generationReferenceImages,
        generationRunId,
        providerRequestEnv,
        request,
      )
      : await runDirectThumbnailProviderGeneration(
        payloadWithRetrieval,
        generationReferenceImages,
        providerRequestEnv,
        generationRunId,
        request,
      );
    const generationElapsedMs = Date.now() - generationStartedAt;

    const responseResult = {
      ...result,
      warnings: [
        ...result.warnings,
        `thumbnail_retrieval_status:${retrieval.diagnostics.status}`,
        `thumbnail_retrieval_visual_refs:${automaticReferenceImages.images.length}`,
        `thumbnail_timing_ms:retrieval=${retrievalElapsedMs}`,
        `thumbnail_timing_ms:automatic_refs=${automaticReferenceElapsedMs}`,
        `thumbnail_timing_ms:generation=${generationElapsedMs}`,
        ...(automaticReferenceImages.selectedReferenceIds.length
          ? [`thumbnail_retrieval_visual_ref_ids:${automaticReferenceImages.selectedReferenceIds.join(',')}`]
          : []),
        ...automaticReferenceImages.warnings,
        ...(retrieval.diagnostics.fallbackReason ? [`thumbnail_retrieval_fallback:${retrieval.diagnostics.fallbackReason}`] : []),
      ],
      retrieval,
    };
    const historyStartedAt = Date.now();
    try {
      if (process.env.VERCEL === '1') {
        responseResult.warnings.push('thumbnail_history_skipped_on_vercel');
      } else {
        const { persistLocalThumbnailHistory } = await import('@/lib/admin/youtube-thumbnail-generator/history');
        await persistLocalThumbnailHistory(responseResult, payloadWithRetrieval, process.env, { runId: generationRunId });
      }
    } catch (historyError) {
      console.error('[admin/youtube-thumbnail-generator] history persistence failed', {
        domain: 'youtube_thumbnail_generator',
        action: 'generate_thumbnail',
        step: 'history-persistence',
        correlationId: generationRunId,
        errorName: getAdminSafeErrorName(historyError),
      });
      responseResult.warnings.push('thumbnail_history_persist_failed');
    }
    responseResult.warnings.push(`thumbnail_timing_ms:history=${Date.now() - historyStartedAt}`);
    responseResult.warnings.push(`thumbnail_timing_ms:total=${Date.now() - routeStartedAt}`);

    return NextResponse.json(buildThumbnailGenerationRouteResponse(responseResult), { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError('payload_json_invalid', 400, 'payload 필드는 JSON 문자열이어야 합니다.');
    }

    return normalizeRouteError(error);
  }
}
