import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
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
import { buildStoryboardJobInsert, sanitizeStoryboardJobRow, type StoryboardJobRow } from '@/lib/admin/storyboard/jobs';

export const runtime = 'nodejs';

type StoryboardRouteContext = {
  params?: never;
};

const STORYBOARD_JOB_SELECT = 'id, requested_by_admin_id, status, stage, request_payload, result_payload, error_code, readiness, claimed_by, claimed_at, completed_at, cancelled_at, created_at, updated_at';
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



export async function GET(_request: NextRequest, _context: StoryboardRouteContext) {
  const telemetry = createStoryboardRouteTelemetry('admin-storyboard-status');
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) {
      auth.response.headers.set('Cache-Control', 'no-store');
      return auth.response;
    }

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
    if (!auth.ok) {
      auth.response.headers.set('Cache-Control', 'no-store');
      return auth.response;
    }

    const body = await readStoryboardRouteJson(request, telemetry) as Record<string, unknown> | null;
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from('admin_storyboard_jobs')
      .insert(buildStoryboardJobInsert({ requestedByAdminId: auth.userId, request: body }))
      .select(STORYBOARD_JOB_SELECT)
      .single();
    if (error || !data) {
      const failurePayload = { ok: false, error: 'storyboard_job_enqueue_failed' };
      return NextResponse.json(
        failurePayload,
        {
          status: 502,
          headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, failurePayload),
        },
      );
    }
    const job = sanitizeStoryboardJobRow(data as StoryboardJobRow);
    const payload = {
      ok: true,
      mode: 'async_job_control_plane',
      job,
      readiness: job.readiness,
      message: '스토리보드 생성은 비동기 작업으로 등록되었습니다. 워커 상태를 확인하며 완료 전에는 성공처럼 표시하지 않습니다.',
    };
    return NextResponse.json(
      payload,
      {
        status: 202,
        headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, payload),
      },
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
