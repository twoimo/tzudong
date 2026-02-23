import type {
  AdminInsightChatBootstrapResponse,
  AdminInsightChatResponse,
  InsightChatSource,
  LlmRequestConfig,
  StoryboardModelProfile,
} from '@/types/insight';
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
const STORYBOARD_AGENT_UNAVAILABLE_COOLDOWN_MS = Number(process.env.STORYBOARD_AGENT_UNAVAILABLE_COOLDOWN_MS || '30000');
const STORYBOARD_AGENT_ENABLED = process.env.STORYBOARD_AGENT_ENABLED !== 'false';
const INSIGHT_QUERY_TTL_MS = Number(process.env.INSIGHT_QUERY_CACHE_TTL_MS || '45000');

const GEMINI_API_KEY_ENV = process.env.GEMINI_OCR_YEON?.trim() || '';
const GEMINI_MODEL_DEFAULT = 'gemini-3-flash-preview';
const DEFAULT_STORYBOARD_MODEL_PROFILE: StoryboardModelProfile = 'nanobanana';
const DEFAULT_IMAGE_MODEL_PROFILE: StoryboardModelProfile = 'nanobanana';
const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_TOKENS = 4096;

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
const RETRYABLE_FETCH_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);
const RETRYABLE_FETCH_ERROR_MESSAGES = [
  /fetch failed/i,
  /connect (econnrefused|econnreset|etimedout|econnaborted|unknown)|connect timeout/i,
  /network/i,
];

type CachedQueryEntry<T> = {
  data: T;
  expiresAt: number;
};

const cacheTtl = Number.isFinite(INSIGHT_QUERY_TTL_MS) && INSIGHT_QUERY_TTL_MS > 0
  ? INSIGHT_QUERY_TTL_MS
  : 45000;
const cacheInFlight = new Map<string, Promise<unknown>>();
const queryCache = new Map<string, CachedQueryEntry<unknown>>();
const storyboardEndpointCooldownByUrl = new Map<string, number>();

function normalizeCacheKey(base: string): string {
  return base.trim().toLowerCase();
}

function withCachedQuery<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const normalizedKey = normalizeCacheKey(key);
  const now = Date.now();
  const cached = queryCache.get(normalizedKey);
  if (cached && cached.expiresAt > now) {
    return Promise.resolve(cached.data as T);
  }

  const inFlight = cacheInFlight.get(normalizedKey);
  if (inFlight) {
    return inFlight as Promise<T>;
  }

  const request = (async () => {
    const value = await loader();
    queryCache.set(normalizedKey, {
      data: value as unknown,
      expiresAt: Date.now() + ttlMs,
    });
    return value;
  })();

  cacheInFlight.set(normalizedKey, request);
  request.finally(() => {
    cacheInFlight.delete(normalizedKey);
  });

  return request;
}

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
  if (!(error instanceof Error)) {
    return false;
  }

  const errorCode = extractFetchErrorCode(error);
  if (errorCode && RETRYABLE_FETCH_ERROR_CODES.has(errorCode.toUpperCase())) {
    return true;
  }

  if (error instanceof TypeError) {
    return true;
  }

  return RETRYABLE_FETCH_ERROR_MESSAGES.some((pattern) => pattern.test(error.message));
}

function extractFetchErrorCode(error: unknown): string | null {
  if (error instanceof TypeError) {
    const typed = error as { code?: string };
    if (typed.code) return typed.code;
  }
  if (error && typeof error === 'object') {
    const typed = error as { code?: string; cause?: { code?: string } };
    if (typed.code) return typed.code;
    if (typed.cause?.code) return typed.cause.code;
  }

  if (error instanceof Error) {
    const cause = error.cause as { code?: string } | undefined;
    if (cause?.code) return cause.code;
  }
  return null;
}

function createStoryboardUnavailableResponse(asOf: string): AdminInsightChatResponse {
  return createLocalResponse(asOf, '스토리보드 에이전트 연결이 일시적으로 불안정합니다. 잠시 뒤 다시 시도해 주세요.', {
    fallbackReason: 'storyboard_agent_unavailable',
  });
}

function getStoryboardEndpointCooldownUntil(endpoint: string): number | null {
  const until = storyboardEndpointCooldownByUrl.get(endpoint);
  if (until === undefined) return null;
  if (until <= Date.now()) {
    storyboardEndpointCooldownByUrl.delete(endpoint);
    return null;
  }
  return until;
}

