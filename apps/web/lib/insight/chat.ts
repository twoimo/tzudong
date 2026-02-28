import type {
  AdminInsightChatBootstrapResponse,
  AdminInsightChatResponse,
  InsightChatAttachment,
  InsightChatContextMessage,
  InsightChatFeedbackContext,
  InsightChatMemoryMode,
  InsightChatResponseMode,
  InsightChatSource,
  LlmRequestConfig,
  StoryboardModelProfile,
} from '@/types/insight';
import { createSupabaseServiceRoleClient } from '@/lib/insight/supabase';
import { getDashboardFunnel, getDashboardFailures } from '@/lib/dashboard/evaluation';
import { getDashboardQuality } from '@/lib/dashboard/quality';
import { getAdminInsightHeatmap } from '@/lib/insight/heatmap';
import { getAdminInsightSeason } from '@/lib/insight/season';
import { getAdminInsightWordcloud } from '@/lib/insight/wordcloud';
import { getInsightTreemapData } from '@/lib/insight/treemap';

function includesAny(message: string, words: string[]): boolean {
  return words.some((word) => message.includes(word));
}

function isWordcloudQuery(message: string): boolean {
  return includesAny(message, ['워드클라우드', 'wordcloud', 'word cloud', '키워드', '워드'])
    || (includesAny(message, ['인기', '트렌드', '최고', '많은']) && includesAny(message, ['키워드', '워드', 'word', 'wordcloud', 'word cloud']));
}

function isTreemapQuery(message: string): boolean {
  return includesAny(message, ['트리맵', 'treemap', '트리 맵', '분포', '영상 분포', '영상분포', '조회수 분포', '좋아요 분포', '카테고리별', '카테고리', '증감', '변화율']);
}

function buildLocalInsightResponseFailureMessage(reason: string): string {
  if (reason === 'llm_unavailable') {
    return [
      '가능한 질문 예시:',
      '- "트리맵으로 조회수 분포 보여줘"',
      '- "먹방 스토리보드 기획안 만들어줘"',
    ].join('\n');
  }

  return '해당 요청을 처리할 수 있는 답변이 현재 준비되지 않았습니다.';
}

const STORYBOARD_AGENT_API_URL = process.env.STORYBOARD_AGENT_API_URL?.trim();
const STORYBOARD_AGENT_PATH = process.env.STORYBOARD_AGENT_CHAT_PATH?.trim() || '/chat';
const STORYBOARD_AGENT_TIMEOUT_MS = Number(process.env.STORYBOARD_AGENT_TIMEOUT_MS || '8000');
const STORYBOARD_AGENT_MAX_RETRIES = Number(process.env.STORYBOARD_AGENT_MAX_RETRIES || '2');
const STORYBOARD_AGENT_RETRY_BASE_MS = Number(process.env.STORYBOARD_AGENT_RETRY_BASE_MS || '250');
const STORYBOARD_AGENT_RETRY_MAX_MS = Number(process.env.STORYBOARD_AGENT_RETRY_MAX_MS || '1500');
const STORYBOARD_AGENT_UNAVAILABLE_COOLDOWN_MS = Number(process.env.STORYBOARD_AGENT_UNAVAILABLE_COOLDOWN_MS || '30000');
const STORYBOARD_AGENT_ENABLED = process.env.STORYBOARD_AGENT_ENABLED !== 'false';
const STORYBOARD_AGENT_REMOTE_ENABLED = process.env.STORYBOARD_AGENT_REMOTE_ENABLED === 'true';
const STORYBOARD_BGE_ENABLED = process.env.STORYBOARD_BGE_ENABLED === 'true';
const STORYBOARD_BGE_EMBEDDING_URL = process.env.STORYBOARD_BGE_EMBEDDING_URL?.trim();
const STORYBOARD_BGE_EMBEDDING_TOKEN = process.env.STORYBOARD_BGE_EMBEDDING_TOKEN?.trim();
const STORYBOARD_BGE_EMBEDDING_TIMEOUT_MS = Number(process.env.STORYBOARD_BGE_EMBEDDING_TIMEOUT_MS || '8000');
const STORYBOARD_BGE_MATCH_COUNT = Number(process.env.STORYBOARD_BGE_MATCH_COUNT || '8');
const STORYBOARD_BGE_MATCH_THRESHOLD = Number(process.env.STORYBOARD_BGE_MATCH_THRESHOLD || '0.5');
const STORYBOARD_BGE_DENSE_WEIGHT = Number(process.env.STORYBOARD_BGE_DENSE_WEIGHT || '0.6');
const STORYBOARD_ORCHESTRATOR_MAX_RETRIES = Number(process.env.STORYBOARD_ORCHESTRATOR_MAX_RETRIES || '3');
const STORYBOARD_WEB_SEARCH_ENABLED = process.env.STORYBOARD_WEB_SEARCH_ENABLED === 'true';
const STORYBOARD_WEB_SEARCH_URL = process.env.STORYBOARD_WEB_SEARCH_URL?.trim();
const STORYBOARD_WEB_SEARCH_TOKEN = (
  process.env.STORYBOARD_WEB_SEARCH_TOKEN?.trim()
  || process.env.TAVILY_API_KEY?.trim()
  || process.env.PUBLIC_TAVILY_API_KEY?.trim()
);
const STORYBOARD_WEB_SEARCH_TIMEOUT_MS = Number(process.env.STORYBOARD_WEB_SEARCH_TIMEOUT_MS || '8000');
const INSIGHT_QUERY_TTL_MS = Number(process.env.INSIGHT_QUERY_CACHE_TTL_MS || '45000');

const GEMINI_API_KEY_ENV = process.env.GEMINI_OCR_YEON?.trim() || '';
const GEMINI_MODEL_DEFAULT = 'gemini-3-flash-preview';
const DEFAULT_STORYBOARD_MODEL_PROFILE: StoryboardModelProfile = 'nanobanana';
const DEFAULT_IMAGE_MODEL_PROFILE: StoryboardModelProfile = 'nanobanana';
const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_TOKENS = 4096;
const LLM_MAX_TOKENS_FAST = 1200;
const LLM_MAX_TOKENS_DEEP = 2048;
const LLM_MAX_TOKENS_STRUCTURED = 2560;
const FALLBACK_CONFIDENCE_MIN = 0.18;

type ResponseModeProfile = {
  maxOutputTokens: number;
  temperature: number;
  promptAddendum: string;
  confidenceBase: number;
};

const RESPONSE_MODE_PROFILES: Record<InsightChatResponseMode, ResponseModeProfile> = {
  fast: {
    maxOutputTokens: LLM_MAX_TOKENS_FAST,
    temperature: 0.75,
    promptAddendum: '짧고 실행 중심으로 핵심만 요약해줘. (긴 문장은 피하고 즉시 실행 가능 포인트를 먼저 제시)',
    confidenceBase: 0.78,
  },
  deep: {
    maxOutputTokens: LLM_MAX_TOKENS_DEEP,
    temperature: 0.55,
    promptAddendum: '근거, 한계, 대안, 실행 체크포인트를 포함해 충분히 자세하게 분석해줘. 필요하면 번호 목록으로 정리.',
    confidenceBase: 0.85,
  },
  structured: {
    maxOutputTokens: LLM_MAX_TOKENS_STRUCTURED,
    temperature: 0.4,
    promptAddendum: '반드시 아래 형식으로 구조화해줘. 1) 핵심 요약 2) 근거/인사이트 3) 다음 액션 4) 검증 포인트',
    confidenceBase: 0.83,
  },
};

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
  '기획',
  '씬 구성',
  '콘텐츠 아이디어',
  '먹방',
  '촬영안내',
  '촬영 플랜',
  '아이디어',
];

const DEFAULT_STORYBOARD_TEMPLATE_PROFILE: Record<StoryboardModelProfile, string> = {
  nanobanana: '실무형',
  nanobanana_pro: '프리미엄',
};

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

type StoryboardBgeResult = {
  video_id: string;
  recollect_id: number;
  page_content: string;
  metadata: Record<string, unknown>;
  chunk_index?: number;
  dense_score?: number;
  sparse_score?: number;
  hybrid_score?: number;
};

type StoryboardWebSearchResult = {
  title?: string;
  content?: string;
  snippet?: string;
  text?: string;
  url?: string;
};

type StoryboardAgentIntent = 'simple_chat' | 'qna_about_data' | 'storyboard';

type StoryboardAgentState = {
  intent: StoryboardAgentIntent;
  loopCount: number;
  retryCount: number;
  previousQueries: string[];
  validationStatus: 'pass' | 'fail' | 'need_human' | 'pending';
  validationFeedback: string;
  activeQuery: string;
  transcriptDocs: StoryboardBgeResult[];
  webDocs: StoryboardWebSearchResult[];
  videoMetadataDocs: Record<string, unknown>[];
  candidateVideoIds: string[];
};

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
    requestId?: string;
    sources?: InsightChatSource[];
    visualComponent?: AdminInsightChatResponse['visualComponent'];
    source?: 'local' | 'agent' | 'fallback';
    responseMode?: InsightChatResponseMode;
    memoryMode?: InsightChatMemoryMode;
    confidence?: number;
    toolTrace?: string[];
  } = {},
): AdminInsightChatResponse {
  const resolvedSource = options.source || 'local';
  const responseMode = options.responseMode || 'fast';
  const memoryMode = normalizeMemoryMode(options.memoryMode);
  const toolTrace = options.toolTrace ?? [];
  const confidence = clampFiniteFloat(
    options.confidence ?? (resolvedSource === 'local' ? 0.84 : resolvedSource === 'agent' ? 0.78 : 0.45),
    0.45,
  );

  return {
    asOf,
    content,
    sources: options.sources ?? [],
    visualComponent: options.visualComponent,
    meta: {
      source: resolvedSource,
      fallbackReason: options.fallbackReason,
      ...(options.requestId ? { requestId: options.requestId } : {}),
      ...(memoryMode ? { memoryMode } : {}),
      responseMode,
      confidence,
      toolTrace,
    },
  };
}

function normalizeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, 64);
  return normalized || undefined;
}

function normalizeResponseMode(raw: unknown): InsightChatResponseMode {
  return raw === 'fast' || raw === 'deep' || raw === 'structured' ? raw : 'fast';
}

function normalizeMemoryMode(raw: unknown): InsightChatMemoryMode | undefined {
  return raw === 'off' || raw === 'session' || raw === 'pinned' ? raw : undefined;
}

function resolveResponseModeProfile(responseMode?: InsightChatResponseMode): ResponseModeProfile {
  return RESPONSE_MODE_PROFILES[normalizeResponseMode(responseMode)] ?? RESPONSE_MODE_PROFILES.fast;
}

type ResponseModeMetaPayload = {
  responseMode?: InsightChatResponseMode;
  toolTrace?: string[];
  feedbackContext?: InsightChatFeedbackContext;
};

const MAX_PROMPT_ATTACHMENT_SNIPPETS = 4;
const MAX_PROMPT_ATTACHMENT_SNIPPET_LENGTH = 1500;

function sanitizeFeedbackReason(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim().replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').slice(0, 300);
  return normalized || undefined;
}

function sanitizePromptAttachmentName(raw: string): string {
  return raw
    .trim()
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .slice(0, 120);
}

