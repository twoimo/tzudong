import { spawn } from 'node:child_process';
import { constants, existsSync, type Stats } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';

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
export const THUMBNAIL_RETRIEVAL_DEFAULT_COMMAND =
  'backend/thumbnail-agent/scripts/retrieve-thumbnail-references.py';
const THUMBNAIL_RETRIEVAL_COMMAND_TIMEOUT_MS = 8_000;
const DEFAULT_THUMBNAIL_RETRIEVAL_PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const TZUYANG_CREATOR_PATTERN = /(쯔양|tzuyang)/i;
const MAX_LOCAL_POOL_DIRECTORY_ENTRIES = 600;
const MAX_LOCAL_POOL_FILE_BYTES = 16 * 1024;
const MAX_LOCAL_POOL_FIRST_LINE_BYTES = 8 * 1024;
const MAX_LOCAL_POOL_JSON_DEPTH = 8;
const MAX_LOCAL_POOL_JSON_FIELDS = 32;
const MAX_LOCAL_POOL_JSON_ARRAY_ITEMS = 64;
const MAX_LOCAL_POOL_JSON_KEY_CHARS = 128;
const MAX_LOCAL_POOL_JSON_STRING_CHARS = 1_024;
const LOCAL_POOL_DIRECTORY_BUFFER_SIZE = 16;
const MAX_LOCAL_POOL_VIDEO_ID_CHARS = 128;
const MAX_LOCAL_POOL_PATH_CHARS = 1_024;
const MAX_LOCAL_POOL_ENTRY_NAME_CHARS = 255;

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

function shouldPreferTzuyangHostReferences(query: string) {
  return TZUYANG_CREATOR_PATTERN.test(query);
}

function inferEvidenceIntent(title: string, query: string): ThumbnailReferenceEvidenceIntent {
  const text = normalizeText(`${title} ${query}`);
  if (shouldPreferTzuyangHostReferences(query)) return 'host';
  if (/(문구|텍스트|타이틀|제목|headline|caption)/i.test(text)) return 'text_layout';
  if (/(음식|먹방|고기|떡볶|라면|제육|삼겹|스테이크|꼬치|해산물|초밥|분식|김치|치즈)/i.test(text)) return 'food';
  if (/(얼굴|표정|리액션|reaction)/i.test(text)) return 'composition';
  return 'style';
}

