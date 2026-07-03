import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { buildStoryboardRagErrorStatus } from '@/lib/admin/storyboard/rag-error-status';
import {
  buildStoryboardRouteFreshness,
  buildStoryboardRouteHeaders,
  createStoryboardRouteTelemetry,
  readStoryboardRouteJson,
  STORYBOARD_ROUTE_NO_STORE_HEADERS,
  STORYBOARD_ROUTE_STATUS_CACHE_CONTROL,
  STORYBOARD_ROUTE_STATUS_CACHE_SECONDS,
  STORYBOARD_ROUTE_STATUS_STALE_SECONDS,
} from '@/lib/admin/storyboard/route-telemetry';

export const runtime = 'nodejs';

type StoryboardRouteContext = {
  params?: never;
};
function hasRequiredStoryboardRagWorkerUrl() {
  return Boolean(process.env.STORYBOARD_RAG_WORKER_URL?.trim());
}

function shouldSkipLocalStoryboardBackendAgentOnVercel() {
  return (
    process.env.VERCEL === '1' &&
    (
      !process.env.STORYBOARD_AGENT_COMMAND?.trim() ||
      !process.env.STORYBOARD_AGENT_ROOT?.trim() ||
      !hasRequiredStoryboardRagWorkerUrl()
    )
  );
}

function buildUnavailableStoryboardBackendAgentStatus() {
  return {
    available: false,
    mode: 'local_adapter' as const,
    rootPath: '',
    notebooks: [],
    graphEntrypoint: null,
    commandConfigured: false,
    commandAvailable: false,
    commandRejectionReason: 'vercel_local_storyboard_backend_agent_unavailable',
    localAdapterAvailable: false,
    missingPythonModules: [],
    runtime: 'unavailable',
    codexModel: process.env.STORYBOARD_AGENT_CODEX_MODEL?.trim() || 'gpt-5.5',
    codexEffort: process.env.STORYBOARD_AGENT_CODEX_EFFORT?.trim() || 'low',
    streamingAvailable: false,
  };
}

async function getPublicStoryboardBackendAgentStatus() {
  if (shouldSkipLocalStoryboardBackendAgentOnVercel()) {
    return buildUnavailableStoryboardBackendAgentStatus();
  }

  const { getStoryboardBackendAgentStatus } = await import('@/lib/admin/storyboard/backend-agent');
  return getStoryboardBackendAgentStatus();
}

async function readLocalStoryboardHeatmapStatus(limit: number) {
  const { loadStoryboardHeatmapSources } = await import('@/lib/admin/storyboard/generator');
  return loadStoryboardHeatmapSources(limit);
}


async function generateStoryboardWithRouteBackendAgent(body: Record<string, unknown> | null) {
  if (shouldSkipLocalStoryboardBackendAgentOnVercel()) {
    throw new Error('Vercel production does not include the required storyboard RAG worker. Configure STORYBOARD_AGENT_COMMAND and STORYBOARD_RAG_WORKER_URL.');
  }

  const { generateStoryboardWithBackendAgent } = await import('@/lib/admin/storyboard/backend-agent');
  return generateStoryboardWithBackendAgent(body);
}

export async function GET(_request: NextRequest, _context: StoryboardRouteContext) {
  const telemetry = createStoryboardRouteTelemetry('admin-storyboard-status');
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;

    // source-contract: } = loadStoryboardHeatmapSources(40);
    const {
      mode,
      heatmapDirectory,
      scannedFiles,
      usableSources,
      selectedSources,
      isFallbackData,
      fallbackReason,
      dataModeLabel,
    } = await readLocalStoryboardHeatmapStatus(40);
    const freshness = buildStoryboardRouteFreshness('storyboard_status', {
      cacheControl: STORYBOARD_ROUTE_STATUS_CACHE_CONTROL,
      maxAgeSeconds: STORYBOARD_ROUTE_STATUS_CACHE_SECONDS,
      staleWhileRevalidateSeconds: STORYBOARD_ROUTE_STATUS_STALE_SECONDS,
    });
    const payload = {
      mode,
      heatmapDirectory,
      scannedFiles,
      usableSources: usableSources.length,
      previewSources: selectedSources.slice(0, 8),
      isFallbackData,
      fallbackReason,
      dataModeLabel,
      freshness,
      backendAgent: await getPublicStoryboardBackendAgentStatus(),
    };
    return NextResponse.json(
      payload,
      {
        headers: buildStoryboardRouteHeaders(
          telemetry,
          {
            'Cache-Control': STORYBOARD_ROUTE_STATUS_CACHE_CONTROL,
            Vary: 'Cookie, Authorization',
          },
          payload,
        ),
      }
    );
  } catch (error) {
    console.error('[admin/storyboard] failed to read heatmap status:', error);
    const payload = { error: '스토리보드 히트맵 상태를 불러오지 못했습니다.' };
    return NextResponse.json(
      payload,
      {
        status: 500,
        headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, payload),
      },
    );
  }
}

export async function POST(request: NextRequest) {
  const telemetry = createStoryboardRouteTelemetry('admin-storyboard-generate');

  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;

    if (shouldSkipLocalStoryboardBackendAgentOnVercel()) {
      const payload = {
        error: 'storyboard_generation_unavailable',
        causeCode: 'vercel_local_storyboard_backend_agent_unavailable',
        stage: 'backend-agent',
        stageLabel: '스토리보드 생성 백엔드',
        message: 'Vercel production does not include the required storyboard RAG worker. Configure STORYBOARD_AGENT_COMMAND and STORYBOARD_RAG_WORKER_URL.',
        nextActions: [
          'STORYBOARD_AGENT_COMMAND, STORYBOARD_AGENT_ROOT, STORYBOARD_RAG_WORKER_URL 환경 변수를 확인해 주세요.',
          '로컬 helper 또는 API Key 백업 경로가 준비되기 전에는 생성 성공처럼 처리하지 않습니다.',
        ],
        trace: [],
      };
      return NextResponse.json(
        payload,
        {
          status: 503,
          headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, payload),
        },
      );
    }

    const body = await readStoryboardRouteJson(request, telemetry) as Record<string, unknown> | null;
    const result = await generateStoryboardWithRouteBackendAgent(body);
    if (process.env.VERCEL !== '1') {
      await (await import('@/lib/admin/storyboard/history'))
        .persistLocalStoryboardHistory(result)
        .catch((historyError) => {
          console.error('[admin/storyboard] local history persistence failed:', historyError);
        });
    }
    return NextResponse.json(
      result,
      { headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, result) },
    );
  } catch (error) {
    console.error('[admin/storyboard] generation failed:', error);
    const failure = buildStoryboardRagErrorStatus(error, {
      fallbackCauseCode: 'storyboard_generation_failed',
    });
    const payload = {
      error: 'storyboard_generation_failed',
      causeCode: failure.causeCode,
      stage: failure.stage,
      stageLabel: failure.stageLabel,
      message: failure.message,
      nextActions: failure.nextActions,
      trace: failure.trace,
    };
    return NextResponse.json(
      payload,
      {
        status: 500,
        headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, payload),
      },
    );
  }
}