function buildAttachmentContextBlock(attachments?: InsightChatAttachment[]): string[] {
  if (!attachments?.length) {
    return [];
  }

  const snippets = attachments
    .slice(0, MAX_PROMPT_ATTACHMENT_SNIPPETS)
    .map((attachment, index) => {
      const safeName = sanitizePromptAttachmentName(attachment.name) || `attachment-${index + 1}.txt`;
      const safeMimeType = (attachment.mimeType || 'text/plain').trim().slice(0, 80);
      const safeContent = attachment.content
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, '')
        .slice(0, MAX_PROMPT_ATTACHMENT_SNIPPET_LENGTH);

      return [
        `파일 ${index + 1}: ${safeName} (${safeMimeType})`,
        '```text',
        safeContent,
        '```',
      ].join('\n');
    });

  return snippets.length
    ? ['', '[첨부 파일 컨텍스트]', ...snippets]
    : [];
}

const MAX_MEMORY_CONTEXT_MESSAGES = 12;
const MAX_MEMORY_CONTEXT_MESSAGE_LENGTH = 900;

function sanitizeMemoryContextContent(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MEMORY_CONTEXT_MESSAGE_LENGTH);
}

function buildMemoryContextBlock(
  memoryMode?: InsightChatMemoryMode,
  contextMessages?: InsightChatContextMessage[],
): string[] {
  const normalizedMemoryMode = normalizeMemoryMode(memoryMode);
  if (!contextMessages?.length || !normalizedMemoryMode || normalizedMemoryMode === 'off') {
    return [];
  }

  const normalizedEntries = contextMessages
    .slice(-MAX_MEMORY_CONTEXT_MESSAGES)
    .map((entry) => ({
      role: entry.role,
      content: sanitizeMemoryContextContent(entry.content),
    }))
    .filter((entry) => entry.content.length > 0);

  if (!normalizedEntries.length) {
    return [];
  }

  const lines = normalizedEntries.map((entry, index) => {
    const roleLabel = entry.role === 'assistant' ? '어시스턴트' : '사용자';
    return `${index + 1}. ${roleLabel}: ${entry.content}`;
  });

  return [
    '',
    `[대화 기억 모드: ${normalizedMemoryMode}]`,
    '아래는 이전 대화 맥락입니다. 현재 질문에 필요한 범위에서만 반영해 답변해 주세요.',
    ...lines,
  ];
}

function buildPromptWithContext(
  message: string,
  responseMode?: InsightChatResponseMode,
  feedbackContext?: InsightChatFeedbackContext,
  attachments?: InsightChatAttachment[],
  memoryMode?: InsightChatMemoryMode,
  contextMessages?: InsightChatContextMessage[],
): { message: string; profile: ResponseModeProfile } {
  const profile = resolveResponseModeProfile(responseMode);
  const base = message.trim().replace(/[\u0000-\u001f\u007f]+/g, '').slice(0, 9000);
  const memoryContextLines = buildMemoryContextBlock(memoryMode, contextMessages);
  const attachmentLines = buildAttachmentContextBlock(attachments);
  const feedbackLines = feedbackContext?.rating
    ? [
        '',
        '[다시 생성 피드백]',
        `이전 응답에 대한 평가: ${feedbackContext.rating === 'up' ? '좋음' : '개선 필요'}`,
        ...(feedbackContext.reason ? [`사유: ${sanitizeFeedbackReason(feedbackContext.reason)}`] : []),
        '위 피드백을 반영해 답변을 새롭게 생성해 주세요.',
      ]
    : [];

  const promptSections: string[] = [base];
  if (memoryContextLines.length > 0) {
    promptSections.push(...memoryContextLines);
  }
  if (attachmentLines.length > 0) {
    promptSections.push(...attachmentLines);
  }
  if (feedbackLines.length > 0) {
    promptSections.push(...feedbackLines);
  }

  return {
    profile,
    message: promptSections.join('\n').trim(),
  };
}

function clampFiniteInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function clampFiniteFloat(value: number, fallback: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function parseBgeEmbedding(raw: unknown): number[] | null {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parseBgeEmbedding(parsed);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(raw)) {
    if (raw && typeof raw === 'object') {
      const payload = raw as Record<string, unknown>;
      if (Array.isArray(payload.embedding)) {
        return parseBgeEmbedding(payload.embedding);
      }
      if (Array.isArray(payload.vector)) {
        return parseBgeEmbedding(payload.vector);
      }
      if (Array.isArray(payload.data)) {
        return parseBgeEmbedding(payload.data);
      }
      if (Array.isArray(payload.output)) {
        return parseBgeEmbedding(payload.output);
      }
    }
    return null;
  }

  if (raw.length === 0) {
    return null;
  }

  if (typeof raw[0] === 'number') {
    return raw.every((value) => typeof value === 'number') ? (raw as number[]) : null;
  }

  if (Array.isArray(raw[0]) && raw[0].length > 0 && typeof raw[0][0] === 'number') {
    const nested = raw[0] as unknown[];
    return nested.every((value) => typeof value === 'number') ? (nested as number[]) : null;
  }

  return null;
}

function normalizeStoryboardBgeResult(raw: unknown): StoryboardBgeResult | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const item = raw as Record<string, unknown>;
  const videoId = typeof item.video_id === 'string' ? item.video_id.trim() : '';
  const pageContent = typeof item.page_content === 'string' ? item.page_content.trim() : '';
  const recollectId = typeof item.recollect_id === 'number' ? item.recollect_id : Number(item.recollect_id);
  const metadata = item.metadata && typeof item.metadata === 'object' ? (item.metadata as Record<string, unknown>) : {};
  const chunkIndex = typeof item.chunk_index === 'number' ? item.chunk_index : Number(item.chunk_index);

  if (!videoId || !pageContent) {
    return null;
  }

  return {
    video_id: videoId,
    recollect_id: Number.isFinite(recollectId) ? recollectId : 0,
    page_content: pageContent,
    metadata,
    chunk_index: Number.isFinite(chunkIndex) ? Math.max(0, chunkIndex) : undefined,
    dense_score: typeof item.dense_score === 'number' ? item.dense_score : Number(item.dense_score),
    sparse_score: typeof item.sparse_score === 'number' ? item.sparse_score : Number(item.sparse_score),
    hybrid_score: typeof item.hybrid_score === 'number' ? item.hybrid_score : Number(item.hybrid_score),
  };
}

function normalizeStoryboardAgentIntent(message: string): StoryboardAgentIntent {
  if (includesAny(message, ['몇', '몇개', '몇 개', '몇 개야', '개수', '갯수', '조회수', '통계', '데이터', '영상 개수', '몇 개의'])) {
    return 'qna_about_data';
  }

  if (includesAny(message, STORYBOARD_KEYWORDS)) {
    return 'storyboard';
  }

  if (includesAny(message, ['기획', '구성', '촬영', '먹방', '컨셉', '컷', '스크립트', '스토리', '연출', '쇼츠'])) {
    return 'storyboard';
  }

  if (includesAny(message, ['안녕', '고마워', '감사', '반갑', '지금 시간', '뭐', '어떤'])) {
    return 'simple_chat';
  }

  return 'simple_chat';
}

function clampOrchestratorRetryCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 3;
  }
  return Math.floor(value);
}

function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return ['true', '1', 'y', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}

function extractText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  return fallback;
}

