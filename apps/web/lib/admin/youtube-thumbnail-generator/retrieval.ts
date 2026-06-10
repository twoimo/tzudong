import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { getYoutubeThumbnailUrl } from '@/lib/youtube-thumbnail';

import type {
  ThumbnailGeneratorPayload,
  ThumbnailReferenceEvidence,
  ThumbnailReferenceEvidenceIntent,
  ThumbnailReferenceRole,
  ThumbnailRetrievalDiagnostics,
  ThumbnailRetrievalFallbackReason,
  ThumbnailRetrievalResult,
  ThumbnailRetrievalStatus,
} from './types';

export const THUMBNAIL_RETRIEVAL_COMMAND_ENV = 'THUMBNAIL_RETRIEVAL_COMMAND';
export const THUMBNAIL_RETRIEVAL_ROOT_ENV = 'THUMBNAIL_RETRIEVAL_ROOT';
export const THUMBNAIL_RETRIEVAL_TIMEOUT_MS_ENV = 'THUMBNAIL_RETRIEVAL_TIMEOUT_MS';
export const THUMBNAIL_RETRIEVAL_LOCAL_POOL_ENV = 'THUMBNAIL_RETRIEVAL_LOCAL_POOL';
export const THUMBNAIL_RETRIEVAL_DEFAULT_LOCAL_POOL =
  'backend/restaurant-crawling/data/tzuyang/meta';
export const THUMBNAIL_RETRIEVAL_REFERENCE_LIMIT = 4;
const THUMBNAIL_RETRIEVAL_COMMAND_TIMEOUT_MS = 8_000;

type ThumbnailRetrievalEnv = NodeJS.ProcessEnv;

type TzuyangMetaCandidate = {
  videoId: string;
  title: string;
  youtubeLink: string;
  thumbnailUrl: string;
};

function nowMs() {
  return Date.now();
}

function baseDiagnostics(
  status: ThumbnailRetrievalStatus,
  overrides: Partial<ThumbnailRetrievalDiagnostics> = {},
): ThumbnailRetrievalDiagnostics {
  return {
    status,
    candidateCount: 0,
    selectedReferenceIds: [],
    commandRuntime: 'none',
    ...overrides,
  };
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string) {
  return Array.from(new Set(normalizeText(value).split(' ').filter((token) => token.length >= 2)));
}

function extractVideoIdFromYoutubeLink(value: string) {
  const watchMatch = value.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = value.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (shortMatch) return shortMatch[1];
  return null;
}

function inferEvidenceIntent(title: string, query: string): ThumbnailReferenceEvidenceIntent {
  const text = normalizeText(`${title} ${query}`);
  if (/(문구|텍스트|타이틀|제목|headline|caption)/i.test(text)) return 'text_layout';
  if (/(음식|먹방|고기|떡볶|라면|제육|삼겹|스테이크|꼬치|해산물|초밥|분식|김치|치즈)/i.test(text)) return 'food';
  if (/(얼굴|표정|리액션|reaction)/i.test(text)) return 'composition';
  return 'style';
}

export function mapThumbnailEvidenceIntentToUploadRole(
  intent: ThumbnailReferenceEvidenceIntent,
): ThumbnailReferenceRole {
  if (intent === 'host') return 'host';
  if (intent === 'person') return 'person';
  if (intent === 'food') return 'food';
  return 'other';
}

export function canShowThumbnailRetrievalModelLabel(
  diagnostics: ThumbnailRetrievalDiagnostics,
  model: 'embedding' | 'reranker',
) {
  if (diagnostics.status !== 'used' && diagnostics.status !== 'partial') return false;
  if (model === 'embedding') {
    return diagnostics.usedModels?.embedding === 'BAAI/bge-m3'
      && diagnostics.operations?.denseSparseHybrid === true;
  }
  return diagnostics.usedModels?.reranker === 'BAAI/bge-reranker-v2-m3'
    && diagnostics.operations?.rerankerApplied === true;
}

