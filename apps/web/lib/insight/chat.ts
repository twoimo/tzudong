import type { AdminInsightChatBootstrapResponse, AdminInsightChatResponse, InsightChatSource } from '@/types/insight';
import { getDashboardSummary } from '@/lib/dashboard/summary';
import { getDashboardFunnel, getDashboardFailures } from '@/lib/dashboard/evaluation';
import { getDashboardQuality } from '@/lib/dashboard/quality';
import { getAdminInsightHeatmap } from '@/lib/insight/heatmap';
import { getAdminInsightSeason } from '@/lib/insight/season';
import { getAdminInsightWordcloud } from '@/lib/insight/wordcloud';

function includesAny(message: string, words: string[]): boolean {
  return words.some((word) => message.includes(word));
}

const STORYBOARD_AGENT_API_URL = process.env.STORYBOARD_AGENT_API_URL?.trim();
const STORYBOARD_AGENT_PATH = process.env.STORYBOARD_AGENT_CHAT_PATH?.trim() || '/chat';
const STORYBOARD_AGENT_TIMEOUT_MS = Number(process.env.STORYBOARD_AGENT_TIMEOUT_MS || '8000');
const STORYBOARD_AGENT_MAX_RETRIES = Number(process.env.STORYBOARD_AGENT_MAX_RETRIES || '2');
const STORYBOARD_AGENT_RETRY_BASE_MS = Number(process.env.STORYBOARD_AGENT_RETRY_BASE_MS || '250');
const STORYBOARD_AGENT_RETRY_MAX_MS = Number(process.env.STORYBOARD_AGENT_RETRY_MAX_MS || '1500');

const STORYBOARD_KEYWORDS = [
  '스토리보드',
  '촬영',
  '기획안',
  '연출',
  '샷',
  '씬',
  '콘티',
  '촬영안',
  '콘텐츠 기획',
  '영상 기획',
  '콘텐츠 제작',
  '쇼츠 기획',
  '썸네일',
  '컷',
  'storyboard',
  'shot',
  'plot',
  'script',
  '촬영 구성',
  '쇼츠',
  '편집',
  '대본',
];

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function createLocalResponse(
  asOf: string,
  content: string,
  options: {
    fallbackReason?: string;
    sources?: InsightChatSource[];
    visualComponent?: AdminInsightChatResponse['visualComponent'];
  } = {},
): AdminInsightChatResponse {
  return {
    asOf,
    content,
    sources: options.sources ?? [],
    visualComponent: options.visualComponent,
    meta: {
      source: 'local',
      fallbackReason: options.fallbackReason,
    },
  };
}

function clampPositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function safeMathMax(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function isRetryableFetchError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  return error instanceof TypeError;
}