function setStoryboardEndpointCooldown(endpoint: string): void {
  const cooldown = Number.isFinite(STORYBOARD_AGENT_UNAVAILABLE_COOLDOWN_MS) && STORYBOARD_AGENT_UNAVAILABLE_COOLDOWN_MS > 0
    ? STORYBOARD_AGENT_UNAVAILABLE_COOLDOWN_MS
    : 30000;
  storyboardEndpointCooldownByUrl.set(endpoint, Date.now() + cooldown);
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
  if (!STORYBOARD_AGENT_ENABLED) {
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

async function askStoryboardAgent(
  message: string,
  asOf: string,
  storyboardModelProfile: StoryboardModelProfile = DEFAULT_STORYBOARD_MODEL_PROFILE,
): Promise<AdminInsightChatResponse | null> {
  const normalizedProfile = storyboardModelProfile === 'nanobanana_pro' ? 'nanobanana_pro' : 'nanobanana';

  const endpoint = getStoryboardAgentEndpoint();
  if (!endpoint) return null;
  const cooldownUntil = getStoryboardEndpointCooldownUntil(endpoint);
  if (cooldownUntil) {
    return createStoryboardUnavailableResponse(asOf);
  }

  const timeoutMs = Number.isFinite(STORYBOARD_AGENT_TIMEOUT_MS) && STORYBOARD_AGENT_TIMEOUT_MS > 0
    ? STORYBOARD_AGENT_TIMEOUT_MS
    : 8000;
  const maxRetries = clampPositiveInteger(STORYBOARD_AGENT_MAX_RETRIES, 2);
  const payload = JSON.stringify({
    message,
    storyboardModelProfile: normalizedProfile,
    imageModelProfile: normalizedProfile,
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
        setStoryboardEndpointCooldown(endpoint);
        return createStoryboardUnavailableResponse(asOf);
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
        const errorCode = extractFetchErrorCode(error);
        console.warn('[admin/insight/chat] storyboard agent request retrying:', {
          endpoint,
          attempt,
          maxRetries,
          errorCode,
        });
        await sleep(calcBackoffDelay(attempt));
        continue;
      }

      const errorCode = extractFetchErrorCode(error);
      if (isRetryableFetchError(error)) {
        console.info('[admin/insight/chat] storyboard agent unavailable:', {
          endpoint,
          attempt,
          maxRetries,
          errorCode,
        });
        setStoryboardEndpointCooldown(endpoint);
        return createStoryboardUnavailableResponse(asOf);
      }

      console.error('[admin/insight/chat] storyboard agent request failed:', error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

function resolveStoryboardImageProfile(llmConfig?: LlmRequestConfig): StoryboardModelProfile {
  const requested = llmConfig?.imageModelProfile ?? llmConfig?.storyboardModelProfile;
  return requested === 'nanobanana_pro' ? 'nanobanana_pro' : DEFAULT_IMAGE_MODEL_PROFILE;
}

export async function getAdminInsightChatBootstrap(): Promise<AdminInsightChatBootstrapResponse> {
  const asOf = new Date().toISOString();

  const content = [
    '안녕하세요! 쯔양 인사이트 챗봇입니다.',
    '',
    '궁금한 점을 자유롭게 질문해 주세요.',
    '- "인기 키워드 보여줘"',
    '- "이번달 시즌 키워드 추천해줘"',
    '- "히트맵 요약해줘"',
    '- "운영 지표 요약"',
    '- "먹방 스토리보드 기획안 만들어줘"',
  ].join('\n');

  return {
    asOf,
    message: {
      content,
      sources: [],
    },
  };
}

export async function answerAdminInsightChat(
  message: string,
  llmConfig?: LlmRequestConfig,
): Promise<AdminInsightChatResponse> {
  const asOf = new Date().toISOString();
  const input = message.trim();

  if (!input) {
    return createLocalResponse(asOf, '질문을 입력해 주세요.', {
      fallbackReason: 'empty_input',
    });
  }

  if (isStoryboardIntent(input)) {
    const storyboardProfile = resolveStoryboardImageProfile(llmConfig);
    const storyboardReply = await askStoryboardAgent(input, asOf, storyboardProfile);
    if (storyboardReply) return storyboardReply;
  }

  if (includesAny(input, ['키워드', '워드', 'word', 'wordcloud', '인기'])) {
    const data = await withCachedQuery('admin-insight-wordcloud', cacheTtl, () => getAdminInsightWordcloud(false));
    const list = data.keywords.slice(0, 12)
      .map((k, idx) => `${idx + 1}. **${k.keyword}** (${k.count})`)
      .join('\n');

    return createLocalResponse(asOf, `## 인기 키워드 TOP 12\n\n${list || '- 데이터 없음'}`, {
      visualComponent: 'wordcloud',
    });
  }

  if (includesAny(input, ['시즌', '캘린더', 'calendar', '이번달', '다음달', '월별'])) {
    const data = await withCachedQuery('admin-insight-season', cacheTtl, () => getAdminInsightSeason(false));
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
    const data = await withCachedQuery('admin-insight-heatmap', cacheTtl, () => getAdminInsightHeatmap(false));
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
      withCachedQuery('admin-insight-funnel', cacheTtl, () => getDashboardFunnel(false)),
      withCachedQuery('admin-insight-failures', cacheTtl, () => getDashboardFailures(false)),
      withCachedQuery('admin-insight-quality', cacheTtl, () => getDashboardQuality(false)),
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

  const llmReply = await routeLlmRequest(input, asOf, llmConfig);
  if (llmReply) return llmReply;

  return createLocalResponse(asOf, [
    `가능한 질문 예시:`,
    `- "인기 키워드 보여줘"`,
    `- "이번달 시즌 키워드 추천해줘"`,
    `- "히트맵 요약해줘"`,
    `- "운영 지표 요약"`,
    `- "먹방 스토리보드 기획안 만들어줘"`,
  ].join('\n'), { fallbackReason: 'llm_unavailable' });
}

const LLM_SYSTEM_PROMPT = [
  '당신은 "쯔양 인사이트 챗봇"입니다.',
  '쯔양(먹방 유튜버)의 영상·맛집 데이터를 관리하는 관리자용 챗봇으로서, 데이터 분석, 콘텐츠 기획, 운영 인사이트 등에 대해 도움을 제공합니다.',
  '',
  '규칙:',
  '- 항상 한국어로 답변',
  '- 답변은 간결하고 핵심적으로',
  '- 마크다운 형식 사용 가능 (제목, 리스트, 볼드 등)',
  '- 데이터에 대해 모르는 부분은 솔직히 안내',
  '- 기획안, 분석, 추천 등 창의적 요청에 적극 응답',
].join('\n');

async function routeLlmRequest(
  message: string,
  asOf: string,
  config?: LlmRequestConfig,
): Promise<AdminInsightChatResponse | null> {
  const provider = config?.provider || 'gemini';
  const apiKey = config?.apiKey || (provider === 'gemini' ? GEMINI_API_KEY_ENV : '');
  const model = config?.model || GEMINI_MODEL_DEFAULT;

  if (!apiKey) return null;

  switch (provider) {
    case 'gemini':
      return askGemini(message, model, apiKey, asOf);
    case 'openai':
      return askOpenAI(message, model, apiKey, asOf);
    case 'anthropic':
      return askAnthropic(message, model, apiKey, asOf);
    default:
      return null;
  }
}

/* ──────────────────────────────────────────────────────── */
/*  Streaming support                                      */
/* ──────────────────────────────────────────────────────── */

export async function streamAdminInsightChat(
  message: string,
  llmConfig?: LlmRequestConfig,
): Promise<{ stream: ReadableStream<Uint8Array> } | { local: AdminInsightChatResponse }> {
  const localResult = await tryLocalAnswer(message, llmConfig);
  if (localResult) return { local: localResult };

  const provider = llmConfig?.provider || 'gemini';
  const apiKey = llmConfig?.apiKey || (provider === 'gemini' ? GEMINI_API_KEY_ENV : '');
  const model = llmConfig?.model || GEMINI_MODEL_DEFAULT;

  if (!apiKey) {
    return {
      local: createLocalResponse(new Date().toISOString(), [
        '가능한 질문 예시:',
        '- "인기 키워드 보여줘"',
        '- "이번달 시즌 키워드 추천해줘"',
        '- "히트맵 요약해줘"',
        '- "운영 지표 요약"',
        '- "먹방 스토리보드 기획안 만들어줘"',
      ].join('\n'), { fallbackReason: 'llm_unavailable' }),
    };
  }

  const stream = createLlmStream(message, provider, model, apiKey);
  return { stream };
}

async function tryLocalAnswer(
  message: string,
  llmConfig?: LlmRequestConfig,
): Promise<AdminInsightChatResponse | null> {
  const asOf = new Date().toISOString();
  const input = message.trim();
  if (!input) return createLocalResponse(asOf, '질문을 입력해 주세요.', { fallbackReason: 'empty_input' });

  if (isStoryboardIntent(input)) {
    const storyboardProfile = resolveStoryboardImageProfile(llmConfig);
    const reply = await askStoryboardAgent(input, asOf, storyboardProfile);
    if (reply) return reply;
  }

  if (includesAny(input, ['키워드', '워드', 'word', 'wordcloud', '인기'])) {
    const data = await withCachedQuery('admin-insight-wordcloud', cacheTtl, () => getAdminInsightWordcloud(false));
    const list = data.keywords.slice(0, 12).map((k, idx) => `${idx + 1}. **${k.keyword}** (${k.count})`).join('\n');
    return createLocalResponse(asOf, `## 인기 키워드 TOP 12\n\n${list || '- 데이터 없음'}`, { visualComponent: 'wordcloud' });
  }

  if (includesAny(input, ['시즌', '캘린더', 'calendar', '이번달', '다음달', '월별'])) {
    const data = await withCachedQuery('admin-insight-season', cacheTtl, () => getAdminInsightSeason(false));
    const month = new Date().getUTCMonth() + 1;
    const monthData = data.months.find((m) => m.month === month);
    const list = monthData?.keywords?.slice(0, 6).map((k) =>
      `- ${k.icon} **${k.keyword}** (피크: ${k.peakWeek}, 업로드 추천: ${k.recommendedUploadDate})`
    ).join('\n');
    return createLocalResponse(asOf, `## ${month}월 시즌 키워드\n\n${list || '- 데이터 없음'}`, { visualComponent: 'calendar' });
  }

  if (includesAny(input, ['히트맵', 'heatmap', '리텐션', '하이라이트', 'peak'])) {
    const data = await withCachedQuery('admin-insight-heatmap', cacheTtl, () => getAdminInsightHeatmap(false));
    const top = data.videos[0];
    if (!top) return createLocalResponse(asOf, '히트맵 데이터를 찾지 못했습니다.', { fallbackReason: 'empty_heatmap' });
    return createLocalResponse(asOf, [
      '## 히트맵 요약', '',
      `- 영상: **${top.title}**`,
      `- 피크 구간: **${top.peakSegment.start}%~${top.peakSegment.end}%**`,
      `- 주요 키워드: ${top.analysis.keywords.slice(0, 6).join(', ') || '-'}`,
      '', top.analysis.overallSummary,
    ].join('\n'), { visualComponent: 'heatmap' });
  }

  if (includesAny(input, ['운영', 'funnel', '실패', 'fail', '품질', 'quality', '지표'])) {
    const [funnel, failures, quality] = await Promise.all([
      withCachedQuery('admin-insight-funnel', cacheTtl, () => getDashboardFunnel(false)),
      withCachedQuery('admin-insight-failures', cacheTtl, () => getDashboardFailures(false)),
      withCachedQuery('admin-insight-quality', cacheTtl, () => getDashboardQuality(false)),
    ]);
    const topNotSelections = failures.notSelectionReasons.slice(0, 5).map((r) => `- ${r.label}: ${r.count}`).join('\n');
    return createLocalResponse(asOf, [
      '## 운영 지표 요약', '',
      `- 수집 영상: **${funnel.counts.crawling}**`,
      `- 선택 영상: **${funnel.counts.selection}** (선택률 ${funnel.conversion.selectionRate ?? '-'}%)`,
      `- Rule 적용: **${funnel.counts.rule}** (Rule율 ${funnel.conversion.ruleRate ?? '-'}%)`,
      `- LAAJ 적용: **${funnel.counts.laaj}** (LAAJ율 ${funnel.conversion.laajRate ?? '-'}%)`,
      '', '### Not-Selection 주요 사유 TOP 5', topNotSelections || '- 데이터 없음',
      '', '### 품질(요약)',
      `- pipeline rows: ${quality.totals.pipelineRows}`,
      `- rule metrics: ${quality.totals.withRuleMetrics}`,
      `- laaj metrics: ${quality.totals.withLaajMetrics}`,
    ].join('\n'), { visualComponent: 'stats' });
  }

  return null;
}

function createLlmStream(
  message: string, provider: string, model: string, apiKey: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(ctrl) {
      try {
        switch (provider) {
          case 'gemini': await streamGemini(message, model, apiKey, ctrl, encoder); break;
          case 'openai': await streamOpenAI(message, model, apiKey, ctrl, encoder); break;
          case 'anthropic': await streamAnthropic(message, model, apiKey, ctrl, encoder); break;
          default: ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'unknown_provider' })}\n\n`));
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'stream_error';
        try { ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`)); } catch { /* closed */ }
      } finally {
        try { ctrl.enqueue(encoder.encode('data: [DONE]\n\n')); } catch { /* closed */ }
        ctrl.close();
      }
    },
  });
}