async function readJsonlFirstObject(path: string) {
  const content = await readFile(path, 'utf8');
  const line = content.split(/\r?\n/).find((item) => item.trim());
  if (!line) return null;
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function loadLocalTzuyangMetaCandidates(env: ThumbnailRetrievalEnv) {
  const root = resolve(
    process.cwd(),
    env[THUMBNAIL_RETRIEVAL_LOCAL_POOL_ENV] || THUMBNAIL_RETRIEVAL_DEFAULT_LOCAL_POOL,
  );
  let files: string[] = [];
  try {
    files = (await readdir(root))
      .filter((file) => file.endsWith('.jsonl'))
      .slice(0, 600);
  } catch {
    return [];
  }

  const candidates: TzuyangMetaCandidate[] = [];
  for (const file of files) {
    const path = join(root, file);
    const parsed = await readJsonlFirstObject(path);
    const youtubeLink = typeof parsed?.youtube_link === 'string' ? parsed.youtube_link : '';
    const videoId = extractVideoIdFromYoutubeLink(youtubeLink) || basename(file, '.jsonl');
    const title = typeof parsed?.title === 'string' ? parsed.title : '';
    const thumbnailUrl = getYoutubeThumbnailUrl(videoId, 'maxresdefault');
    if (!videoId || !title || !thumbnailUrl) continue;
    candidates.push({ videoId, title, youtubeLink, thumbnailUrl });
  }
  return candidates;
}

function scoreCandidate(candidate: TzuyangMetaCandidate, queryTokens: string[]) {
  const haystack = normalizeText(`${candidate.title} ${candidate.youtubeLink}`);
  const tokenScore = queryTokens.reduce((score, token) => score + (haystack.includes(token) ? 8 : 0), 0);
  const foodBonus = /(먹방|떡볶|라면|고기|삼겹|스테이크|제육|해산물|초밥|꼬치|치즈|김치|분식)/i.test(candidate.title) ? 4 : 0;
  const challengeBonus = /(도전|역대|대왕|공짜|한입|리액션|레전드|실패|성공)/i.test(candidate.title) ? 3 : 0;
  return tokenScore + foodBonus + challengeBonus;
}

function localStaticPoolResult(
  payload: ThumbnailGeneratorPayload,
  candidates: TzuyangMetaCandidate[],
  startedAt: number,
  fallbackReason?: ThumbnailRetrievalFallbackReason,
): ThumbnailRetrievalResult {
  const queryTokens = tokenize(`${payload.topic} ${payload.headline} ${payload.subHeadline ?? ''}`);
  const ranked = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, queryTokens) }))
    .sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title, 'ko'))
    .slice(0, THUMBNAIL_RETRIEVAL_REFERENCE_LIMIT);

  const evidence: ThumbnailReferenceEvidence[] = ranked.map(({ candidate, score }, index) => {
    const intent = inferEvidenceIntent(candidate.title, payload.topic);
    return {
      id: `local-tzuyang-${candidate.videoId}`,
      source: 'youtube_thumbnail',
      intent,
      uploadRole: mapThumbnailEvidenceIntentToUploadRole(intent),
      videoId: candidate.videoId,
      title: candidate.title.slice(0, 160),
      thumbnailUrl: candidate.thumbnailUrl,
      mmrRank: index + 1,
      hybridScore: score,
      selectedReason: score > 0
        ? '요청 문구와 수집된 쯔양 영상 제목 키워드가 매칭되어 레퍼런스로 선택됨'
        : '수집된 쯔양 영상 메타데이터에서 기본 스타일 레퍼런스로 선택됨',
    };
  });

  const status: ThumbnailRetrievalStatus = evidence.length ? 'partial' : 'fallback';
  return {
    evidence,
    diagnostics: {
      ...baseDiagnostics(status, {
        candidateCount: candidates.length,
        selectedReferenceIds: evidence.map((item) => item.id),
        fallbackReason: fallbackReason ?? (evidence.length ? undefined : 'empty_result'),
        commandRuntime: 'local_static_pool',
        elapsedMs: nowMs() - startedAt,
      }),
    },
  };
}