function extractVideoIdFromRecord(row: Record<string, unknown>): string {
  const raw = typeof row.video_id === 'string'
    ? row.video_id
    : typeof row.video_id === 'number'
      ? String(row.video_id)
      : typeof row.videoId === 'string'
        ? row.videoId
        : typeof row.videoId === 'number'
          ? String(row.videoId)
          : typeof row.id === 'string'
            ? row.id
            : typeof row.id === 'number'
              ? String(row.id)
              : '';
  const normalized = raw.trim();
  return normalized;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of values) {
    const value = extractText(raw).toLowerCase();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

function extractVideoIdsFromRecords(records: Record<string, unknown>[]): string[] {
  return dedupeStrings(records.map(extractVideoIdFromRecord));
}

function resolveStoryboardYouTubeLink(videoId: string, metadata: Record<string, unknown>): string {
  const explicit = extractText(metadata.youtube_url) || extractText(metadata.youtubeLink) || extractText(metadata.url);
  if (explicit) return explicit;
  const parsedId = extractText(metadata.video_id);
  if (parsedId && /^[-_A-Za-z0-9]+$/.test(parsedId)) {
    return `https://www.youtube.com/watch?v=${parsedId}`;
  }
  if (videoId && /^[-_A-Za-z0-9]+$/.test(videoId)) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  return '';
}

function normalizeStoryboardTime(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const total = Math.max(0, Math.floor(value));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return null;
}

function buildStoryboardTimeRange(metadata: Record<string, unknown>): string {
  const start = normalizeStoryboardTime(metadata.start_time) || normalizeStoryboardTime(metadata.start);
  const end = normalizeStoryboardTime(metadata.end_time) || normalizeStoryboardTime(metadata.end);
  if (start && end) {
    return `${start}~${end}`;
  }
  return '-';
}

function buildBgeSparseEmbedding(input: string): Record<string, number> {
  const raw = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  const scoreByToken = new Map<string, number>();

  for (const token of raw) {
    scoreByToken.set(token, (scoreByToken.get(token) ?? 0) + 1);
  }

  return Object.fromEntries(
    [...scoreByToken.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 64)
      .map(([token, score]) => [token, Number(score)]),
  );
}

function storyboardSourcesFromBgeResults(results: StoryboardBgeResult[]): InsightChatSource[] {
  return results
    .map((item) => ({
      videoTitle: item.video_id || '스토리보드 참고 영상',
      youtubeLink: resolveStoryboardYouTubeLink(item.video_id, item.metadata),
      timestamp: buildStoryboardTimeRange(item.metadata),
      text: item.page_content.slice(0, 220),
    }))
    .filter((item) => item.videoTitle || item.text);
}

function storyboardSourcesFromMetadata(results: Record<string, unknown>[]): InsightChatSource[] {
  return results
    .map((item) => {
      const videoId = extractVideoIdFromRecord(item);
      const title = extractText(item.title, '스토리보드 후보 영상');
      const views = extractText(item.view_count);
      const publishedAt = extractText(item.published_at);
      const channel = extractText(item.channel_title);
      const text = [
        views ? `${views} views` : '',
        publishedAt ? `게시일 ${publishedAt}` : '',
        channel || '',
      ].filter(Boolean).join(' · ');
      return {
        videoTitle: title,
        youtubeLink: resolveStoryboardYouTubeLink(videoId, item),
        timestamp: '-',
        text: text || extractText(item.description),
      };
    })
    .filter((item) => item.videoTitle || item.youtubeLink || item.text);
}

function extractTranscriptCaption(item: StoryboardBgeResult): string {
  const metadataCaption = item.metadata.caption;
  if (typeof metadataCaption === 'string') {
    return metadataCaption.trim();
  }
  if (Array.isArray(metadataCaption)) {
    return metadataCaption
      .map((entry) => extractText(typeof entry === 'string' ? entry : (entry as Record<string, unknown>)?.text))
      .filter(Boolean)
      .join(' | ')
      .trim();
  }
  return '';
}

function buildTranscriptEvidenceText(item: StoryboardBgeResult): string {
  const range = buildStoryboardTimeRange(item.metadata);
  const subtitle = item.page_content.replace(/\s+/g, ' ').slice(0, 240);
  const caption = extractTranscriptCaption(item);
  const captionHint = caption ? ` / 시각묘사: ${caption}` : '';
  return `- [${item.video_id}] ${range} | ${subtitle}${captionHint}`;
}

function dedupeBgeResults(input: StoryboardBgeResult[]): StoryboardBgeResult[] {
  const seen = new Set<string>();
  const merged: StoryboardBgeResult[] = [];
  for (const item of input) {
    const key = `${item.video_id}:${item.chunk_index ?? item.recollect_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

async function buildStoryboardQueryArtifacts(query: string): Promise<{
  embedding: number[] | null;
  sparse: Record<string, number>;
} | null> {
  if (!STORYBOARD_BGE_ENABLED || !STORYBOARD_BGE_EMBEDDING_URL) {
    return null;
  }

  const embedding = await fetchBgeEmbedding(query);
  if (!embedding || !embedding.length) {
    return null;
  }

  return {
    embedding,
    sparse: buildBgeSparseEmbedding(query),
  };
}

async function loadVideoFrameCaptionsForHit(item: StoryboardBgeResult): Promise<StoryboardBgeResult> {
  if (!item.video_id || !Number.isFinite(item.recollect_id)) {
    return item;
  }
  if (!safeBoolean(item.metadata.is_peak)) {
    return item;
  }

  const startSec = safeNumber(item.metadata.start_time, 0);
  const endSec = safeNumber(item.metadata.end_time, startSec + 30);
  if (startSec < 0 || endSec <= startSec) {
    return item;
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.rpc('get_video_captions_for_range', {
      p_video_id: item.video_id,
      p_recollect_id: item.recollect_id,
      p_start_sec: startSec,
      p_end_sec: endSec,
    });

    if (error) {
      console.warn('[admin/insight/chat] storyboard caption rpc error:', error);
      return item;
    }

    if (!Array.isArray(data) || data.length === 0) {
      return item;
    }

    const captions = data
      .map((row) => extractText(
        typeof row === 'string'
          ? row
          : (row as Record<string, unknown>).raw_caption ?? (row as Record<string, unknown>).chronological_analysis,
      ))
      .filter(Boolean)
      .join(' ');
    if (!captions) {
      return item;
    }

    return {
      ...item,
      metadata: {
        ...item.metadata,
        caption: captions,
      },
    };
  } catch (error) {
    console.warn('[admin/insight/chat] storyboard caption fetch error:', error);
    return item;
  }
}

function makeToolName(label: string): string {
  return label.trim().toLowerCase() || 'tool';
}

async function searchTranscriptsHybridTool(
  query: string,
  options: {
    maxCount?: number;
    queryEmbedding?: number[];
    sparse?: Record<string, number>;
    videoIds?: string[];
  } = {},
): Promise<StoryboardBgeResult[]> {
  const maxCount = clampPositiveInteger(options.maxCount ?? STORYBOARD_BGE_MATCH_COUNT, 8);
  let embedding = options.queryEmbedding;
  let sparse = options.sparse;
  const videoIdFilter = dedupeStrings(options.videoIds ?? []);

  if (!embedding || !embedding.length || !sparse || !Object.keys(sparse).length) {
    const artifacts = await buildStoryboardQueryArtifacts(query);
    if (!artifacts) return [];
    embedding = artifacts.embedding ?? undefined;
    sparse = artifacts.sparse;
  }

  if (!embedding || !embedding.length) {
    return [];
  }

  try {
    const denseWeight = clampFiniteFloat(STORYBOARD_BGE_DENSE_WEIGHT, 0.6, 0, 1);
    const threshold = clampFiniteFloat(STORYBOARD_BGE_MATCH_THRESHOLD, 0.5, 0, 1);
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.rpc('match_documents_hybrid', {
      query_embedding: embedding,
      query_sparse: sparse || {},
      dense_weight: denseWeight,
      match_threshold: threshold,
      match_count: maxCount,
    });

    if (error) {
      console.warn('[admin/insight/chat] storyboard hybrid rpc error:', error);
      return [];
    }

    if (!Array.isArray(data)) {
      return [];
    }

    const normalized = data
      .map(normalizeStoryboardBgeResult)
      .filter((item): item is StoryboardBgeResult => item !== null);

    const deduped = dedupeBgeResults(normalized).slice(0, maxCount);
    const filtered = videoIdFilter.length > 0
      ? deduped.filter((item) => videoIdFilter.includes(item.video_id.toLowerCase()))
      : deduped;
    const target = filtered.length > 0 ? filtered : deduped;
    const withCaptions = await Promise.all(target.map((item) => loadVideoFrameCaptionsForHit(item)));
    return withCaptions;
  } catch (error) {
    console.warn(`[admin/insight/chat] ${makeToolName('search transcripts_hybrid')} failed:`, error);
    return [];
  }
}

async function searchVideoIdsByQueryTool(query: string): Promise<{ video_id: string; recollect_id: number; best_score: number; sample_content: string; has_peak: boolean; }[]> {
  const artifacts = await buildStoryboardQueryArtifacts(query);
  if (!artifacts) return [];
  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.rpc('search_video_ids_by_query', {
      query_embedding: artifacts.embedding,
      query_sparse: artifacts.sparse,
      dense_weight: clampFiniteFloat(STORYBOARD_BGE_DENSE_WEIGHT, 0.6, 0, 1),
      match_threshold: clampFiniteFloat(STORYBOARD_BGE_MATCH_THRESHOLD, 0.5, 0, 1),
      match_count: clampPositiveInteger(STORYBOARD_BGE_MATCH_COUNT, 8),
    });
    if (error) {
      console.warn('[admin/insight/chat] search_video_ids_by_query rpc error:', error);
      return [];
    }
    if (!Array.isArray(data)) return [];
    return data
      .filter((row) => row && typeof row === 'object')
      .map((row) => ({
        video_id: extractText((row as Record<string, unknown>).video_id),
        recollect_id: safeNumber((row as Record<string, unknown>).recollect_id, 0),
        best_score: safeNumber((row as Record<string, unknown>).best_score, 0),
        sample_content: extractText((row as Record<string, unknown>).sample_content),
        has_peak: safeBoolean((row as Record<string, unknown>).has_peak),
      }))
      .filter((row) => !!row.video_id);
  } catch (error) {
    console.warn('[admin/insight/chat] search_video_ids_by_query failed:', error);
    return [];
  }
}

async function getVideoMetadataFilteredTool(options: { minViewCount?: number; limit?: number; orderBy?: 'view_count' | 'published_at' | 'comment_count' } = {}): Promise<Record<string, unknown>[]> {
  const payload: Record<string, unknown> = {
    min_view_count: clampPositiveInteger(options.minViewCount ?? 0, 0),
    p_limit: clampPositiveInteger(options.limit ?? 5, 5),
    p_order_by: options.orderBy === 'published_at' || options.orderBy === 'comment_count' ? options.orderBy : 'view_count',
  };

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.rpc('get_video_metadata_filtered', payload);
    if (error) {
      console.warn('[admin/insight/chat] get_video_metadata_filtered rpc error:', error);
      return [];
    }
    if (!Array.isArray(data)) return [];
    return data as Record<string, unknown>[];
  } catch (error) {
    console.warn('[admin/insight/chat] get_video_metadata_filtered failed:', error);
    return [];
  }
}

async function getRestaurantsByCategoryTool(category: string): Promise<Record<string, unknown>[]> {
  if (!category.trim()) return [];
  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.rpc('search_restaurants_by_category', {
      p_category: category,
      p_limit: 10,
    });
    if (error) {
      console.warn('[admin/insight/chat] search_restaurants_by_category rpc error:', error);
      return [];
    }
    if (!Array.isArray(data)) return [];
    return data as Record<string, unknown>[];
  } catch (error) {
    console.warn('[admin/insight/chat] search_restaurants_by_category failed:', error);
    return [];
  }
}

async function searchRestaurantsByNameTool(name: string): Promise<Record<string, unknown>[]> {
  if (!name.trim()) return [];
  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.rpc('search_restaurants_by_name', {
      keyword: name,
      p_limit: 5,
    });
    if (error) {
      console.warn('[admin/insight/chat] search_restaurants_by_name rpc error:', error);
      return [];
    }
    if (!Array.isArray(data)) return [];
    return data as Record<string, unknown>[];
  } catch (error) {
    console.warn('[admin/insight/chat] search_restaurants_by_name failed:', error);
    return [];
  }
}

async function getCategoriesByRestaurantTool(query: { restaurant_name?: string; video_id?: string }): Promise<string[]> {
  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.rpc('get_categories_by_restaurant_name_or_youtube_url', {
      p_restaurant_name: query.restaurant_name,
      p_video_id: query.video_id,
    });
    if (error) {
      console.warn('[admin/insight/chat] get_categories_by_restaurant_name_or_youtube_url rpc error:', error);
      return [];
    }
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((item) => extractText(item))
      .filter(Boolean);
  } catch (error) {
    console.warn('[admin/insight/chat] get_categories_by_restaurant_name_or_youtube_url failed:', error);
    return [];
  }
}

async function getAllApprovedRestaurantNamesTool(): Promise<string[]> {
  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.rpc('get_all_approved_restaurant_names');
    if (error) {
      console.warn('[admin/insight/chat] get_all_approved_restaurant_names rpc error:', error);
      return [];
    }
    if (!Array.isArray(data)) return [];
    const names = data
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        return extractText((item as Record<string, unknown>).name);
      })
      .filter(Boolean);
    return names;
  } catch (error) {
    console.warn('[admin/insight/chat] get_all_approved_restaurant_names failed:', error);
    return [];
  }
}

async function searchWebTool(query: string): Promise<StoryboardWebSearchResult[]> {
  if (!STORYBOARD_WEB_SEARCH_ENABLED || !STORYBOARD_WEB_SEARCH_URL || !query.trim()) {
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clampFiniteInteger(STORYBOARD_WEB_SEARCH_TIMEOUT_MS, 8000));
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (STORYBOARD_WEB_SEARCH_TOKEN) {
      headers.Authorization = `Bearer ${STORYBOARD_WEB_SEARCH_TOKEN}`;
    }

    const response = await fetch(STORYBOARD_WEB_SEARCH_URL, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        query,
        max_results: 5,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json().catch(() => null);
    const rawResults = Array.isArray((payload as Record<string, unknown>)?.results)
      ? ((payload as Record<string, unknown>).results as unknown[])
      : Array.isArray((payload as Record<string, unknown>)?.items)
        ? ((payload as Record<string, unknown>).items as unknown[])
        : Array.isArray(payload)
          ? (payload as unknown[])
          : [];

    return rawResults
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        return {
          title: extractText(row.title),
          snippet: extractText(row.snippet),
          content: extractText(row.content),
          text: extractText(row.text),
          url: extractText(row.url),
        } as StoryboardWebSearchResult;
      })
      .filter((item): item is StoryboardWebSearchResult => item !== null && !!(item.title || item.snippet || item.content || item.text || item.url));
  } catch (error) {
    console.warn('[admin/insight/chat] web search failed:', error);
    return [];
  } finally {
    clearTimeout(timer);
  }
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

function createStoryboardUnavailableResponse(asOf: string, requestId?: string, memoryMode?: InsightChatMemoryMode): AdminInsightChatResponse {
  return createLocalResponse(asOf, '스토리보드 에이전트 연결이 일시적으로 불안정합니다. 잠시 뒤 다시 시도해 주세요.', {
    fallbackReason: 'storyboard_agent_unavailable',
    ...(requestId ? { requestId } : {}),
    ...(memoryMode ? { memoryMode } : {}),
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

function inferStoryboardTopic(input: string): string {
  const candidates = [
    '제육', '삼겹살', '떡볶이', '마라', '파스타', '김치찌개', '찜닭', '보쌈', '회', '돈까스', '라면', '닭강정',
    '국밥', '칼국수', '피자', '치킨', '햄버거', '오리', '족발', '먹방',
  ];
  const match = candidates.find((keyword) => input.includes(keyword));
  return match ?? '요청 주제';
}

function buildStoryboardFallbackContent(input: string, profile: StoryboardModelProfile): string {
  const topic = inferStoryboardTopic(input);
  const profileLabel = DEFAULT_STORYBOARD_TEMPLATE_PROFILE[profile];
  const safeInput = input.trim() || '현재 주제';

  return [
    `## ${safeInput} 스토리보드 (내부 생성)`,
    '',
    `**프로필:** ${profileLabel}`,
    '',
    '### 🎬 제작 구성',
    '| 순서 | 장면 (Visual) | 오디오/자막 (Audio/Sub) | 핵심 포인트 |',
    '|---|---|---|---|',
    '| 1. 오프닝 | 화면 전체가 주제 메뉴를 한 번에 보여줌 | \"오늘은 **' + topic + '**로 집중 공략해볼게요\" | 첫인상 몰입, 기대감 형성 |',
    '| 2. 핵심 재료 | 재료 클로즈업, 향과 질감 강조 | 칼질/볶음 소리 강조, 짧은 설명 멘트 | 양감과 비주얼 임팩트 강화 |',
    '| 3. 첫 입 | 한입 클로즈업 또는 첫 접시 제시 | ASMR 계열의 씹히는 소리 + 감상 멘트 | 몰입감 높은 먹방 포인트 |',
    '| 4. 변주 샷 | 밥/면/계란 등 조합 변형 쇼트 | "먹는 재미 + 반응" 멘트 | 반복 시청 동기 부여 |',
    '| 5. 클라이맥스 | 마지막 대형 플레이(볶음/마무리) | "이거 완성!" 강한 감정 표현 | 고조되는 리듬과 감정선 마감 |',
    '| 6. 엔딩 | 접시 비우기 + 결과 샷 | \"오늘도 잘 먹었습니다\" | 시청자 피로도 낮추는 정리 |',
    '',
    '### 💡 콘텐츠 업그레이드 인사이트',
    '- 주제는 간결하게 제시하고, 장면마다 음향 포인트를 분리하세요.',
    `- ${topic} 특성을 살리려면 접시 비율(비주얼 대비)과 먹는 속도(리듬)를 같이 관리하세요.`,
    '- 썸네일은 큰 접시/한 입샷/반응표정 3컷 이내로 구성하면 클릭률이 안정적입니다.',
  ].join('\n');
}

async function fetchBgeEmbedding(message: string): Promise<number[] | null> {
  const timeoutMs = clampFiniteInteger(STORYBOARD_BGE_EMBEDDING_TIMEOUT_MS, 8000);
  const endpoint = STORYBOARD_BGE_EMBEDDING_URL;
  if (!endpoint) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (STORYBOARD_BGE_EMBEDDING_TOKEN) {
      headers.Authorization = `Bearer ${STORYBOARD_BGE_EMBEDDING_TOKEN}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ inputs: message }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn('[admin/insight/chat] BGE embedding request failed:', response.status, text.slice(0, 120));
      return null;
    }

    const payload = await response.json().catch(() => null);
    return parseBgeEmbedding(payload);
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) {
      console.warn('[admin/insight/chat] BGE embedding request error:', error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getStoryboardBgeContext(message: string): Promise<StoryboardBgeResult[]> {
  const query = message.trim();
  if (!query) {
    return [];
  }
  const transcripts = await searchTranscriptsHybridTool(query, {
    maxCount: clampPositiveInteger(STORYBOARD_BGE_MATCH_COUNT, 8),
  });
  if (!transcripts.length) {
    return [];
  }
  return transcripts;
}

function buildStoryboardTranscriptContextPrompt(results: StoryboardBgeResult[]): string {
  if (!results.length) {
    return '';
  }
  const lines = results.slice(0, 6).map((result, index) => `${index + 1}. ${buildTranscriptEvidenceText(result)}`);
  return [
    '',
    '### 참고용 영상 근거',
    ...lines,
    '',
    '근거 텍스트를 바탕으로 실제 촬영 가능한 씬 구성을 작성하세요. 허위 정보 대신 실제 장면 기반으로 구성하고, 자극적 단정은 피하세요.',
  ].join('\n');
}

function buildStoryboardWebContextPrompt(results: StoryboardWebSearchResult[]): string {
  if (!results.length) {
    return '';
  }
  const lines = results.slice(0, 4).map((result, index) => {
    const source = [result.title, result.snippet || result.content || result.text].filter(Boolean).join(' - ');
    const url = result.url ? ` (${result.url})` : '';
    return `${index + 1}. ${source}${url}`;
  });
  return ['', '### 외부 레퍼런스', ...lines].join('\n');
}

function buildStoryboardVideoMetadataContextPrompt(items: Record<string, unknown>[]): string {
  if (!items.length) {
    return '';
  }
  const lines = items.slice(0, 5).map((item, index) => {
    const title = extractText(item.title);
    const viewCount = extractText(item.view_count, '-');
    const publishedAt = extractText(item.published_at, '-');
    return `${index + 1}. ${title} (${viewCount} views, ${publishedAt})`;
  });
  return ['', '### 후보 영상 메타', ...lines].join('\n');
}

function buildStoryboardHumanRequest(state: StoryboardAgentState): string {
  return [
    '현재 내부 데이터로는 스토리보드 근거를 충분히 수집하지 못했습니다.',
    '',
    `재시도 이력: ${state.retryCount}회`,
    state.validationFeedback || '캡션 기준 데이터가 부족합니다.',
    '',
    '다음 중 하나를 선택해 주세요.',
    '1) 다른 키워드(예: 메뉴명, 장소명, 촬영 분위기)로 재요청',
    '2) 현재 데이터로 바로 진행',
  ].join('\n');
}

function buildStoryboardSimpleChatResponse(input: string): string {
  const normalized = input.trim();
  if (!normalized) {
    return '네, 어떤 도움을 드릴까요?';
  }
  if (includesAny(normalized, ['안녕', '안녕하세요', '반갑', '좋은 아침', '좋은 하루'])) {
    return '안녕하세요! 어떤 스토리보드를 먼저 만들까요?';
  }
  if (includesAny(normalized, ['고마워', '감사'])) {
    return '천만에요. 더 필요한 게 있으면 바로 요청해 주세요.';
  }
  return '좋습니다. 요청하신 내용을 바탕으로 바로 정리해드릴게요.';
}

async function answerStoryboardQnaWithContext(
  message: string,
  asOf: string,
): Promise<AdminInsightChatResponse | null> {
  const snippets: string[] = [];
  const lower = message.toLowerCase();

  if (includesAny(lower, ['영상', '비디오', '개수', '갯수', '조회', '조회수'])) {
    const topVideos = await getVideoMetadataFilteredTool({
      orderBy: 'view_count',
      limit: 6,
    });
    if (topVideos.length > 0) {
      const ranking = topVideos.map((item, index) => {
        const title = extractText(item.title, '제목 없음');
        const views = extractText(item.view_count, '-');
        return `${index + 1}. ${title} (${views})`;
      }).join('\n');
      snippets.push(`현재 인기 영상 후보(상위):\n${ranking}`);
    }
  }

  const matchedRestaurant = await resolveRestaurantByApprovedNames(lower);
  if (matchedRestaurant) {
    const rows = await searchRestaurantsByNameTool(matchedRestaurant);
    if (rows.length > 0) {
      snippets.push(`승인 상호 '${matchedRestaurant}' 검색 결과: ${rows.length}건`);
    }
  }

  if (!snippets.length) {
    return null;
  }

  return createLocalResponse(asOf, [
    '요청하신 데이터 질의를 내부 기준으로 정리해요.',
    '',
    ...snippets,
    '',
    '원하면 다음 단계로 스토리보드 생성도 바로 이어서 처리할 수 있습니다.',
  ].join('\n'), {
    fallbackReason: 'storyboard_qna_local',
  });
}

function extractStoryboardCategoryHint(message: string): string | null {
  const categories = [
    '한식',
    '분식',
    '치킨',
    '피자',
    '돈까스',
    '국밥',
    '찜',
    '파스타',
    '중식',
    '일식',
    '양식',
    '부대찌개',
    '김치찌개',
    '고기',
    '해산물',
    '국수',
    '떡볶이',
    '마라',
    '제육',
  ];
  return categories.find((category) => message.includes(category)) ?? null;
}

function createStoryboardLlmPrompt(
  input: string,
  profile: StoryboardModelProfile,
  bgeContext: StoryboardBgeResult[] = [],
  stateContext?: {
    transcriptDocs?: StoryboardBgeResult[];
    webDocs?: StoryboardWebSearchResult[];
    metadataDocs?: Record<string, unknown>[];
    stateFeedback?: string;
  },
): string {
  const profileLabel = DEFAULT_STORYBOARD_TEMPLATE_PROFILE[profile];
  const transcriptBlock = buildStoryboardTranscriptContextPrompt(stateContext?.transcriptDocs?.length ? stateContext.transcriptDocs : bgeContext);
  const webBlock = buildStoryboardWebContextPrompt(stateContext?.webDocs ?? []);
  const metaBlock = buildStoryboardVideoMetadataContextPrompt(stateContext?.metadataDocs ?? []);
  const feedbackBlock = stateContext?.stateFeedback ? ['', `### 검증 피드백`, stateContext.stateFeedback] : [];
  return [
    '당신은 \"쯔양 스타일\" 먹방 콘텐츠 전용 스토리보드 생성기입니다.',
    '요청을 받아 실제 제작 가능한 장면 단위 시나리오를 작성해 주세요.',
    `톤/스타일: ${profileLabel}`,
    '',
    '필수 형식:',
    '## [요청 제목] 스토리보드',
    '### 🎬 장면별 구성',
    '| 순서 | 장면 (Visual) | 오디오/자막 (Audio/Sub) | 핵심 포인트 |',
    '|---|---|---|---|',
    '| 1 | ... | ... | ... |',
    '',
    '### 💡 콘텐츠 업그레이드 인사이트',
    '- 운영용 인사이트 3개',
    '',
    ...(transcriptBlock ? [transcriptBlock] : []),
    ...(metaBlock ? [metaBlock] : []),
    ...(webBlock ? [webBlock] : []),
    ...(feedbackBlock ? [feedbackBlock.join('\n')] : []),
    '',
    '요청:',
    input.trim() || '먹방 스토리보드 작성',
    '',
    '요건: 출력은 한국어 마크다운만 사용. HTML 태그는 사용하지 말 것.',
  ].join('\n');
}

async function askStoryboardViaLlm(
  message: string,
  asOf: string,
  storyboardModelProfile: StoryboardModelProfile,
  llmConfig?: LlmRequestConfig,
  bgeContext: StoryboardBgeResult[] = [],
  requestId?: string,
  responseMode: InsightChatResponseMode = 'fast',
  feedbackContext?: InsightChatFeedbackContext,
  toolTrace: string[] = [],
  stateContext?: {
    transcriptDocs?: StoryboardBgeResult[];
    webDocs?: StoryboardWebSearchResult[];
    metadataDocs?: Record<string, unknown>[];
    stateFeedback?: string;
  },
): Promise<AdminInsightChatResponse | null> {
  const provider = llmConfig?.provider || 'gemini';
  const apiKey = llmConfig?.apiKey
    || (llmConfig?.useServerKey && provider === 'gemini' ? GEMINI_API_KEY_ENV : '');
  const model = llmConfig?.model || GEMINI_MODEL_DEFAULT;
  const resolvedResponseMode = normalizeResponseMode(responseMode);
  const responseProfile = resolveResponseModeProfile(resolvedResponseMode);
  if (!apiKey) return null;

  const prompt = createStoryboardLlmPrompt(message, storyboardModelProfile, bgeContext, stateContext);
  const contextSources = stateContext?.transcriptDocs?.length
    ? storyboardSourcesFromBgeResults(stateContext.transcriptDocs)
    : storyboardSourcesFromBgeResults(bgeContext);
  const fallbackSources = contextSources.length
    ? contextSources
    : storyboardSourcesFromBgeResults(stateContext?.transcriptDocs ?? []);

  const askOptions = {
    responseMode: resolvedResponseMode,
    feedbackContext,
    responseProfile,
  } as {
    responseMode: InsightChatResponseMode;
    feedbackContext?: InsightChatFeedbackContext;
    responseProfile?: ResponseModeProfile;
    toolTrace?: string[];
  };

  switch (provider) {
    case 'openai': {
      const response = await askOpenAI(prompt, model, apiKey, asOf, requestId, {
        ...askOptions,
        toolTrace: [...toolTrace, 'provider:openai', `storyboardMode:${resolvedResponseMode}`],
      });
      return response ? {
        ...response,
        meta: {
          ...response.meta,
          ...(requestId ? { requestId } : {}),
          source: 'agent',
          fallbackReason: response.meta?.fallbackReason,
        },
        sources: response.sources?.length ? response.sources : fallbackSources,
      } : null;
    }
    case 'anthropic': {
      const response = await askAnthropic(prompt, model, apiKey, asOf, requestId, {
        ...askOptions,
        toolTrace: [...toolTrace, 'provider:anthropic', `storyboardMode:${resolvedResponseMode}`],
      });
      return response ? {
        ...response,
        meta: {
          ...response.meta,
          ...(requestId ? { requestId } : {}),
          source: 'agent',
          fallbackReason: response.meta?.fallbackReason,
        },
        sources: response.sources?.length ? response.sources : fallbackSources,
      } : null;
    }
    case 'gemini':
    default: {
      const response = await askGemini(prompt, model, apiKey, asOf, requestId, {
        ...askOptions,
        toolTrace: [...toolTrace, 'provider:gemini', `storyboardMode:${resolvedResponseMode}`],
      });
      return response ? {
        ...response,
        meta: {
          ...response.meta,
          ...(requestId ? { requestId } : {}),
          source: 'agent',
          fallbackReason: response.meta?.fallbackReason,
        },
        sources: response.sources?.length ? response.sources : fallbackSources,
      } : null;
    }
  }
}

function createLocalStoryboardResponse(
  message: string,
  asOf: string,
  profile: StoryboardModelProfile,
  requestId?: string,
  memoryMode?: InsightChatMemoryMode,
): AdminInsightChatResponse {
  return createLocalResponse(asOf, buildStoryboardFallbackContent(message, profile), {
    fallbackReason: 'storyboard_internal_fallback',
    ...(requestId ? { requestId } : {}),
    ...(memoryMode ? { memoryMode } : {}),
  });
}

function shouldUseWebSearch(message: string): boolean {
  return includesAny(message, ['트렌드', '유행', '챌린지', 'challenge', 'latest', '최신', '핵심', '바이럴']);
}

function buildRetryQuery(baseMessage: string, attempt: number): string {
  const variants = ['씬 구성', '오프닝/클로징', '촬영 연출', '콘텐츠 톤'];
  const suffix = variants[Math.max(0, attempt - 1) % variants.length];
  return `${baseMessage} ${suffix}`.trim();
}

function buildStoryboardSourcesFromState(state: StoryboardAgentState): InsightChatSource[] {
  const fromTranscripts = storyboardSourcesFromBgeResults(state.transcriptDocs || []);
  const fromMetadata = storyboardSourcesFromMetadata(state.videoMetadataDocs || []);
  const hasYoutubeLinks = fromTranscripts.filter((source) => source.youtubeLink).slice(0, 12);
  if (hasYoutubeLinks.length) {
    return hasYoutubeLinks;
  }
  if (fromMetadata.length) {
    return fromMetadata.slice(0, 12);
  }
  return state.webDocs.slice(0, 6).map((doc) => ({
    videoTitle: doc.title || '웹 레퍼런스',
    youtubeLink: doc.url || '',
    timestamp: '-',
    text: doc.snippet || doc.content || doc.text || '',
  }));
}

function validateStoryboardState(state: StoryboardAgentState): { status: StoryboardAgentState['validationStatus']; feedback: string } {
  const transcriptCount = state.transcriptDocs.length;
  const captionCount = state.transcriptDocs.filter((item) => {
    return extractTranscriptCaption(item).length > 0;
  }).length;
  const webEvidenceCount = state.webDocs.length;
  const evidenceScore = captionCount + webEvidenceCount;
  const maxRetries = clampOrchestratorRetryCount(STORYBOARD_ORCHESTRATOR_MAX_RETRIES);

  if (captionCount >= 3) {
    return { status: 'pass', feedback: '캡션/시각 근거가 충분합니다.' };
  }
  if (evidenceScore >= 3 && transcriptCount > 0) {
    return {
      status: 'pass',
      feedback: '캡션 + 웹 레퍼런스로 스토리보드 생성 기준을 충족합니다.',
    };
  }
  if (state.retryCount >= maxRetries) {
    return { status: 'need_human', feedback: `재시도 ${state.retryCount}회 후에도 근거가 부족합니다.` };
  }
  return {
    status: 'fail',
    feedback:
      transcriptCount === 0
        ? '스토리보드에 활용할 자막 근거를 찾지 못했습니다.'
        : `현재 근거 ${transcriptCount}개(캡션 ${captionCount}개), 웹 레퍼런스 ${webEvidenceCount}개로 부족합니다.`,
  };
}

async function resolveRestaurantByApprovedNames(message: string): Promise<string | null> {
  const names = await getAllApprovedRestaurantNamesTool();
  const lower = message.toLowerCase();
  const found = names.find((name) => lower.includes(name.toLowerCase()));
  return found ?? null;
}

async function runStoryboardOrchestrator(
  message: string,
  asOf: string,
  profile: StoryboardModelProfile,
  bgeContext: StoryboardBgeResult[],
  llmConfig?: LlmRequestConfig,
  requestId?: string,
  responseMode: InsightChatResponseMode = 'fast',
  feedbackContext?: InsightChatFeedbackContext,
  toolTrace: string[] = [],
): Promise<AdminInsightChatResponse> {
  const initialQuery = message.trim();
  const normalizedIntent = normalizeStoryboardAgentIntent(initialQuery);
  const webLookupEnabled = STORYBOARD_WEB_SEARCH_ENABLED && STORYBOARD_WEB_SEARCH_URL;
  const restaurantHint = await resolveRestaurantByApprovedNames(initialQuery);
  const isPopularityIntent = includesAny(initialQuery, ['인기', '조회수', '최고', '조회']);
  const categoryHint = extractStoryboardCategoryHint(initialQuery);
  const state: StoryboardAgentState = {
    intent: normalizedIntent,
    loopCount: 0,
    retryCount: 0,
    previousQueries: [],
    validationStatus: 'pending',
    validationFeedback: '',
    activeQuery: initialQuery,
    transcriptDocs: [...bgeContext],
    webDocs: [],
    videoMetadataDocs: [],
    candidateVideoIds: [],
  };

  const normalizedResponseMode = normalizeResponseMode(responseMode);
  const profileTrace = [...toolTrace, `responseMode:${normalizedResponseMode}`];

  if (isPopularityIntent && state.videoMetadataDocs.length === 0) {
    state.videoMetadataDocs = await getVideoMetadataFilteredTool({
      minViewCount: 0,
      limit: 6,
      orderBy: 'view_count',
    });
    if (state.videoMetadataDocs.length > 0) {
      state.candidateVideoIds = extractVideoIdsFromRecords(state.videoMetadataDocs as Record<string, unknown>[]);
      state.validationFeedback = '인기 영상 기준으로 후보를 확보했습니다.';
    }
  }

  if (webLookupEnabled && shouldUseWebSearch(initialQuery)) {
    state.webDocs = await searchWebTool(`${initialQuery} 먹방`);
  }

  if (restaurantHint) {
    const restaurantDocs = await searchRestaurantsByNameTool(restaurantHint);
    if (restaurantDocs.length) {
      const restaurantIds = extractVideoIdsFromRecords(restaurantDocs);
      state.candidateVideoIds = dedupeStrings([...state.candidateVideoIds, ...restaurantIds]);
      state.validationFeedback = `식당 '${restaurantHint}' 관련 후보를 확보했습니다.`;

      const categoriesByRestaurant = await getCategoriesByRestaurantTool({ restaurant_name: restaurantHint });
      for (const category of categoriesByRestaurant.slice(0, 3)) {
        const rowsByCategory = await getRestaurantsByCategoryTool(category);
        state.candidateVideoIds = dedupeStrings([
          ...state.candidateVideoIds,
          ...extractVideoIdsFromRecords(rowsByCategory),
        ]);
      }
    }
  }

  if (normalizedIntent === 'storyboard' && categoryHint) {
    const restaurantRowsByCategory = await getRestaurantsByCategoryTool(categoryHint);
    state.candidateVideoIds = dedupeStrings([
      ...state.candidateVideoIds,
      ...extractVideoIdsFromRecords(restaurantRowsByCategory),
    ]);
    if (restaurantRowsByCategory.length > 0) {
      state.validationFeedback = `카테고리 '${categoryHint}' 관련 후보를 확보했습니다.`;
    }
  }

  if (state.candidateVideoIds.length > 0) {
    const seededTranscripts = await searchTranscriptsHybridTool(initialQuery, {
      maxCount: clampPositiveInteger(STORYBOARD_BGE_MATCH_COUNT, 8),
      videoIds: state.candidateVideoIds,
    });
    if (seededTranscripts.length > 0) {
      state.transcriptDocs = dedupeBgeResults([...state.transcriptDocs, ...seededTranscripts]);
    }
  }

  const maxLoops = clampPositiveInteger(STORYBOARD_ORCHESTRATOR_MAX_RETRIES, 3);

  while (state.loopCount < maxLoops && state.validationStatus !== 'pass') {
    if (state.previousQueries.length > 3) {
      break;
    }

    const query = state.previousQueries.includes(initialQuery)
      ? buildRetryQuery(initialQuery, state.loopCount + 1)
      : initialQuery;
    state.activeQuery = query;
    if (!state.previousQueries.includes(query)) {
      state.previousQueries.push(query);
    }
    state.loopCount += 1;

    const searchHints = await searchVideoIdsByQueryTool(query);
    if (searchHints.length > 0 && state.validationFeedback === '') {
      state.validationFeedback = `영상 ID 검색 완료: ${searchHints.length}건`;
    }
    state.candidateVideoIds = dedupeStrings([
      ...state.candidateVideoIds,
      ...searchHints.map((item) => item.video_id),
    ]);

    const transcripts = await searchTranscriptsHybridTool(query, {
      maxCount: clampPositiveInteger(STORYBOARD_BGE_MATCH_COUNT, 8),
      videoIds: state.candidateVideoIds,
    });
    if (transcripts.length) {
      state.transcriptDocs = dedupeBgeResults([...state.transcriptDocs, ...transcripts]);
    }

    if (webLookupEnabled && shouldUseWebSearch(query) && state.webDocs.length === 0) {
      state.webDocs = await searchWebTool(`${query} 먹방`);
    }

    if (isPopularityIntent && state.videoMetadataDocs.length === 0) {
      state.videoMetadataDocs = await getVideoMetadataFilteredTool({
        orderBy: 'view_count',
        limit: 5,
      });
    }

    const validation = validateStoryboardState(state);
    state.validationStatus = validation.status;
    state.validationFeedback = validation.feedback;

    if (state.validationStatus === 'pass') {
      break;
    }
    if (state.validationStatus === 'need_human') {
      return createLocalResponse(asOf, buildStoryboardHumanRequest(state), {
        sources: buildStoryboardSourcesFromState(state),
        fallbackReason: 'storyboard_need_human',
        ...(requestId ? { requestId } : {}),
        responseMode: normalizedResponseMode,
        confidence: 0.45,
        toolTrace: [...toolTrace, 'route:storyboard', 'human-fallback'],
      });
    }

    state.retryCount += 1;
  }

  const responseSources = buildStoryboardSourcesFromState(state);
  if (state.validationStatus !== 'pass' && state.transcriptDocs.length === 0) {
    const fallback = createLocalResponse(asOf, buildStoryboardFallbackContent(initialQuery, profile), {
      sources: responseSources,
      fallbackReason: state.validationStatus === 'need_human' ? 'storyboard_need_human' : 'storyboard_internal_fallback',
      ...(requestId ? { requestId } : {}),
      responseMode: normalizedResponseMode,
      confidence: 0.46,
      toolTrace: [...toolTrace, 'route:storyboard', `validation:${state.validationStatus}`],
    });
    return fallback;
  }

  const llmResponse = await askStoryboardViaLlm(
    initialQuery,
    asOf,
    profile,
    llmConfig,
    state.transcriptDocs.slice(0, 10),
    requestId,
    normalizedResponseMode,
    feedbackContext,
    [...profileTrace, 'route:storyboard'],
    {
      transcriptDocs: state.transcriptDocs,
      webDocs: state.webDocs,
      metadataDocs: state.videoMetadataDocs,
      stateFeedback: state.validationFeedback,
    },
  );
  if (llmResponse) {
    if (!(llmResponse.sources?.length) && responseSources.length) {
      llmResponse.sources = responseSources;
    }
    return llmResponse;
  }

  const localFallback = createLocalResponse(asOf, buildStoryboardFallbackContent(initialQuery, profile), {
    sources: responseSources,
    fallbackReason: 'storyboard_local_fallback',
    ...(requestId ? { requestId } : {}),
  });
  return localFallback;
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
  llmConfig?: LlmRequestConfig,
  requestId?: string,
  responseMode: InsightChatResponseMode = 'fast',
  memoryMode?: InsightChatMemoryMode,
  feedbackContext?: InsightChatFeedbackContext,
  toolTrace: string[] = [],
): Promise<AdminInsightChatResponse | null> {
  const normalizedResponseMode = normalizeResponseMode(responseMode);
  const normalizedMemoryMode = normalizeMemoryMode(memoryMode);
  const profileTrace = [...toolTrace, `responseMode:${normalizedResponseMode}`];
  const normalizedProfile = storyboardModelProfile === 'nanobanana_pro' ? 'nanobanana_pro' : 'nanobanana';
  const fallbackProfile = normalizedProfile;
  const intent = normalizeStoryboardAgentIntent(message);

  if (intent === 'simple_chat') {
    return createLocalResponse(asOf, buildStoryboardSimpleChatResponse(message), {
      fallbackReason: 'storyboard_simple_chat',
      ...(requestId ? { requestId } : {}),
      responseMode: normalizedResponseMode,
      ...(normalizedMemoryMode ? { memoryMode: normalizedMemoryMode } : {}),
      confidence: 0.48,
      toolTrace: [...profileTrace, 'route:storyboard', 'bootstrap-human-request'],
    });
  }

  if (intent === 'qna_about_data') {
    const qnaReply = await answerStoryboardQnaWithContext(message, asOf);
    if (qnaReply) {
      return normalizedMemoryMode
        ? {
            ...qnaReply,
            meta: {
              ...(qnaReply.meta ?? { source: 'local' }),
              memoryMode: normalizedMemoryMode,
            },
          }
        : qnaReply;
    }
    return createLocalResponse(asOf, '데이터 질의는 현재 수집 가능한 항목 기반으로만 답변 가능합니다. 상호명/영상/조회와 같은 구체 키워드로 다시 질문해 주세요.', {
      fallbackReason: 'storyboard_qna_unavailable',
      ...(requestId ? { requestId } : {}),
      ...(normalizedMemoryMode ? { memoryMode: normalizedMemoryMode } : {}),
    });
  }

  const bgeContext = await getStoryboardBgeContext(message);
  try {
      const orchestratedResponse = await runStoryboardOrchestrator(
      message,
      asOf,
      fallbackProfile,
      bgeContext,
      llmConfig,
      requestId,
      responseMode,
      feedbackContext,
      [...profileTrace, 'route:storyboard'],
    );
      if (orchestratedResponse) {
        return normalizedMemoryMode
          ? {
            ...orchestratedResponse,
            meta: {
              ...(orchestratedResponse.meta ?? { source: 'agent' }),
              memoryMode: normalizedMemoryMode,
            },
          }
          : orchestratedResponse;
      }
  } catch (error) {
    console.error('[admin/insight/chat] storyboard orchestrator failed:', error);
  }

  const endpoint = STORYBOARD_AGENT_REMOTE_ENABLED ? getStoryboardAgentEndpoint() : null;
  if (!endpoint) {
    const fallbackResponse = createLocalStoryboardResponse(message, asOf, fallbackProfile, requestId, normalizedMemoryMode);
    return bgeContext.length > 0
      ? { ...fallbackResponse, sources: storyboardSourcesFromBgeResults(bgeContext) }
      : fallbackResponse;
  }

  const cooldownUntil = getStoryboardEndpointCooldownUntil(endpoint);
  if (cooldownUntil) {
    return createStoryboardUnavailableResponse(asOf, requestId, normalizedMemoryMode);
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
        const fallbackResponse = createLocalStoryboardResponse(message, asOf, fallbackProfile, requestId, normalizedMemoryMode);
        if (bgeContext.length > 0) {
          return {
            ...fallbackResponse,
            sources: storyboardSourcesFromBgeResults(bgeContext),
          };
        }
        return fallbackResponse;
      }

      const remoteResponse: AdminInsightChatResponse = {
        asOf,
        content,
        sources: toStoryboardSources(data),
        meta: {
          source: 'agent',
          ...(requestId ? { requestId } : {}),
          ...(normalizedMemoryMode ? { memoryMode: normalizedMemoryMode } : {}),
        },
      };
      if (!(remoteResponse.sources?.length) && bgeContext.length > 0) {
        remoteResponse.sources = storyboardSourcesFromBgeResults(bgeContext);
      }
      return remoteResponse;
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
        return createStoryboardUnavailableResponse(asOf, requestId, normalizedMemoryMode);
      }

      console.error('[admin/insight/chat] storyboard agent request failed:', error);
      const fallbackResponse = createLocalStoryboardResponse(message, asOf, fallbackProfile, requestId, normalizedMemoryMode);
      if (bgeContext.length > 0) {
        return {
          ...fallbackResponse,
          sources: storyboardSourcesFromBgeResults(bgeContext),
        };
      }
      return fallbackResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  const finalFallback = createLocalStoryboardResponse(message, asOf, fallbackProfile, requestId, normalizedMemoryMode);
  if (bgeContext.length > 0) {
    return {
      ...finalFallback,
      sources: storyboardSourcesFromBgeResults(bgeContext),
    };
  }
  return finalFallback;
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
    '',
    '**📊 데이터 시각화**',
    '- "트리맵으로 조회수 분포 보여줘"',
    '- "카테고리별 영상 분포 분석해줘"',
    '- "최근 1개월 증감률 트리맵 보여줘"',
    '',
    '**📈 채널 분석**',
    '- "최근 조회수 상위 영상 알려줘"',
    '- "대시보드 현황 요약해줘"',
    '',
    '**🎬 콘텐츠 기획**',
    '- "먹방 스토리보드 기획안 만들어줘"',
    '- "인기 영상 트렌드 분석해줘"',
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
  requestId?: string,
  responseMode: InsightChatResponseMode = 'fast',
  memoryMode?: InsightChatMemoryMode,
  feedbackContext?: InsightChatFeedbackContext,
  attachments?: InsightChatAttachment[],
  contextMessages?: InsightChatContextMessage[],
): Promise<AdminInsightChatResponse> {
  const asOf = new Date().toISOString();
  const input = message.trim();
  const resolvedRequestId = normalizeRequestId(requestId);
  const normalizedMemoryMode = normalizeMemoryMode(memoryMode);
  const profile = resolveResponseModeProfile(responseMode);
  const toolTrace = [
    `responseMode:${normalizeResponseMode(responseMode)}`,
    ...(normalizedMemoryMode ? [`memoryMode:${normalizedMemoryMode}`] : []),
    'flow:non-stream',
  ];

  if (!input) {
    return createLocalResponse(asOf, '질문을 입력해 주세요.', {
      fallbackReason: 'empty_input',
      requestId: resolvedRequestId,
      memoryMode: normalizedMemoryMode,
      responseMode,
      toolTrace,
      confidence: 0.85,
    });
  }

  const localResponse = await resolveLocalInsightResponse(
    asOf,
    input,
    resolvedRequestId,
    responseMode,
    normalizedMemoryMode,
    feedbackContext,
    toolTrace,
  );
  if (localResponse) return localResponse;

  if (isStoryboardIntent(input)) {
    const storyboardProfile = resolveStoryboardImageProfile(llmConfig);
    const storyboardReply = await askStoryboardAgent(
      input,
      asOf,
      storyboardProfile,
      llmConfig,
      resolvedRequestId,
      responseMode,
      normalizedMemoryMode,
      feedbackContext,
      [...toolTrace, 'route:storyboard'],
    );
    if (storyboardReply) return storyboardReply;
  }

    const llmReply = await routeLlmRequest(
      input,
      asOf,
      llmConfig,
      resolvedRequestId,
      responseMode,
      normalizedMemoryMode,
      feedbackContext,
      attachments,
      contextMessages,
      [...toolTrace, `provider:${llmConfig?.provider ?? 'gemini'}`],
    );
  if (llmReply) return llmReply;

  return createLocalResponse(asOf, buildLocalInsightResponseFailureMessage('llm_unavailable'), {
    fallbackReason: 'llm_unavailable',
    requestId: resolvedRequestId,
    memoryMode: normalizedMemoryMode,
    responseMode,
    toolTrace: [...toolTrace, 'provider-unavailable'],
    confidence: 0.35,
  });
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

async function resolveLocalInsightResponse(
  asOf: string,
  input: string,
  requestId?: string,
  responseMode: InsightChatResponseMode = 'fast',
  memoryMode?: InsightChatMemoryMode,
  feedbackContext?: InsightChatFeedbackContext,
  toolTrace: string[] = [],
): Promise<AdminInsightChatResponse | null> {
  const normalizedMemoryMode = normalizeMemoryMode(memoryMode);

  if (isStoryboardIntent(input)) {
    return null;
  }

  if (isWordcloudQuery(input)) {
    const data = await withCachedQuery('admin-insight-wordcloud', cacheTtl, () => getAdminInsightWordcloud(false));
    const list = data.keywords
      .slice(0, 12)
      .map((k, idx) => `${idx + 1}. **${k.keyword}** (${k.count})`)
      .join('\n');

    return createLocalResponse(asOf, `## 인기 키워드 TOP 12\n\n${list || '- 데이터 없음'}`, {
      requestId,
      memoryMode: normalizedMemoryMode,
      visualComponent: 'wordcloud',
      responseMode,
      confidence: 0.96,
      toolTrace: [...toolTrace, 'local:wordcloud'],
    });
  }

  if (includesAny(input, ['시즌', '캘린더', 'calendar', '이번달', '다음달', '월별'])) {
    const data = await withCachedQuery('admin-insight-season', cacheTtl, () => getAdminInsightSeason(false));
    const month = new Date().getUTCMonth() + 1;
    const monthData = data.months.find((m) => m.month === month);
    const list = monthData?.keywords
      ?.slice(0, 6)
      .map((k) => `- ${k.icon} **${k.keyword}** (피크: ${k.peakWeek}, 업로드 추천: ${k.recommendedUploadDate})`)
      .join('\n');

    return createLocalResponse(asOf, `## ${month}월 시즌 키워드\n\n${list || '- 데이터 없음'}`, {
      requestId,
      memoryMode: normalizedMemoryMode,
      visualComponent: 'calendar',
      responseMode,
      confidence: 0.93,
      toolTrace: [...toolTrace, 'local:season'],
    });
  }

  if (isTreemapQuery(input)) {
    const data = await withCachedQuery('admin-insight-treemap-all-views', cacheTtl, () => getInsightTreemapData('ALL', {
      filterByPeriod: true,
      metricMode: 'views',
    }));

    const totalViews = data.videos.reduce((acc, video) => acc + Math.max(0, video.viewCount), 0);
    const totalLikes = data.videos.reduce((acc, video) => acc + Math.max(0, video.likeCount), 0);
    const totalComments = data.videos.reduce((acc, video) => acc + Math.max(0, video.commentCount), 0);
    const topRows = data.videos
      .map((video) => ({
        ...video,
        metricRaw: Math.max(0, video.viewCount),
      }))
      .filter((video) => video.metricRaw > 0)
      .sort((a, b) => b.metricRaw - a.metricRaw)
      .slice(0, 12)
      .map((video, idx) =>
        `- ${idx + 1}. **${video.title}** (${video.metricRaw.toLocaleString()}회 조회, 좋아요 ${Math.max(0, video.likeCount).toLocaleString()}, 댓글 ${Math.max(0, video.commentCount).toLocaleString()})`
      );

    const categoryTotals = new Map<string, number>();
    for (const video of data.videos) {
      const value = Math.max(0, video.viewCount);
      if (value <= 0) continue;
      categoryTotals.set(video.category, (categoryTotals.get(video.category) || 0) + value);
    }

    const topCategories = [...categoryTotals.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([category, total], idx) => `- ${idx + 1}. ${category}: ${Math.round(total).toLocaleString()}회`);

    return createLocalResponse(asOf, [
      '## 트리맵 분석 요약',
      '',
      `- 전체 영상: **${data.totalVideos}개**`,
      `- 누적 조회수: **${Math.round(totalViews).toLocaleString()}회**`,
      `- 누적 좋아요: **${Math.round(totalLikes).toLocaleString()}개**`,
      `- 누적 댓글: **${Math.round(totalComments).toLocaleString()}개**`,
      '',
      '### 상위 영상 (조회수 기준)',
      ...(topRows.length > 0 ? topRows : ['- 데이터가 없습니다.']),
      '',
      '### 상위 카테고리',
      ...(topCategories.length > 0 ? topCategories : ['- 데이터가 없습니다.']),
      '',
      '> 아래 트리맵에서 **지표·기간·모드**를 자유롭게 전환하여 분석할 수 있습니다.',
    ].join('\n'), {
      requestId,
      visualComponent: 'treemap',
      memoryMode: normalizedMemoryMode,
      responseMode,
      confidence: 0.95,
      toolTrace: [...toolTrace, 'local:treemap'],
    });
  }

  return null;
}

async function routeLlmRequest(
  message: string,
  asOf: string,
  config?: LlmRequestConfig,
  requestId?: string,
  responseMode: InsightChatResponseMode = 'fast',
  memoryMode?: InsightChatMemoryMode,
  feedbackContext?: InsightChatFeedbackContext,
  attachments?: InsightChatAttachment[],
  contextMessages?: InsightChatContextMessage[],
  toolTrace: string[] = [],
): Promise<AdminInsightChatResponse | null> {
  const provider = config?.provider || 'gemini';
  const apiKey = config?.apiKey || (config?.useServerKey && provider === 'gemini' ? GEMINI_API_KEY_ENV : '');
  const model = config?.model || GEMINI_MODEL_DEFAULT;
  const resolvedResponseMode = normalizeResponseMode(responseMode);
  const normalizedMemoryMode = normalizeMemoryMode(memoryMode);
  const profile = resolveResponseModeProfile(resolvedResponseMode);

  if (!apiKey) return null;

  switch (provider) {
    case 'gemini':
      return askGemini(message, model, apiKey, asOf, requestId, {
        responseMode: resolvedResponseMode,
        feedbackContext,
        attachments,
        contextMessages,
        memoryMode: normalizedMemoryMode,
        toolTrace: [...toolTrace, 'provider:gemini'],
        responseProfile: profile,
      });
    case 'openai':
      return askOpenAI(message, model, apiKey, asOf, requestId, {
        responseMode: resolvedResponseMode,
        feedbackContext,
        attachments,
        contextMessages,
        memoryMode: normalizedMemoryMode,
        toolTrace: [...toolTrace, 'provider:openai'],
        responseProfile: profile,
      });
    case 'anthropic':
      return askAnthropic(message, model, apiKey, asOf, requestId, {
        responseMode: resolvedResponseMode,
        feedbackContext,
        attachments,
        contextMessages,
        memoryMode: normalizedMemoryMode,
        toolTrace: [...toolTrace, 'provider:anthropic'],
        responseProfile: profile,
      });
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
  requestSignal?: AbortSignal,
  requestId?: string,
  responseMode: InsightChatResponseMode = 'fast',
  memoryMode?: InsightChatMemoryMode,
  feedbackContext?: InsightChatFeedbackContext,
  attachments?: InsightChatAttachment[],
  contextMessages?: InsightChatContextMessage[],
): Promise<{ stream: ReadableStream<Uint8Array> } | { local: AdminInsightChatResponse }> {
  const resolvedRequestId = normalizeRequestId(requestId);
  const resolvedResponseMode = normalizeResponseMode(responseMode);
  const normalizedMemoryMode = normalizeMemoryMode(memoryMode);
  const profile = resolveResponseModeProfile(resolvedResponseMode);
  const toolTrace = [
    `responseMode:${resolvedResponseMode}`,
    ...(normalizedMemoryMode ? [`memoryMode:${normalizedMemoryMode}`] : []),
    `provider:${llmConfig?.provider ?? 'gemini'}`,
    'flow:stream',
  ];
  const localTrace = [...toolTrace, 'stream:local-fallback'];
  const localProfile = [...toolTrace, 'stream:api-call'];

  const localResult = await tryLocalAnswer(
    message,
    llmConfig,
    resolvedRequestId,
    resolvedResponseMode,
    normalizedMemoryMode,
    feedbackContext,
    localTrace,
  );
  if (localResult) return { local: localResult };

  const provider = llmConfig?.provider || 'gemini';
  const apiKey = llmConfig?.apiKey || (llmConfig?.useServerKey && provider === 'gemini' ? GEMINI_API_KEY_ENV : '');
  const model = llmConfig?.model || GEMINI_MODEL_DEFAULT;

  if (!apiKey) {
      return {
        local: createLocalResponse(new Date().toISOString(), [
        '가능한 질문 예시:',
        '- "트리맵으로 조회수 분포 보여줘"',
        '- "먹방 스토리보드 기획안 만들어줘"',
        ].join('\n'), {
          fallbackReason: 'llm_unavailable',
          requestId: resolvedRequestId,
          memoryMode: normalizedMemoryMode,
          responseMode: resolvedResponseMode,
          confidence: 0.52,
          toolTrace: [...toolTrace, 'provider-unavailable'],
      }),
    };
  }

  const stream = createLlmStream(
    message,
    provider,
    model,
    apiKey,
    resolvedResponseMode,
    responseMode,
    profile,
    normalizedMemoryMode,
    feedbackContext,
    attachments,
    contextMessages,
    toolTrace,
    localProfile,
    resolvedRequestId,
    requestSignal,
  );
  return { stream };
}

async function tryLocalAnswer(
  message: string,
  llmConfig?: LlmRequestConfig,
  requestId?: string,
  responseMode: InsightChatResponseMode = 'fast',
  memoryMode?: InsightChatMemoryMode,
  feedbackContext?: InsightChatFeedbackContext,
  toolTrace: string[] = [],
): Promise<AdminInsightChatResponse | null> {
  const normalizedMemoryMode = normalizeMemoryMode(memoryMode);
  const asOf = new Date().toISOString();
  const input = message.trim();
  if (!input) return createLocalResponse(asOf, '질문을 입력해 주세요.', {
    fallbackReason: 'empty_input',
    requestId,
    memoryMode: normalizedMemoryMode,
    responseMode,
    confidence: 0.85,
    toolTrace,
  });

  if (isStoryboardIntent(input)) {
    const storyboardProfile = resolveStoryboardImageProfile(llmConfig);
    const reply = await askStoryboardAgent(
      input,
      asOf,
      storyboardProfile,
      llmConfig,
      requestId,
      responseMode,
      normalizedMemoryMode,
      feedbackContext,
      [...toolTrace, 'route:storyboard'],
    );
    if (reply) return reply;
  }

  return resolveLocalInsightResponse(
    asOf,
    input,
    requestId,
    responseMode,
    normalizedMemoryMode,
    feedbackContext,
    [...toolTrace, 'route:local'],
  );
}

function createLlmStream(
  message: string,
  provider: string,
  model: string,
  apiKey: string,
  responseMode: InsightChatResponseMode,
  rawResponseMode: InsightChatResponseMode,
  responseProfile: ResponseModeProfile,
  memoryMode: InsightChatMemoryMode | undefined,
  feedbackContext: InsightChatFeedbackContext | undefined,
  attachments: InsightChatAttachment[] | undefined,
  contextMessages: InsightChatContextMessage[] | undefined,
  toolTrace: string[],
  tokenDebugTrace: string[],
  requestId?: string,
  requestSignal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const profile = responseProfile ?? resolveResponseModeProfile(responseMode);
  const safeModePrompt = profile.promptAddendum;
  const normalizedMemoryMode = normalizeMemoryMode(memoryMode);
  const response = buildPromptWithContext(
    message,
    responseMode,
    feedbackContext,
    attachments,
    normalizedMemoryMode,
    contextMessages,
  );
  const tracedTool = [
    ...toolTrace,
    `responseMode:${normalizeResponseMode(rawResponseMode)}`,
    ...(normalizedMemoryMode ? [`memoryMode:${normalizedMemoryMode}`] : []),
    `maxTokens:${profile.maxOutputTokens}`,
    `temperature:${profile.temperature}`,
    ...tokenDebugTrace,
  ];
  return new ReadableStream({
    async start(ctrl) {
      try {
        switch (provider) {
          case 'gemini':
            await streamGemini(
              response.message,
              model,
              apiKey,
              safeModePrompt,
              profile,
              tracedTool,
              ctrl,
              encoder,
              requestId,
              requestSignal,
            );
            break;
          case 'openai':
            await streamOpenAI(
              response.message,
              model,
              apiKey,
              safeModePrompt,
              profile,
              tracedTool,
              ctrl,
              encoder,
              requestId,
              requestSignal,
            );
            break;
          case 'anthropic':
            await streamAnthropic(
              response.message,
              model,
              apiKey,
              safeModePrompt,
              profile,
              tracedTool,
              ctrl,
              encoder,
              requestId,
              requestSignal,
            );
            break;
          default:
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({
              error: 'unknown_provider',
              requestId,
              cancellationReason: 'stream_error',
            })}\n\n`));
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'stream_error';
        const cancellationReason = requestSignal?.aborted || (error instanceof DOMException && error.name === 'AbortError')
          ? 'request_cancelled'
          : 'stream_error';
        try {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({
            error: errMsg,
            requestId,
            cancellationReason,
          })}\n\n`));
        } catch { /* closed */ }
      } finally {
        try { ctrl.enqueue(encoder.encode('data: [DONE]\n\n')); } catch { /* closed */ }
        ctrl.close();
      }
    },
  });
}

