import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { generateStoryboardWithBackendAgent, getStoryboardBackendAgentStatus } from '@/lib/admin/storyboard/backend-agent';
import { generateLocalStoryboard, loadStoryboardHeatmapSources } from '@/lib/admin/storyboard/generator';
import { persistLocalStoryboardHistory } from '@/lib/admin/storyboard/history';

export const runtime = 'nodejs';

type StoryboardRouteContext = {
  params?: never;
};

export async function GET(_request: NextRequest, _context: StoryboardRouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const {
      mode,
      heatmapDirectory,
      scannedFiles,
      usableSources,
      selectedSources,
      isFallbackData,
      fallbackReason,
      dataModeLabel,
    } = loadStoryboardHeatmapSources(40);
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
        backendAgent: getStoryboardBackendAgentStatus(),
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
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const result = body?.generationMode === 'backend_agent'
      ? await generateStoryboardWithBackendAgent(body)
      : generateLocalStoryboard(body);
    await persistLocalStoryboardHistory(result).catch((historyError) => {
      console.error('[admin/storyboard] local history persistence failed:', historyError);
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[admin/storyboard] generation failed:', error);
    return NextResponse.json({ error: '스토리보드를 생성하지 못했습니다.' }, { status: 500 });
  }
}
