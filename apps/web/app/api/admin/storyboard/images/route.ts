import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import {
  generateStoryboardSceneImages,
  getStoryboardImageProviderAvailability,
  normalizeStoryboardBrowserOpenAIApiKey,
  StoryboardImageGenerationError,
} from '@/lib/admin/storyboard/image-provider';
import {
  STORYBOARD_BROWSER_OPENAI_API_KEY_HEADER,
} from '@/lib/admin/storyboard/image-provider-readiness';
import { persistLocalStoryboardHistory } from '@/lib/admin/storyboard/history';
import { sanitizeStoryboardPublicText } from '@/lib/admin/storyboard/prompt-safety';
import {
  STORYBOARD_CHAT_MIN_SEGMENT_COUNT,
  STORYBOARD_IMAGE_GENERATION_BATCH_SIZE,
  STORYBOARD_MAX_SEGMENT_COUNT,
} from '@/lib/admin/storyboard/types';
import type {
  StoryboardGenerateRequest,
  StoryboardGenerationResult,
  StoryboardScene,
  StoryboardTone,
} from '@/lib/admin/storyboard/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;
const storyboardTones = new Set<StoryboardTone>(['warm', 'energetic', 'documentary', 'comfort']);

function getStoryboardImageRouteEnv() {
  return {
    ...process.env,
    CODEX_IMAGEGEN_AGENT_MODEL: process.env.CODEX_IMAGEGEN_AGENT_MODEL || 'gpt-5.5',
    CODEX_IMAGEGEN_AGENT_EFFORT: process.env.CODEX_IMAGEGEN_AGENT_EFFORT || 'high',
    STORYBOARD_LOCAL_HISTORY_WRITE: process.env.STORYBOARD_LOCAL_HISTORY_WRITE,
  };
}

function getBrowserOpenAIApiKeyFromRequest(request: NextRequest) {
  return normalizeStoryboardBrowserOpenAIApiKey(
    request.headers.get(STORYBOARD_BROWSER_OPENAI_API_KEY_HEADER),
  );
}

function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json({ error, detail }, { status, headers: noStoreHeaders });
}

function normalizeRouteError(error: unknown) {
  if (error instanceof StoryboardImageGenerationError) {
    return jsonError(error.code, error.status, error.message);
  }

  console.error('[admin/storyboard/images] unexpected failure:', error);
  return jsonError('storyboard_image_generation_failed', 500, '스토리보드 이미지 생성 요청을 처리하지 못했습니다.');
}

function toStringValue(value: unknown, maxLength: number) {
  return typeof value === 'string' ? sanitizeStoryboardPublicText(value.trim()).slice(0, maxLength) : '';
}

function toNumberValue(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseScene(value: unknown): StoryboardScene {
  if (!value || typeof value !== 'object') {
    throw new StoryboardImageGenerationError('invalid_payload', 'scenes 배열에는 스토리보드 컷 객체만 넣을 수 있습니다.', 400);
  }
  const scene = value as Record<string, unknown>;
  const heatmapEvidence = scene.heatmapEvidence && typeof scene.heatmapEvidence === 'object'
    ? scene.heatmapEvidence as Record<string, unknown>
    : {};

  return {
    sceneNo: Math.max(1, Math.min(99, Math.round(toNumberValue(scene.sceneNo, 1)))),
    title: toStringValue(scene.title, 120) || '스토리보드 컷',
    durationSec: Math.max(1, Math.min(3600, Math.round(toNumberValue(scene.durationSec, 120)))),
    operatorIntent: toStringValue(scene.operatorIntent, 400),
    visualDirection: toStringValue(scene.visualDirection, 500),
    hostBeat: toStringValue(scene.hostBeat, 220),
    captionIdea: toStringValue(scene.captionIdea, 220),
    heatmapEvidence: {
      videoId: toStringValue(heatmapEvidence.videoId, 80),
      youtubeLink: toStringValue(heatmapEvidence.youtubeLink, 220),
      peakTime: toStringValue(heatmapEvidence.peakTime, 20),
      replayScore: Math.max(0, Math.min(1, toNumberValue(heatmapEvidence.replayScore, 0))),
      reason: toStringValue(heatmapEvidence.reason, 300),
    },
    productionChecklist: Array.isArray(scene.productionChecklist)
      ? scene.productionChecklist
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 6)
        .map((item) => item.slice(0, 160))
      : [],
  };
}

function parseRequest(value: unknown): StoryboardGenerateRequest {
  const request = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const tone = toStringValue(request.tone, 40);
  return {
    prompt: toStringValue(request.prompt, 400) || '쯔양 먹방 하이라이트 기반 스토리보드 이미지',
    tone: storyboardTones.has(tone as StoryboardTone) ? tone as StoryboardTone : 'warm',
    targetLengthMinutes: Math.max(6, Math.min(60, Math.round(toNumberValue(request.targetLengthMinutes, 18)))),
    sourceLimit: Math.max(10, Math.min(250, Math.round(toNumberValue(request.sourceLimit, 40)))),
    segmentCount: Math.max(
      STORYBOARD_CHAT_MIN_SEGMENT_COUNT,
      Math.min(
        STORYBOARD_MAX_SEGMENT_COUNT,
        Math.round(toNumberValue(request.segmentCount, STORYBOARD_CHAT_MIN_SEGMENT_COUNT)),
      ),
    ),
    includeProductionNotes: request.includeProductionNotes !== false,
    generationMode: request.generationMode === 'local_heatmap' ? 'local_heatmap' : 'backend_agent',
  };
}