async function streamGemini(
  message: string,
  model: string,
  apiKey: string,
  responsePromptAddon: string,
  profile: ResponseModeProfile,
  toolTrace: string[],
  ctrl: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder,
  requestId?: string,
  requestSignal?: AbortSignal,
) {
  const parseSseLinePayload = (line: string): string | undefined => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return undefined;
    const payload = trimmed.slice(5).trimStart();
    if (!payload || payload === '[DONE]') return undefined;
    return payload;
  };

  const toolTraceLabel = toolTrace.join(' > ');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
  const onAbort = () => {
    ac.abort();
  };
  if (requestSignal?.aborted) {
    ac.abort();
  } else if (requestSignal) {
    requestSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const resp = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: LLM_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: `${LLM_SYSTEM_PROMPT}\n\n${responsePromptAddon}\n\n${message}` }] }],
        generationConfig: { maxOutputTokens: profile.maxOutputTokens, temperature: profile.temperature },
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
        const js = parseSseLinePayload(line);
        if (!js) continue;
        try {
        const p = JSON.parse(js);
          const t = p?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (typeof t === 'string' && t) {
            if (toolTraceLabel) {
              ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ text: ``, requestId, toolTrace: toolTraceLabel })}\n\n`));
            }
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ text: t, requestId })}\n\n`));
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    clearTimeout(timer);
    if (requestSignal) {
      requestSignal.removeEventListener('abort', onAbort);
    }
  }
}