function sanitizeFallbackReason(value: unknown): ThumbnailRetrievalFallbackReason {
  return value === 'missing_dependency'
    || value === 'missing_supabase_env'
    || value === 'rpc_unavailable'
    || value === 'timeout'
    || value === 'invalid_json'
    || value === 'empty_result'
    || value === 'unsafe_reference'
    || value === 'disabled'
    ? value
    : 'unknown_error';
}

function sanitizeEvidence(value: unknown): ThumbnailReferenceEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const rawIntent = record.intent;
    const intent: ThumbnailReferenceEvidenceIntent = rawIntent === 'host' || rawIntent === 'person' || rawIntent === 'food' || rawIntent === 'composition' || rawIntent === 'text_layout'
      ? rawIntent
      : 'style';
    return [{
      id: typeof record.id === 'string' && record.id.trim() ? record.id.trim().slice(0, 120) : `command-ref-${index + 1}`,
      source: record.source === 'transcript_scene' || record.source === 'frame_caption' || record.source === 'history' || record.source === 'manual_upload'
        ? record.source
        : 'youtube_thumbnail',
      intent,
      uploadRole: mapThumbnailEvidenceIntentToUploadRole(intent),
      videoId: typeof record.videoId === 'string' ? record.videoId.slice(0, 80) : undefined,
      title: typeof record.title === 'string' ? record.title.slice(0, 160) : undefined,
      thumbnailUrl: typeof record.thumbnailUrl === 'string' ? record.thumbnailUrl.slice(0, 500) : undefined,
      cachedImagePath: typeof record.cachedImagePath === 'string' ? record.cachedImagePath.slice(0, 500) : undefined,
      startSec: Number.isFinite(Number(record.startSec)) ? Number(record.startSec) : undefined,
      endSec: Number.isFinite(Number(record.endSec)) ? Number(record.endSec) : undefined,
      transcriptSnippet: typeof record.transcriptSnippet === 'string' ? record.transcriptSnippet.slice(0, 500) : undefined,
      captionSnippet: typeof record.captionSnippet === 'string' ? record.captionSnippet.slice(0, 500) : undefined,
      hybridScore: Number.isFinite(Number(record.hybridScore)) ? Number(record.hybridScore) : undefined,
      mmrRank: Number.isFinite(Number(record.mmrRank)) ? Number(record.mmrRank) : undefined,
      rerankScore: Number.isFinite(Number(record.rerankScore)) ? Number(record.rerankScore) : undefined,
      selectedReason: typeof record.selectedReason === 'string' && record.selectedReason.trim()
        ? record.selectedReason.slice(0, 240)
        : 'retrieval adapter selected this reference',
    }];
  });
}

