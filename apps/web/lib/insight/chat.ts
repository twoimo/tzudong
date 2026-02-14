import type { AdminInsightChatBootstrapResponse, AdminInsightChatResponse } from '@/types/insight';
import { getDashboardSummary } from '@/lib/dashboard/summary';
import { getDashboardFunnel, getDashboardFailures } from '@/lib/dashboard/evaluation';
import { getDashboardQuality } from '@/lib/dashboard/quality';
import { getAdminInsightHeatmap } from '@/lib/insight/heatmap';
import { getAdminInsightSeason } from '@/lib/insight/season';
import { getAdminInsightWordcloud } from '@/lib/insight/wordcloud';

function includesAny(message: string, words: string[]): boolean {
  return words.some((word) => message.includes(word));
}

export async function getAdminInsightChatBootstrap(): Promise<AdminInsightChatBootstrapResponse> {
  const asOf = new Date().toISOString();

  const [summary, keywords] = await Promise.all([
    getDashboardSummary(false),
    getAdminInsightWordcloud(false),
  ]);

  const topKeywords = keywords.keywords.slice(0, 8).map((k) => k.keyword).join(', ');
  const topVideos = summary.videos.slice(0, 3).map((v, idx) => `${idx + 1}. ${v.title}`).join('\n');

  const content = [
    `**쯔양 데이터 종합 인사이트** (DB 기준)`,
    ``,
    `- 맛집: **${summary.totals.restaurants.toLocaleString()}개**`,
    `- 영상: **${summary.totals.videos.toLocaleString()}개**`,
    `- 좌표 보유: **${summary.totals.withCoordinates.toLocaleString()}개**`,
    ``,
    `**TOP 영상(맛집 언급 기준)**`,
    topVideos || '- 데이터 없음',
    ``,
    `**TOP 키워드(자막 하이라이트 기준)**`,
    topKeywords ? `- ${topKeywords}` : '- 데이터 없음',
  ].join('\n');

  return {
    asOf,
    message: {
      content,
      visualComponent: topKeywords ? 'wordcloud' : undefined,
      sources: [],
    },
  };
}

export async function answerAdminInsightChat(message: string): Promise<AdminInsightChatResponse> {
  const asOf = new Date().toISOString();
  const input = message.trim();

  if (!input) {
    return { asOf, content: '질문을 입력해 주세요.', sources: [] };
  }

  if (includesAny(input, ['키워드', '워드', 'word', 'wordcloud', '인기'])) {
    const data = await getAdminInsightWordcloud(false);
    const list = data.keywords.slice(0, 12)
      .map((k, idx) => `${idx + 1}. **${k.keyword}** (${k.count})`)
      .join('\n');

    return {
      asOf,
      content: `## 인기 키워드 TOP 12\n\n${list || '- 데이터 없음'}`,
      visualComponent: 'wordcloud',
      sources: [],
    };
  }

  if (includesAny(input, ['시즌', '캘린더', 'calendar', '이번달', '다음달', '월별'])) {
    const data = await getAdminInsightSeason(false);
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const monthData = data.months.find((m) => m.month === month);
    const list = monthData?.keywords?.slice(0, 6).map((k) =>
      `- ${k.icon} **${k.keyword}** (피크: ${k.peakWeek}, 업로드 추천: ${k.recommendedUploadDate})`
    ).join('\n');

    return {
      asOf,
      content: `## ${month}월 시즌 키워드\n\n${list || '- 데이터 없음'}`,
      visualComponent: 'calendar',
      sources: [],
    };
  }

  if (includesAny(input, ['히트맵', 'heatmap', '리텐션', '하이라이트', 'peak'])) {
    const data = await getAdminInsightHeatmap(false);
    const top = data.videos[0];
    if (!top) {
      return { asOf, content: '히트맵 데이터를 찾지 못했습니다.', sources: [] };
    }

    return {
      asOf,
      content: [
        `## 히트맵 요약`,
        ``,
        `- 영상: **${top.title}**`,
        `- 피크 구간: **${top.peakSegment.start}%~${top.peakSegment.end}%**`,
        `- 주요 키워드: ${top.analysis.keywords.slice(0, 6).join(', ') || '-'}`,
        ``,
        top.analysis.overallSummary,
      ].join('\n'),
      visualComponent: 'heatmap',
      sources: [],
    };
  }

  if (includesAny(input, ['운영', 'funnel', '실패', 'fail', '품질', 'quality', '지표'])) {
    const [funnel, failures, quality] = await Promise.all([
      getDashboardFunnel(false),
      getDashboardFailures(false),
      getDashboardQuality(false),
    ]);

    const topNotSelections = failures.notSelectionReasons.slice(0, 5)
      .map((r) => `- ${r.label}: ${r.count}`)
      .join('\n');

    return {
      asOf,
      content: [
        `## 운영 지표 요약`,
        ``,
        `- 수집 영상: **${funnel.counts.crawling}**`,
        `- 선택 영상: **${funnel.counts.selection}** (선택률 ${funnel.conversion.selectionRate ?? '-'}%)`,
        `- Rule 적용: **${funnel.counts.rule}** (Rule율 ${funnel.conversion.ruleRate ?? '-'}%)`,
        `- LAAJ 적용: **${funnel.counts.laaj}** (LAAJ율 ${funnel.conversion.laajRate ?? '-'}%)`,
        ``,
        `### Not-Selection 주요 사유 TOP 5`,
        topNotSelections || '- 데이터 없음',
        ``,
        `### 품질(요약)`,
        `- pipeline rows: ${quality.totals.pipelineRows}`,
        `- rule metrics: ${quality.totals.withRuleMetrics}`,
        `- laaj metrics: ${quality.totals.withLaajMetrics}`,
      ].join('\n'),
      visualComponent: 'stats',
      sources: [],
    };
  }

  return {
    asOf,
    content: [
      `가능한 질문 예시:`,
      `- "인기 키워드 보여줘"`,
      `- "이번달 시즌 키워드 추천해줘"`,
      `- "히트맵 요약해줘"`,
      `- "운영 지표 요약"`,
    ].join('\n'),
    sources: [],
  };
}