function buildRetrievalQuery(payload: ThumbnailGeneratorPayload) {
  const baseQuery = `${payload.topic}\n${payload.headline}\n${payload.subHeadline ?? ''}`;
  if (!shouldPreferTzuyangHostReferences(baseQuery) && payload.stylePreset !== 'tzuyang-food-travel-collage') {
    return baseQuery;
  }
  return [
    '쯔양 얼굴 표정 리액션 호스트 인물 컷아웃 먹방 썸네일',
    'Tzuyang host face expression reaction creator cutout mukbang thumbnail',
    baseQuery,
  ].join('\n');
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

function isPathInsideRoot(root: string, candidate: string) {
  const relativePath = relative(root, candidate);
  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && !isAbsolute(relativePath);
}

function hasSameFileIdentity(expected: Stats, actual: Stats) {
  return expected.dev === actual.dev
    && expected.ino === actual.ino
    && expected.size === actual.size;
}

function isSafeLocalPoolFile(stat: Stats) {
  return stat.isFile()
    && !stat.isSymbolicLink()
    && stat.nlink === 1
    && stat.size > 0
    && stat.size <= MAX_LOCAL_POOL_FILE_BYTES;
}

function hasBoundedJsonSyntax(input: string) {
  let depth = 0;
  let fieldCount = 0;
  let inString = false;
  let escaped = false;
  let stringLength = 0;

  for (const character of input) {
    if (inString) {
      if (escaped) {
        escaped = false;
        stringLength += 1;
      } else if (character === '\\') {
        escaped = true;
        stringLength += 1;
      } else if (character === '"') {
        inString = false;
      } else {
        stringLength += 1;
      }
      if (stringLength > MAX_LOCAL_POOL_JSON_STRING_CHARS) return false;
      continue;
    }

    if (character === '"') {
      inString = true;
      stringLength = 0;
      continue;
    }
    if (character === '{' || character === '[') {
      depth += 1;
      if (depth > MAX_LOCAL_POOL_JSON_DEPTH) return false;
      continue;
    }
    if (character === '}' || character === ']') {
      depth -= 1;
      if (depth < 0) return false;
      continue;
    }
    if (character === ':') {
      fieldCount += 1;
      if (fieldCount > MAX_LOCAL_POOL_JSON_FIELDS) return false;
    }
  }

  return !inString && depth === 0;
}

function hasBoundedJsonValue(
  value: unknown,
  depth = 0,
  fieldCount: { value: number } = { value: 0 },
): boolean {
  if (depth > MAX_LOCAL_POOL_JSON_DEPTH) return false;
  if (typeof value === 'string') return value.length <= MAX_LOCAL_POOL_JSON_STRING_CHARS;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true;

  if (Array.isArray(value)) {
    return value.length <= MAX_LOCAL_POOL_JSON_ARRAY_ITEMS
      && value.every((item) => hasBoundedJsonValue(item, depth + 1, fieldCount));
  }

  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const entries = Object.entries(value);
  fieldCount.value += entries.length;
  if (fieldCount.value > MAX_LOCAL_POOL_JSON_FIELDS) return false;
  return entries.every(([key, item]) => key.length <= MAX_LOCAL_POOL_JSON_KEY_CHARS
    && hasBoundedJsonValue(item, depth + 1, fieldCount));
}

async function readJsonlFirstObject(root: string, fileName: string) {
  if (fileName.length === 0
    || fileName.length > MAX_LOCAL_POOL_ENTRY_NAME_CHARS
    || fileName.includes('/')
    || fileName.includes('\\')) {
    return null;
  }

  const candidatePath = join(root, fileName);
  if (!isPathInsideRoot(root, candidatePath)) return null;

  let initialStat: Stats;
  try {
    initialStat = await lstat(candidatePath);
    if (!isSafeLocalPoolFile(initialStat)) return null;

    const resolvedCandidate = await realpath(candidatePath);
    if (!isPathInsideRoot(root, resolvedCandidate)) return null;
  } catch {
    return null;
  }

  let handle;
  try {
    const flags = constants.O_RDONLY
      | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
    handle = await open(candidatePath, flags);

    const openedStat = await handle.stat();
    if (!isSafeLocalPoolFile(openedStat) || !hasSameFileIdentity(initialStat, openedStat)) {
      return null;
    }

    const currentStat = await lstat(candidatePath);
    const currentResolvedCandidate = await realpath(candidatePath);
    if (!isSafeLocalPoolFile(currentStat)
      || !hasSameFileIdentity(openedStat, currentStat)
      || !isPathInsideRoot(root, currentResolvedCandidate)) {
      return null;
    }

    const bytesToRead = Math.min(
      MAX_LOCAL_POOL_FIRST_LINE_BYTES + 1,
      openedStat.size,
    );
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    const finalStat = await handle.stat();
    if (bytesRead !== bytesToRead || !hasSameFileIdentity(openedStat, finalStat)) return null;

    const firstLineEnd = buffer.subarray(0, bytesRead).indexOf(0x0a);
    const lineByteLength = firstLineEnd === -1 ? bytesRead : firstLineEnd;
    if (lineByteLength > MAX_LOCAL_POOL_FIRST_LINE_BYTES
      || (firstLineEnd === -1 && bytesRead > MAX_LOCAL_POOL_FIRST_LINE_BYTES)) {
      return null;
    }

    const lineBytes = buffer.subarray(
      0,
      lineByteLength > 0 && buffer[lineByteLength - 1] === 0x0d
        ? lineByteLength - 1
        : lineByteLength,
    );
    if (lineBytes.length === 0) return null;

    let line: string;
    try {
      line = new TextDecoder('utf-8', { fatal: true }).decode(lineBytes);
    } catch {
      return null;
    }
    if (!hasBoundedJsonSyntax(line)) return null;

    const parsed: unknown = JSON.parse(line);
    return hasBoundedJsonValue(parsed) && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

async function resolveTrustedLocalTzuyangMetaRoot(env: ThumbnailRetrievalEnv) {
  const root = resolveLocalTzuyangMetaRoot(env);
  try {
    const initialStat = await lstat(root);
    if (!initialStat.isDirectory() || initialStat.isSymbolicLink()) return null;

    const resolvedRoot = await realpath(root);
    const resolvedStat = await lstat(resolvedRoot);
    return resolvedStat.isDirectory() && hasSameFileIdentity(initialStat, resolvedStat)
      ? resolvedRoot
      : null;
  } catch {
    return null;
  }
}

function resolveLocalTzuyangMetaRoot(env: ThumbnailRetrievalEnv) {
  const configuredValue = env[THUMBNAIL_RETRIEVAL_LOCAL_POOL_ENV];
  const configured = typeof configuredValue === 'string'
    && configuredValue.length <= MAX_LOCAL_POOL_PATH_CHARS
    ? configuredValue.trim()
    : '';
  if (configured) return resolve(process.cwd(), configured);

  const candidates = [
    resolve(process.cwd(), THUMBNAIL_RETRIEVAL_DEFAULT_LOCAL_POOL),
    resolve(process.cwd(), '../../', THUMBNAIL_RETRIEVAL_DEFAULT_LOCAL_POOL),
    resolve(process.cwd(), '../', THUMBNAIL_RETRIEVAL_DEFAULT_LOCAL_POOL),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

async function loadLocalTzuyangMetaCandidates(env: ThumbnailRetrievalEnv) {
  const root = await resolveTrustedLocalTzuyangMetaRoot(env);
  if (!root) return [];

  const candidates: TzuyangMetaCandidate[] = [];
  try {
    const directory = await opendir(root, { bufferSize: LOCAL_POOL_DIRECTORY_BUFFER_SIZE });
    let entryCount = 0;
    for await (const entry of directory) {
      entryCount += 1;
      if (entryCount > MAX_LOCAL_POOL_DIRECTORY_ENTRIES) break;
      if (entry.name.length > MAX_LOCAL_POOL_ENTRY_NAME_CHARS || !entry.name.endsWith('.jsonl')) continue;

      try {
        const parsed = await readJsonlFirstObject(root, entry.name);
        const youtubeLink = typeof parsed?.youtube_link === 'string' ? parsed.youtube_link : '';
        const videoId = extractVideoIdFromYoutubeLink(youtubeLink) || basename(entry.name, '.jsonl');
        const title = typeof parsed?.title === 'string' ? parsed.title : '';
        if (!videoId || videoId.length > MAX_LOCAL_POOL_VIDEO_ID_CHARS || !title) continue;

        const thumbnailUrl = getYoutubeThumbnailUrl(videoId, 'maxresdefault');
        if (!thumbnailUrl) continue;
        candidates.push({ videoId, title, youtubeLink, thumbnailUrl });
      } catch {
        continue;
      }
    }
  } catch {
    return candidates;
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

function resolveDefaultRetrievalCommand() {
  const candidates = [
    resolve(process.cwd(), THUMBNAIL_RETRIEVAL_DEFAULT_COMMAND),
    resolve(process.cwd(), '../../', THUMBNAIL_RETRIEVAL_DEFAULT_COMMAND),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function resolveRetrievalCommand(env: ThumbnailRetrievalEnv) {
  const configured = env[THUMBNAIL_RETRIEVAL_COMMAND_ENV]?.trim();
  if (configured) return configured;
  if (env.THUMBNAIL_RETRIEVAL_DEFAULT_ADAPTER_DISABLED === '1') return '';
  return resolveDefaultRetrievalCommand() ?? '';
}
function toShellScriptArg(command: string) {
  return process.platform === 'win32' ? command.replaceAll('\\', '/') : command;
}

function resolveNodeBinary() {
  return process.versions.bun ? (process.env.NODE || 'node') : process.execPath;
}

function resolvePythonBinary(env: ThumbnailRetrievalEnv = process.env) {
  return env.PYTHON?.trim() || process.env.PYTHON?.trim() || DEFAULT_THUMBNAIL_RETRIEVAL_PYTHON;
}

function resolveBashBinary() {
  if (process.platform === 'win32') {
    const preferred = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    ];
    const found = preferred.find((candidate) => existsSync(candidate));
    if (found) return found;
  }
  return 'bash';
}

function resolveScriptCommand(command: string, args: string[], env: ThumbnailRetrievalEnv = process.env) {
  const extension = extname(command).toLowerCase();
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return { command: resolveNodeBinary(), args: [command, ...args] };
  }
  if (extension === '.py') {
    return { command: resolvePythonBinary(env), args: [command, ...args] };
  }
  if (extension === '.sh') {
    return { command: resolveBashBinary(), args: [toShellScriptArg(command), ...args] };
  }
  return { command, args };
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
  const rawUsedModels = diagnosticsRecord.usedModels && typeof diagnosticsRecord.usedModels === 'object'
    ? diagnosticsRecord.usedModels as Record<string, unknown>
    : {};
  const usedEmbedding = rawUsedModels.embedding === 'BAAI/bge-m3'
    || rawUsedModels.embedding === 'local-char-ngram-v1';
  const usedReranker = rawUsedModels.reranker === 'BAAI/bge-reranker-v2-m3'
    || rawUsedModels.reranker === 'local-lexical-reranker-v1';
  const operations = diagnosticsRecord.operations && typeof diagnosticsRecord.operations === 'object'
    ? diagnosticsRecord.operations as Record<string, unknown>
    : {};
  const embeddingModel = usedEmbedding
    ? rawUsedModels.embedding as NonNullable<ThumbnailRetrievalDiagnostics['usedModels']>['embedding']
    : undefined;
  const rerankerModel = usedReranker
    ? rawUsedModels.reranker as NonNullable<ThumbnailRetrievalDiagnostics['usedModels']>['reranker']
    : undefined;

  const diagnostics: ThumbnailRetrievalDiagnostics = {
    status: evidence.length ? 'used' : 'fallback',
    candidateCount: Number.isFinite(Number(diagnosticsRecord.candidateCount)) ? Number(diagnosticsRecord.candidateCount) : evidence.length,
    selectedReferenceIds: evidence.map((item) => item.id),
    fallbackReason: evidence.length ? undefined : sanitizeFallbackReason(diagnosticsRecord.fallbackReason),
    usedModels: {
      ...(embeddingModel ? { embedding: embeddingModel } : {}),
      ...(rerankerModel ? { reranker: rerankerModel } : {}),
    },
    operations: {
      ...(operations.supabaseRpc === 'match_documents_hybrid' ? { supabaseRpc: 'match_documents_hybrid' as const } : {}),
      denseSparseHybrid: operations.denseSparseHybrid === true,
      mmrApplied: operations.mmrApplied === true,
      rerankerApplied: operations.rerankerApplied === true,
      captionEnrichmentApplied: operations.captionEnrichmentApplied === true,
      localVectorSearch: operations.localVectorSearch === true,
      lexicalRerank: operations.lexicalRerank === true,
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
  const command = resolveRetrievalCommand(env);
  if (!command) return null;
  const runnable = resolveScriptCommand(command, [], env);
  const timeout = Math.max(1_000, Math.min(
    Number(env[THUMBNAIL_RETRIEVAL_TIMEOUT_MS_ENV]) || THUMBNAIL_RETRIEVAL_COMMAND_TIMEOUT_MS,
    30_000,
  ));
  const input = JSON.stringify({
    query: buildRetrievalQuery(payload),
    topic: payload.topic,
    headline: payload.headline,
    subHeadline: payload.subHeadline,
    limit: THUMBNAIL_RETRIEVAL_REFERENCE_LIMIT,
  });

  return await new Promise((resolveResult) => {
    const child = spawn(runnable.command, runnable.args, {
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