async function streamGemini(
  message: string, model: string, apiKey: string,
  ctrl: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder,
) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: LLM_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: message }] }],
        generationConfig: { maxOutputTokens: LLM_MAX_TOKENS, temperature: 0.7 },
      }),
      signal: ac.signal,
    });
    if (!resp.ok || !resp.body) throw new Error(`Gemini HTTP ${resp.status}`);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const js = line.slice(6).trim();
        if (!js || js === '[DONE]') continue;
        try {
          const p = JSON.parse(js);
          const t = p?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (typeof t === 'string' && t) ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ text: t })}\n\n`));
        } catch { /* skip */ }
      }
    }
  } finally { clearTimeout(timer); }
}

async function streamOpenAI(
  message: string, model: string, apiKey: string,
  ctrl: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder,
) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, max_tokens: LLM_MAX_TOKENS, temperature: 0.7, stream: true,
        messages: [{ role: 'system', content: LLM_SYSTEM_PROMPT }, { role: 'user', content: message }],
      }),
      signal: ac.signal,
    });
    if (!resp.ok || !resp.body) throw new Error(`OpenAI HTTP ${resp.status}`);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const js = line.slice(6).trim();
        if (!js || js === '[DONE]') continue;
        try {
          const p = JSON.parse(js);
          const t = p?.choices?.[0]?.delta?.content;
          if (typeof t === 'string' && t) ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ text: t })}\n\n`));
        } catch { /* skip */ }
      }
    }
  } finally { clearTimeout(timer); }
}