function calcBackoffDelay(attempt: number): number {
  const base = clampPositiveInteger(STORYBOARD_AGENT_RETRY_BASE_MS, 250);
  const maxDelay = clampPositiveInteger(STORYBOARD_AGENT_RETRY_MAX_MS, 1500);
  const delay = Math.min(maxDelay, base * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(120, Math.max(20, delay * 0.15)));
  return Math.min(maxDelay, delay + jitter);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getStoryboardAgentEndpoint(): string | null {
  if (!STORYBOARD_AGENT_API_URL) {
    return null;
  }

  const base = STORYBOARD_AGENT_API_URL.replace(/\/$/, '');
  const hasSlash = STORYBOARD_AGENT_PATH.startsWith('/');
  return `${base}${hasSlash ? STORYBOARD_AGENT_PATH : `/${STORYBOARD_AGENT_PATH}`}`;
}

function extractStoryboardContent(payload: unknown): string | null {
  const candidates = [] as Array<unknown>;

  if (payload && typeof payload === 'object') {
    const raw = payload as Record<string, unknown>;
    candidates.push(raw.content, raw.answer, raw.reply, raw.response, raw.output, raw.message, raw.result);
    if (typeof raw.data === 'object' && raw.data !== null) {
      candidates.push((raw.data as Record<string, unknown>).content);
      candidates.push((raw.data as Record<string, unknown>).answer);
      candidates.push((raw.data as Record<string, unknown>).response);
      candidates.push((raw.data as Record<string, unknown>).message);
      candidates.push((raw.data as Record<string, unknown>).output);
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function toStoryboardSources(payload: unknown): InsightChatSource[] {
  const items: unknown[] = [];

  if (payload && typeof payload === 'object') {
    const raw = payload as Record<string, unknown>;
    if (Array.isArray(raw.sources)) {
      items.push(...raw.sources);
    }
    if (raw.data && typeof raw.data === 'object' && Array.isArray((raw.data as Record<string, unknown>).sources)) {
      items.push(...((raw.data as Record<string, unknown>).sources as unknown[]));
    }
    if (raw.result && typeof raw.result === 'object' && Array.isArray((raw.result as Record<string, unknown>).sources)) {
      items.push(...((raw.result as Record<string, unknown>).sources as unknown[]));
    }
  }

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const source = item as Record<string, unknown>;
      const videoTitle =
        typeof source.videoTitle === 'string'
          ? source.videoTitle
          : typeof source.video_title === 'string'
            ? source.video_title
            : typeof source.title === 'string'
              ? source.title
              : '';

      const youtubeLink =
        typeof source.youtubeLink === 'string'
          ? source.youtubeLink
          : typeof source.youtube_url === 'string'
            ? source.youtube_url
            : typeof source.url === 'string'
              ? source.url
              : '';

      const timestamp =
        typeof source.timestamp === 'string'
          ? source.timestamp
          : typeof source.time === 'string'
            ? source.time
            : typeof source.timestamp_text === 'string'
              ? source.timestamp_text
              : '';

      const text =
        typeof source.text === 'string'
          ? source.text
          : typeof source.content === 'string'
            ? source.content
            : typeof source.snippet === 'string'
              ? source.snippet
              : typeof source.summary === 'string'
                ? source.summary
                : '';

      if (!videoTitle && !youtubeLink && !timestamp && !text) {
        return null;
      }

      return {
        videoTitle: videoTitle || '스토리보드 참고 소스',
        youtubeLink,
        timestamp: timestamp || '-',
        text,
      };
    })
    .filter((value): value is InsightChatSource => value !== null);
}

function isStoryboardIntent(message: string): boolean {
  return includesAny(message, STORYBOARD_KEYWORDS);
}

async function askStoryboardAgent(message: string, asOf: string): Promise<AdminInsightChatResponse | null> {
  const endpoint = getStoryboardAgentEndpoint();
  if (!endpoint) return null;

  const timeoutMs = Number.isFinite(STORYBOARD_AGENT_TIMEOUT_MS) && STORYBOARD_AGENT_TIMEOUT_MS > 0
    ? STORYBOARD_AGENT_TIMEOUT_MS
    : 8000;
  const maxRetries = clampPositiveInteger(STORYBOARD_AGENT_MAX_RETRIES, 2);
  const payload = JSON.stringify({
    message,
    role: 'admin_insight',
    channel: 'admin_insight_chat',
  });
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: payload,
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!response.ok) {
        if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxRetries) {
          const retryAfterHeader = response.headers.get('retry-after');
          const retryAfter = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? safeMathMax(retryAfter, 20)
            : calcBackoffDelay(attempt);
          await sleep(delay);
          continue;
        }

        const data = await response.json().catch(() => null);
        console.error('[admin/insight/chat] storyboard agent HTTP error:', response.status, data);
        return null;
      }

      const data = await response.json().catch(() => null);
      const content = extractStoryboardContent(data);
      if (!content) {
        return null;
      }

      return {
        asOf,
        content,
        sources: toStoryboardSources(data),
        meta: {
          source: 'agent',
        },
      };
    } catch (error) {
      if (attempt < maxRetries && isRetryableFetchError(error)) {
        await sleep(calcBackoffDelay(attempt));
        continue;
      }

      console.error('[admin/insight/chat] storyboard agent request failed:', error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
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
    '',
    `- 맛집: **${summary.totals.restaurants.toLocaleString()}개**`,
    `- 영상: **${summary.totals.videos.toLocaleString()}개**`,
    `- 좌표 보유: **${summary.totals.withCoordinates.toLocaleString()}개**`,
    '',
    `**TOP 영상(맛집 언급 기준)**`,
    topVideos || '- 데이터 없음',
    '',
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
    return createLocalResponse(asOf, '질문을 입력해 주세요.', {
      fallbackReason: 'empty_input',
    });
  }

  if (isStoryboardIntent(input)) {
    const storyboardReply = await askStoryboardAgent(input, asOf);
    if (storyboardReply) return storyboardReply;
  }

  if (includesAny(input, ['키워드', '워드', 'word', 'wordcloud', '인기'])) {
    const data = await getAdminInsightWordcloud(false);
    const list = data.keywords.slice(0, 12)
      .map((k, idx) => `${idx + 1}. **${k.keyword}** (${k.count})`)
      .join('\n');

    return createLocalResponse(asOf, `## 인기 키워드 TOP 12\n\n${list || '- 데이터 없음'}`, {
      visualComponent: 'wordcloud',
    });
  }

  if (includesAny(input, ['시즌', '캘린더', 'calendar', '이번달', '다음달', '월별'])) {
    const data = await getAdminInsightSeason(false);
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const monthData = data.months.find((m) => m.month === month);
    const list = monthData?.keywords?.slice(0, 6).map((k) =>
      `- ${k.icon} **${k.keyword}** (피크: ${k.peakWeek}, 업로드 추천: ${k.recommendedUploadDate})`
    ).join('\n');

    return createLocalResponse(asOf, `## ${month}월 시즌 키워드\n\n${list || '- 데이터 없음'}`, {
      visualComponent: 'calendar',
    });
  }

  if (includesAny(input, ['히트맵', 'heatmap', '리텐션', '하이라이트', 'peak'])) {
    const data = await getAdminInsightHeatmap(false);
    const top = data.videos[0];
    if (!top) {
      return createLocalResponse(asOf, '히트맵 데이터를 찾지 못했습니다.', {
        fallbackReason: 'empty_heatmap',
      });
    }

    return createLocalResponse(asOf, [
      `## 히트맵 요약`,
      '',
      `- 영상: **${top.title}**`,
      `- 피크 구간: **${top.peakSegment.start}%~${top.peakSegment.end}%**`,
      `- 주요 키워드: ${top.analysis.keywords.slice(0, 6).join(', ') || '-'}`,
      '',
      top.analysis.overallSummary,
    ].join('\n'), {
      visualComponent: 'heatmap',
    });
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

    return createLocalResponse(asOf, [
      `## 운영 지표 요약`,
      '',
      `- 수집 영상: **${funnel.counts.crawling}**`,
      `- 선택 영상: **${funnel.counts.selection}** (선택률 ${funnel.conversion.selectionRate ?? '-'}%)`,
      `- Rule 적용: **${funnel.counts.rule}** (Rule율 ${funnel.conversion.ruleRate ?? '-'}%)`,
      `- LAAJ 적용: **${funnel.counts.laaj}** (LAAJ율 ${funnel.conversion.laajRate ?? '-'}%)`,
      '',
      `### Not-Selection 주요 사유 TOP 5`,
      topNotSelections || '- 데이터 없음',
      '',
      `### 품질(요약)`,
      `- pipeline rows: ${quality.totals.pipelineRows}`,
      `- rule metrics: ${quality.totals.withRuleMetrics}`,
      `- laaj metrics: ${quality.totals.withLaajMetrics}`,
    ].join('\n'), {
      visualComponent: 'stats',
    });
  }

  return createLocalResponse(asOf, [
    `가능한 질문 예시:`,
    `- "인기 키워드 보여줘"`,
    `- "이번달 시즌 키워드 추천해줘"`,
    `- "히트맵 요약해줘"`,
    `- "운영 지표 요약"`,
    `- "먹방 스토리보드 기획안 만들어줘"`,
  ].join('\n'));
}