function sanitizeCommandResult(parsed: unknown, startedAt: number): ThumbnailRetrievalResult | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const evidence = sanitizeEvidence(record.evidence);
  const diagnosticsRecord = record.diagnostics && typeof record.diagnostics === 'object' && !Array.isArray(record.diagnostics)
    ? record.diagnostics as Record<string, unknown>
    : {};
  const usedEmbedding = diagnosticsRecord.usedModels && typeof diagnosticsRecord.usedModels === 'object'
    && (diagnosticsRecord.usedModels as Record<string, unknown>).embedding === 'BAAI/bge-m3';
  const usedReranker = diagnosticsRecord.usedModels && typeof diagnosticsRecord.usedModels === 'object'
    && (diagnosticsRecord.usedModels as Record<string, unknown>).reranker === 'BAAI/bge-reranker-v2-m3';
  const operations = diagnosticsRecord.operations && typeof diagnosticsRecord.operations === 'object'
    ? diagnosticsRecord.operations as Record<string, unknown>
    : {};

  const diagnostics: ThumbnailRetrievalDiagnostics = {
    status: evidence.length ? 'used' : 'fallback',
    candidateCount: Number.isFinite(Number(diagnosticsRecord.candidateCount)) ? Number(diagnosticsRecord.candidateCount) : evidence.length,
    selectedReferenceIds: evidence.map((item) => item.id),
    fallbackReason: evidence.length ? undefined : sanitizeFallbackReason(diagnosticsRecord.fallbackReason),
    usedModels: {
      ...(usedEmbedding ? { embedding: 'BAAI/bge-m3' as const } : {}),
      ...(usedReranker ? { reranker: 'BAAI/bge-reranker-v2-m3' as const } : {}),
    },
    operations: {
      ...(operations.supabaseRpc === 'match_documents_hybrid' ? { supabaseRpc: 'match_documents_hybrid' as const } : {}),
      denseSparseHybrid: operations.denseSparseHybrid === true,
      mmrApplied: operations.mmrApplied === true,
      rerankerApplied: operations.rerankerApplied === true,
      captionEnrichmentApplied: operations.captionEnrichmentApplied === true,
    },
    commandRuntime: 'python_retrieval_adapter',
    elapsedMs: nowMs() - startedAt,
  };
  return { evidence, diagnostics };
}

async function runRetrievalCommand(
  payload: ThumbnailGeneratorPayload,
  env: ThumbnailRetrievalEnv,
  startedAt: number,
): Promise<ThumbnailRetrievalResult | { fallbackReason: ThumbnailRetrievalFallbackReason } | null> {
  const command = env[THUMBNAIL_RETRIEVAL_COMMAND_ENV]?.trim();
  if (!command) return null;
  const timeout = Math.max(1_000, Math.min(
    Number(env[THUMBNAIL_RETRIEVAL_TIMEOUT_MS_ENV]) || THUMBNAIL_RETRIEVAL_COMMAND_TIMEOUT_MS,
    30_000,
  ));
  const input = JSON.stringify({
    query: `${payload.topic}\n${payload.headline}\n${payload.subHeadline ?? ''}`,
    topic: payload.topic,
    headline: payload.headline,
    subHeadline: payload.subHeadline,
    limit: THUMBNAIL_RETRIEVAL_REFERENCE_LIMIT,
  });

  return await new Promise((resolveResult) => {
    const child = spawn(command, [], {
      cwd: resolve(process.cwd(), env[THUMBNAIL_RETRIEVAL_ROOT_ENV] || '.'),
      env: { ...process.env, ...env, THUMBNAIL_RETRIEVAL_JSON: input },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      resolveResult({ fallbackReason: 'timeout' });
    }, timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 1_000_000) {
        stdout = stdout.slice(-1_000_000);
      }
    });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ fallbackReason: 'unknown_error' });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolveResult({ fallbackReason: 'unknown_error' });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolveResult(sanitizeCommandResult(parsed, startedAt) ?? { fallbackReason: 'invalid_json' });
      } catch {
        resolveResult({ fallbackReason: 'invalid_json' });
      }
    });
    child.stdin.end(input);
  });
}

export async function resolveThumbnailRetrievalReferences(
  payload: ThumbnailGeneratorPayload,
  env: ThumbnailRetrievalEnv = process.env,
): Promise<ThumbnailRetrievalResult> {
  const startedAt = nowMs();
  if (env.THUMBNAIL_RETRIEVAL_DISABLED === '1') {
    return {
      evidence: [],
      diagnostics: baseDiagnostics('disabled', {
        fallbackReason: 'disabled',
        commandRuntime: 'none',
        elapsedMs: nowMs() - startedAt,
      }),
    };
  }

  const commandResult = await runRetrievalCommand(payload, env, startedAt);
  if (commandResult && 'evidence' in commandResult) return commandResult;

  const candidates = await loadLocalTzuyangMetaCandidates(env);
  return localStaticPoolResult(
    payload,
    candidates,
    startedAt,
    commandResult?.fallbackReason,
  );
}
