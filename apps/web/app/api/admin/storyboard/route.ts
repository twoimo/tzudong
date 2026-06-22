import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';

type StoryboardRouteContext = {
  params?: never;
};
function shouldSkipLocalStoryboardBackendAgentOnVercel() {
  return (
    process.env.VERCEL === '1' &&
    !process.env.STORYBOARD_AGENT_COMMAND?.trim() &&
    !process.env.STORYBOARD_AGENT_ROOT?.trim()
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

async function generateLocalStoryboardForRoute(body: Record<string, unknown> | null) {
  const { generateLocalStoryboard } = await import('@/lib/admin/storyboard/generator');
  return generateLocalStoryboard(body);
}

async function generateStoryboardWithRouteBackendAgent(body: Record<string, unknown> | null) {
  if (shouldSkipLocalStoryboardBackendAgentOnVercel()) {
    throw new Error('Vercel production does not include the local storyboard backend agent. Use local heatmap generation or configure STORYBOARD_AGENT_COMMAND.');
  }

  const { generateStoryboardWithBackendAgent } = await import('@/lib/admin/storyboard/backend-agent');
  return generateStoryboardWithBackendAgent(body);
}

export async function GET(_request: NextRequest, _context: StoryboardRouteContext) {
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
    return NextResponse.json(
      {
        mode,
        heatmapDirectory,
        scannedFiles,
        usableSources: usableSources.length,
        previewSources: selectedSources.slice(0, 8),
        isFallbackData,
        fallbackReason,
        dataModeLabel,
        backendAgent: await getPublicStoryboardBackendAgentStatus(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[admin/storyboard] failed to read heatmap status:', error);
    return NextResponse.json({ error: '스토리보드 히트맵 상태를 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const result = body?.generationMode === 'backend_agent'
      ? await generateStoryboardWithRouteBackendAgent(body)
      : await generateLocalStoryboardForRoute(body);
    if (process.env.VERCEL !== '1') {
      await (await import('@/lib/admin/storyboard/history'))
        .persistLocalStoryboardHistory(result)
        .catch((historyError) => {
          console.error('[admin/storyboard] local history persistence failed:', historyError);
        });
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[admin/storyboard] generation failed:', error);
    return NextResponse.json({ error: '스토리보드를 생성하지 못했습니다.' }, { status: 500 });
  }
}