async function streamAnthropic(
  message: string, model: string, apiKey: string,
  ctrl: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder,
) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: LLM_MAX_TOKENS, system: LLM_SYSTEM_PROMPT, stream: true,
        messages: [{ role: 'user', content: message }],
      }),
      signal: ac.signal,
    });
    if (!resp.ok || !resp.body) throw new Error(`Anthropic HTTP ${resp.status}`);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const js = line.slice(6).trim();
        if (!js || js === '[DONE]') continue;
        try {
          const p = JSON.parse(js);
          if (p?.type === 'content_block_delta' && p?.delta?.text) {
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ text: p.delta.text })}\n\n`));
          }
        } catch { /* skip */ }
      }
    }
  } finally { clearTimeout(timer); }
}

async function askGemini(
  message: string,
  model: string,
  apiKey: string,
  asOf: string,
): Promise<AdminInsightChatResponse | null> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, LLM_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: LLM_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: message }] }],
        generationConfig: { maxOutputTokens: LLM_MAX_TOKENS, temperature: 0.7 },
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('[insight/chat] Gemini HTTP error:', response.status);
      return null;
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof content !== 'string' || !content.trim()) return null;

    return {
      asOf,
      content: content.trim(),
      sources: [],
      meta: { source: 'gemini', model },
    };
  } catch (error) {
    console.error('[insight/chat] Gemini request failed:', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function askOpenAI(
  message: string,
  model: string,
  apiKey: string,
  asOf: string,
): Promise<AdminInsightChatResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, LLM_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: LLM_MAX_TOKENS,
        temperature: 0.7,
        messages: [
          { role: 'system', content: LLM_SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('[insight/chat] OpenAI HTTP error:', response.status);
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return null;

    return {
      asOf,
      content: content.trim(),
      sources: [],
      meta: { source: 'openai', model },
    };
  } catch (error) {
    console.error('[insight/chat] OpenAI request failed:', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function askAnthropic(
  message: string,
  model: string,
  apiKey: string,
  asOf: string,
): Promise<AdminInsightChatResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, LLM_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: LLM_MAX_TOKENS,
        system: LLM_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }],
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('[insight/chat] Anthropic HTTP error:', response.status);
      return null;
    }

    const data = await response.json();
    const textBlock = data?.content?.find?.(
      (block: { type: string }) => block.type === 'text',
    );
    const content = textBlock?.text;
    if (typeof content !== 'string' || !content.trim()) return null;

    return {
      asOf,
      content: content.trim(),
      sources: [],
      meta: { source: 'anthropic', model },
    };
  } catch (error) {
    console.error('[insight/chat] Anthropic request failed:', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