async function streamOpenAI(
  message: string, model: string, apiKey: string,
  responsePromptAddon: string,
  profile: ResponseModeProfile,
  toolTrace: string[],
  ctrl: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder,
  requestId?: string,
  requestSignal?: AbortSignal,
) {
  const toolTraceLabel = toolTrace.join(' > ');
  const parseSseLinePayload = (line: string): string | undefined => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return undefined;
    const payload = trimmed.slice(5).trimStart();
    if (!payload || payload === '[DONE]') return undefined;
    return payload;
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
  const onAbort = () => {
    ac.abort();
  };
  if (requestSignal?.aborted) {
    ac.abort();
  } else if (requestSignal) {
    requestSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: profile.maxOutputTokens,
        temperature: profile.temperature,
        stream: true,
        messages: [{ role: 'system', content: `${LLM_SYSTEM_PROMPT}\n\n${responsePromptAddon}` }, { role: 'user', content: message }],
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
        const js = parseSseLinePayload(line);
        if (!js) continue;
        try {
          const p = JSON.parse(js);
          const t = p?.choices?.[0]?.delta?.content;
          if (typeof t === 'string' && t) {
            if (toolTraceLabel) {
              ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ text: '', requestId, toolTrace: toolTraceLabel })}\n\n`));
            }
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ text: t, requestId })}\n\n`));
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    clearTimeout(timer);
    if (requestSignal) {
      requestSignal.removeEventListener('abort', onAbort);
    }
  }
}