function parsePayload(value: unknown) {
  if (!value || typeof value !== 'object') {
    throw new StoryboardImageGenerationError('invalid_payload', 'JSON body가 필요합니다.', 400);
  }
  const payload = value as Record<string, unknown>;
  const rawScenes = payload.scenes;
  if (!Array.isArray(rawScenes) || rawScenes.length === 0) {
    throw new StoryboardImageGenerationError('invalid_payload', 'scenes 배열이 필요합니다.', 400);
  }
  if (rawScenes.length > STORYBOARD_IMAGE_GENERATION_BATCH_SIZE) {
    throw new StoryboardImageGenerationError(
      'invalid_payload',
      `한 번에 최대 ${STORYBOARD_IMAGE_GENERATION_BATCH_SIZE}컷까지만 생성할 수 있습니다.`,
      400,
    );
  }

  return {
    title: toStringValue(payload.title, 140) || '스토리보드',
    logline: toStringValue(payload.logline, 240),
    request: parseRequest(payload.request),
    scenes: rawScenes.map(parseScene),
    sourceResult: parseSourceResult(payload.sourceResult),
  };
}

function parseSourceResult(value: unknown): StoryboardGenerationResult | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<StoryboardGenerationResult>;
  if (!candidate.storyboard || typeof candidate.storyboard !== 'object') return null;
  if (!Array.isArray(candidate.storyboard.scenes)) return null;
  if (!candidate.request || typeof candidate.request !== 'object') return null;
  if (!candidate.sourceSummary || typeof candidate.sourceSummary !== 'object') return null;
  if (!candidate.ahp || typeof candidate.ahp !== 'object') return null;
  if (!candidate.backendAnalysis || typeof candidate.backendAnalysis !== 'object') return null;

  return candidate as StoryboardGenerationResult;
}

function createPersistableImageResult(
  sourceResult: StoryboardGenerationResult | null,
  images: Awaited<ReturnType<typeof generateStoryboardSceneImages>>,
): StoryboardGenerationResult | null {
  if (!sourceResult) return null;

  const imageMap = new Map(images.map(({ sceneNo, image }) => [sceneNo, image]));
  return {
    ...sourceResult,
    generatedAt: new Date().toISOString(),
    storyboard: {
      ...sourceResult.storyboard,
      scenes: sourceResult.storyboard.scenes.map((scene) => {
        const generatedImage = imageMap.get(scene.sceneNo);
        return generatedImage ? { ...scene, generatedImage } : scene;
      }),
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;
    const browserOpenAIApiKey = getBrowserOpenAIApiKeyFromRequest(request);

    return NextResponse.json(
      {
        provider: getStoryboardImageProviderAvailability(process.env, {
          browserOpenAIApiKey,
        }),
        limits: {
          maxScenesPerRequest: 4,
          target: { width: 1280, height: 720, aspectRatio: '16:9' },
        },
        configuration: {
          localCodexCommand: 'STORYBOARD_LOCAL_CODEX_COMMAND 또는 scripts/codex-imagegen-storyboard-provider.py',
          localCodexModel: 'STORYBOARD_LOCAL_CODEX_IMAGE_MODEL',
          localCodexProof: 'STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE 또는 npm run storyboard:image-proof',
          browserOpenAIApiKey: '브라우저 localStorage에만 저장하고 요청 헤더로만 임시 전달',
          browserKeyStorage: 'browser_local_storage_only',
          browserApiKeyHeader: STORYBOARD_BROWSER_OPENAI_API_KEY_HEADER,
          browserImageTransport: 'data_url_response_no_server_file_write',
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

    const body = await request.json().catch(() => null);
    const payload = parsePayload(body);
    const imageRouteEnv = getStoryboardImageRouteEnv();
    const browserOpenAIApiKey = getBrowserOpenAIApiKeyFromRequest(request);
    const images = await generateStoryboardSceneImages(
      payload.scenes,
      {
        title: payload.title,
        logline: payload.logline,
        request: payload.request,
      },
      imageRouteEnv,
      { browserOpenAIApiKey },
    );
    const historyResult = createPersistableImageResult(payload.sourceResult, images);
    const history = historyResult
      ? await persistLocalStoryboardHistory(historyResult, imageRouteEnv).catch((historyError) => {
        console.error('[admin/storyboard/images] local history persistence failed:', historyError);
        return { persisted: false as const, reason: 'storyboard_image_history_persist_failed' as const };
      })
      : { persisted: false as const, reason: 'missing_source_result' as const };

    return NextResponse.json(
      {
        provider: getStoryboardImageProviderAvailability(imageRouteEnv, {
          browserOpenAIApiKey,
        }),
        images,
        history,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return normalizeRouteError(error);
  }
}