async function streamAnthropic(
  message: string, model: string, apiKey: string,
  responsePromptAddon: string,
  profile: ResponseModeProfile,
  toolTrace: string[],
  ctrl: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder,
  requestId?: string,
  requestSignal?: AbortSignal,
) {
  const toolTraceLabel = toolTrace.join(' > ');
  const parseSseLinePayload = (line: string): string | undefined => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return undefined;
    const payload = trimmed.slice(5).trimStart();
    if (!payload || payload === '[DONE]') return undefined;
    return payload;
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
  const onAbort = () => {
    ac.abort();
  };
  if (requestSignal?.aborted) {
    ac.abort();
  } else if (requestSignal) {
    requestSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: profile.maxOutputTokens,
        temperature: profile.temperature,
        system: `${LLM_SYSTEM_PROMPT}\n\n${responsePromptAddon}`,
        stream: true,
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
        const js = parseSseLinePayload(line);
        if (!js) continue;
        try {
          const p = JSON.parse(js);
          if (p?.type === 'content_block_delta' && p?.delta?.text) {
            if (toolTraceLabel) {
              ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ text: '', requestId, toolTrace: toolTraceLabel })}\n\n`));
            }
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({
              text: p.delta.text,
              requestId,
            })}\n\n`));
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    clearTimeout(timer);
    if (requestSignal) {
      requestSignal.removeEventListener('abort', onAbort);
    }
  }
}

async function askGemini(
  message: string,
  model: string,
  apiKey: string,
  asOf: string,
  requestId?: string,
  options?: {
    responseMode?: InsightChatResponseMode;
    memoryMode?: InsightChatMemoryMode;
    feedbackContext?: InsightChatFeedbackContext;
    attachments?: InsightChatAttachment[];
    contextMessages?: InsightChatContextMessage[];
    toolTrace?: string[];
    responseProfile?: ResponseModeProfile;
  },
): Promise<AdminInsightChatResponse | null> {
  const responseMode = normalizeResponseMode(options?.responseMode);
  const profile = options?.responseProfile ?? resolveResponseModeProfile(responseMode);
  const payload = buildPromptWithContext(
    message,
    responseMode,
    options?.feedbackContext,
    options?.attachments,
    options?.memoryMode,
    options?.contextMessages,
  );
  const toolTrace = [...(options?.toolTrace ?? []), `llm:gemini`, `responseMode:${responseMode}`];
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, LLM_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: `${LLM_SYSTEM_PROMPT}\n\n${profile.promptAddendum}` }] },
        contents: [{ role: 'user', parts: [{ text: payload.message }] }],
        generationConfig: { maxOutputTokens: profile.maxOutputTokens, temperature: profile.temperature },
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
      meta: {
        source: 'gemini',
        model,
        ...(options?.memoryMode ? { memoryMode: options.memoryMode } : {}),
        responseMode,
        confidence: clampFiniteFloat(profile.confidenceBase, 0.77),
        toolTrace,
        ...(requestId ? { requestId } : {}),
      },
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
  requestId?: string,
  options?: {
    responseMode?: InsightChatResponseMode;
    memoryMode?: InsightChatMemoryMode;
    feedbackContext?: InsightChatFeedbackContext;
    attachments?: InsightChatAttachment[];
    contextMessages?: InsightChatContextMessage[];
    toolTrace?: string[];
    responseProfile?: ResponseModeProfile;
  },
): Promise<AdminInsightChatResponse | null> {
  const responseMode = normalizeResponseMode(options?.responseMode);
  const profile = options?.responseProfile ?? resolveResponseModeProfile(responseMode);
  const payload = buildPromptWithContext(
    message,
    responseMode,
    options?.feedbackContext,
    options?.attachments,
    options?.memoryMode,
    options?.contextMessages,
  );
  const toolTrace = [...(options?.toolTrace ?? []), `llm:openai`, `responseMode:${responseMode}`];
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
        max_tokens: profile.maxOutputTokens,
        temperature: profile.temperature,
        messages: [
          { role: 'system', content: `${LLM_SYSTEM_PROMPT}\n\n${profile.promptAddendum}` },
          { role: 'user', content: payload.message },
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
      meta: {
        source: 'openai',
        model,
        ...(options?.memoryMode ? { memoryMode: options.memoryMode } : {}),
        responseMode,
        confidence: clampFiniteFloat(profile.confidenceBase, 0.78),
        toolTrace,
        ...(requestId ? { requestId } : {}),
      },
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
  requestId?: string,
  options?: {
    responseMode?: InsightChatResponseMode;
    memoryMode?: InsightChatMemoryMode;
    feedbackContext?: InsightChatFeedbackContext;
    attachments?: InsightChatAttachment[];
    contextMessages?: InsightChatContextMessage[];
    toolTrace?: string[];
    responseProfile?: ResponseModeProfile;
  },
): Promise<AdminInsightChatResponse | null> {
  const responseMode = normalizeResponseMode(options?.responseMode);
  const profile = options?.responseProfile ?? resolveResponseModeProfile(responseMode);
  const payload = buildPromptWithContext(
    message,
    responseMode,
    options?.feedbackContext,
    options?.attachments,
    options?.memoryMode,
    options?.contextMessages,
  );
  const toolTrace = [...(options?.toolTrace ?? []), `llm:anthropic`, `responseMode:${responseMode}`];
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
        max_tokens: profile.maxOutputTokens,
        temperature: profile.temperature,
        system: `${LLM_SYSTEM_PROMPT}\n\n${profile.promptAddendum}`,
        messages: [{ role: 'user', content: payload.message }],
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
      meta: {
        source: 'anthropic',
        model,
        ...(options?.memoryMode ? { memoryMode: options.memoryMode } : {}),
        responseMode,
        confidence: clampFiniteFloat(profile.confidenceBase, 0.8),
        toolTrace,
        ...(requestId ? { requestId } : {}),
      },
    };
  } catch (error) {
    console.error('[insight/chat] Anthropic request failed:', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
