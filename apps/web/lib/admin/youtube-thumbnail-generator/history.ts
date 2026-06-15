import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type {
  ThumbnailGenerationMode,
  ThumbnailGenerationResult,
  ThumbnailGeneratorPayload,
  ThumbnailProviderId,
  ThumbnailRetrievalDiagnostics,
} from './types';
import {
  THUMBNAIL_GENERATION_MODES,
  THUMBNAIL_PROVIDER_IDS,
  YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
  YOUTUBE_THUMBNAIL_TARGET_WIDTH,
} from './types';
import type { ThumbnailReleaseHostPresenceProof } from './release-candidates';
import { normalizeThumbnailReleaseHostPresenceProof } from './release-candidates';

export const THUMBNAIL_LOCAL_HISTORY_WRITE_ENV = 'THUMBNAIL_LOCAL_HISTORY_WRITE';
export const THUMBNAIL_HISTORY_ROOT_ENV = 'THUMBNAIL_HISTORY_ROOT';
export const THUMBNAIL_HISTORY_DEFAULT_ROOT = '.omx/runtime/youtube-thumbnail-history';
export const THUMBNAIL_HISTORY_PUBLIC_IMAGE_DIR = 'public/qa-history/youtube-thumbnail-generator/generated';
export const THUMBNAIL_HISTORY_PUBLIC_IMAGE_BASE_URL = '/qa-history/youtube-thumbnail-generator/generated';
export const THUMBNAIL_HISTORY_E2E_RUNS_DIR = 'e2e-runs';
export const THUMBNAIL_HISTORY_BUNDLED_PREVIEW_IMAGE = '/images/admin/youtube-thumbnail-generated-example-preview.png';
export const THUMBNAIL_HISTORY_LEGACY_PUBLIC_ROOT = 'public/qa-history/youtube-thumbnail-generator';
export const THUMBNAIL_HISTORY_LIMIT = 20;
export const THUMBNAIL_HISTORY_MAX_RAW_BYTES = 1_000_000;

const SAFE_HISTORY_FILE_PATTERN = /^[A-Za-z0-9_.-]+$/;

type ThumbnailHistoryEnv = Pick<NodeJS.ProcessEnv, 'NODE_ENV'> & Record<string, string | undefined>;

type ThumbnailHistoryOptions = {
  historyRoot?: string;
  publicImageRoot?: string;
  now?: Date;
  includeLegacyFallback?: boolean;
  includeNonExactQaRuns?: boolean;
  limit?: number;
};

export type ThumbnailHistoryRun = {
  id: string;
  timestamp: string;
  completedAt: string;
  status: 'passed';
  providerId: ThumbnailProviderId;
  model: string;
  modelProvenance: 'exact' | 'requested-label' | 'unknown';
  generationMode: ThumbnailGenerationMode;
  topic: string;
  headline: string;
  warnings: string[];
  imagePath: string;
  hostPresence?: ThumbnailReleaseHostPresenceProof;
  rawPath?: string;
  retrieval?: Pick<ThumbnailRetrievalDiagnostics, 'status' | 'candidateCount' | 'selectedReferenceIds' | 'fallbackReason' | 'usedModels' | 'operations' | 'commandRuntime'>;
};

export type ThumbnailHistoryPayload = {
  updatedAt: string | null;
  runs: ThumbnailHistoryRun[];
  latestPreviewRun?: ThumbnailHistoryRun | null;
};

type PersistThumbnailHistoryOptions = ThumbnailHistoryOptions & {
  runId?: string;
};

type RawHistoryPayload = {
  updatedAt?: unknown;
  runs?: unknown;
};

type LegacyHistorySource = {
  path: string;
  imageBaseUrl: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isThumbnailProviderId(value: unknown): value is ThumbnailProviderId {
  return typeof value === 'string' && (THUMBNAIL_PROVIDER_IDS as readonly string[]).includes(value);
}

function isThumbnailGenerationMode(value: unknown): value is ThumbnailGenerationMode {
  return typeof value === 'string' && (THUMBNAIL_GENERATION_MODES as readonly string[]).includes(value);
}

function isSafeRelativePathFrom(root: string, target: string) {
  const pathFromRoot = relative(resolve(root), resolve(target));
  return Boolean(pathFromRoot) && !pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot);
}

function assertSafePath(root: string, target: string) {
  if (!isSafeRelativePathFrom(root, target)) {
    throw new Error('thumbnail_history_path_escape');
  }
  return resolve(target);
}

function assertCanonicalRootOutsidePublicHistory(root: string) {
  const publicHistoryRoot = resolve(process.cwd(), THUMBNAIL_HISTORY_LEGACY_PUBLIC_ROOT);
  const resolvedRoot = resolve(root);
  if (resolvedRoot === publicHistoryRoot || isSafeRelativePathFrom(publicHistoryRoot, resolvedRoot)) {
    throw new Error('thumbnail_history_root_must_not_be_public');
  }
  return resolvedRoot;
}

function resolveMaybeRelativePath(value: string) {
  return isAbsolute(value) ? resolve(value) : resolve(process.cwd(), value);
}

export function resolveThumbnailHistoryRoot(
  env: ThumbnailHistoryEnv = process.env,
  options: Pick<ThumbnailHistoryOptions, 'historyRoot'> = {},
) {
  const configured = options.historyRoot?.trim() || env[THUMBNAIL_HISTORY_ROOT_ENV]?.trim() || THUMBNAIL_HISTORY_DEFAULT_ROOT;
  return assertCanonicalRootOutsidePublicHistory(resolveMaybeRelativePath(configured));
}

function resolveThumbnailPublicImageRoot(options: Pick<ThumbnailHistoryOptions, 'publicImageRoot'> = {}) {
  return resolveMaybeRelativePath(options.publicImageRoot?.trim() || THUMBNAIL_HISTORY_PUBLIC_IMAGE_DIR);
}

function historyLimit(options: Pick<ThumbnailHistoryOptions, 'limit'> = {}) {
  const limit = Math.round(Number(options.limit));
  return Number.isFinite(limit) && limit > 0 ? Math.min(limit, THUMBNAIL_HISTORY_LIMIT) : THUMBNAIL_HISTORY_LIMIT;
}

function safeHistoryTimestamp(value: string | undefined, now: Date) {
  const parsed = value && Number.isFinite(Date.parse(value)) ? new Date(value) : now;
  return parsed.toISOString().replace(/[:.]/g, '-');
}

function safeHistoryId(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 120) || `thumbnail-history-${Date.now()}`;
}

function normalizeWarnings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((warning): warning is string => typeof warning === 'string').slice(0, 20)
    : [];
}

function normalizePublicImagePath(imagePath: unknown, imageBaseUrl: string) {
  const rawPath = toString(imagePath, 400);
  if (!rawPath || rawPath.startsWith('http://') || rawPath.startsWith('https://') || rawPath.startsWith('//') || rawPath.startsWith('data:')) {
    return null;
  }

  const normalizedBase = imageBaseUrl.replace(/\/+$/, '');
  if (rawPath.startsWith('/')) {
    if (!rawPath.startsWith('/qa-history/youtube-thumbnail-generator/')) return null;
    if (rawPath.split('/').includes('..')) return null;
    return rawPath;
  }

  const normalizedRelative = rawPath.replace(/^\.\//, '').replace(/\\/g, '/');
  if (!normalizedRelative || normalizedRelative.split('/').some((part) => part === '..' || part === '')) return null;
  return `${normalizedBase}/${normalizedRelative}`;
}

function hasTzuyangHostPresenceProof(run: Pick<ThumbnailHistoryRun, 'hostPresence'>) {
  return run.hostPresence?.creator === 'tzuyang' && run.hostPresence.visible === true;
}

export function isExactGptImage2ThumbnailHistoryRun(run: Pick<ThumbnailHistoryRun, 'providerId' | 'model' | 'modelProvenance' | 'status' | 'hostPresence'>) {
  return (
    run.status === 'passed' &&
    run.providerId === 'local-codex' &&
    run.model === 'gpt-image-2' &&
    run.modelProvenance === 'exact' &&
    hasTzuyangHostPresenceProof(run)
  );
}

function normalizeHistoryRetrieval(value: unknown) {
  if (!isRecord(value)) return null;
  const diagnostics = isRecord(value.diagnostics) ? value.diagnostics : value;
  return {
    status: toString(diagnostics.status, 40) as ThumbnailRetrievalDiagnostics['status'],
    candidateCount: Number(diagnostics.candidateCount) || 0,
    selectedReferenceIds: Array.isArray(diagnostics.selectedReferenceIds)
      ? diagnostics.selectedReferenceIds.filter((item): item is string => typeof item === 'string').slice(0, 8)
      : [],
    ...(toString(diagnostics.fallbackReason, 80)
      ? { fallbackReason: toString(diagnostics.fallbackReason, 80) as ThumbnailRetrievalDiagnostics['fallbackReason'] }
      : {}),
    ...(isRecord(diagnostics.usedModels) ? { usedModels: diagnostics.usedModels as ThumbnailRetrievalDiagnostics['usedModels'] } : {}),
    ...(isRecord(diagnostics.operations) ? { operations: diagnostics.operations as ThumbnailRetrievalDiagnostics['operations'] } : {}),
    ...(toString(diagnostics.commandRuntime, 80)
      ? { commandRuntime: toString(diagnostics.commandRuntime, 80) as ThumbnailRetrievalDiagnostics['commandRuntime'] }
      : {}),
  };
}

function normalizeHistoryRun(value: unknown, imageBaseUrl: string): ThumbnailHistoryRun | null {
  if (!isRecord(value)) return null;
  if (value.mockUsed === true) return null;
  if (value.status !== 'passed') return null;
  if (!isThumbnailProviderId(value.providerId)) return null;

  const imagePath = normalizePublicImagePath(value.imagePath, imageBaseUrl);
  if (!imagePath) return null;

  const timestamp = toString(value.timestamp, 80) || toString(value.completedAt, 80);
  const completedAt = toString(value.completedAt, 80) || timestamp;
  if (!timestamp || !completedAt) return null;

  const rawPath = normalizeRawPath(value.rawPath);
  const retrieval = normalizeHistoryRetrieval(value.retrieval);
  const hostPresence = normalizeThumbnailReleaseHostPresenceProof(value);

  return {
    id: safeHistoryId(toString(value.id, 120) || timestamp || imagePath),
    timestamp,
    completedAt,
    status: 'passed',
    providerId: value.providerId,
    model: toString(value.model, 120) || 'requested:gpt-image-2',
    modelProvenance: value.modelProvenance === 'exact' || value.modelProvenance === 'unknown' ? value.modelProvenance : 'requested-label',
    generationMode: isThumbnailGenerationMode(value.generationMode) ? value.generationMode : 'direct_provider',
    topic: toString(value.topic, 320),
    headline: toString(value.headline, 120),
    warnings: normalizeWarnings(value.warnings),
    imagePath,
    ...(hostPresence ? { hostPresence } : {}),
    ...(retrieval ? { retrieval } : {}),
    ...(rawPath ? { rawPath } : {}),
  };
}

function normalizeRawPath(value: unknown) {
  const rawPath = toString(value, 240);
  if (!rawPath || rawPath.startsWith('http://') || rawPath.startsWith('https://') || rawPath.startsWith('//') || rawPath.startsWith('/')) return null;
  const normalized = rawPath.replace(/^\.\//, '').replace(/\\/g, '/');
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '')) return null;
  return `./${normalized}`;
}

function createBundledThumbnailPreviewRun(): ThumbnailHistoryRun {
  const bundledAt = '2026-06-01T00:00:00.000Z';
  return {
    id: 'bundled-youtube-thumbnail-preview',
    timestamp: bundledAt,
    completedAt: bundledAt,
    status: 'passed',
    providerId: 'local-codex',
    model: 'gpt-image-2',
    modelProvenance: 'unknown',
    generationMode: 'direct_provider',
    topic: '쯔양 먹방 제육볶음 한상 기본 미리보기',
    headline: '제육볶음 한상',
    warnings: ['다른 계정/컴퓨터에서도 첫 화면이 비지 않도록 제공하는 실제 생성 예시 썸네일입니다. exact gpt-image-2 provenance가 확인된 히스토리 기록은 아닙니다.'],
    imagePath: THUMBNAIL_HISTORY_BUNDLED_PREVIEW_IMAGE,
    hostPresence: {
      creator: 'tzuyang',
      visible: true,
      evidence: 'bundled-preview-visible-host',
    },
  };
}

async function readJsonFile(path: string) {
  const file = await readFile(path, { encoding: 'utf8' });
  if (Buffer.byteLength(file, 'utf8') > THUMBNAIL_HISTORY_MAX_RAW_BYTES) {
    throw new Error('thumbnail_history_file_too_large');
  }
  return JSON.parse(file) as RawHistoryPayload;
}

async function readHistorySource(source: LegacyHistorySource, limit: number, options: Pick<ThumbnailHistoryOptions, 'includeNonExactQaRuns'> = {}) {
  try {
    const payload = await readJsonFile(source.path);
    const runs = Array.isArray(payload.runs) ? payload.runs : [];
    return {
      updatedAt: toString(payload.updatedAt, 80) || null,
      runs: runs.flatMap((run) => {
        const normalized = normalizeHistoryRun(run, source.imageBaseUrl);
        if (normalized && !options.includeNonExactQaRuns && !isExactGptImage2ThumbnailHistoryRun(normalized)) {
          return [];
        }
        return normalized ? [normalized] : [];
      }).slice(0, limit),
    } satisfies ThumbnailHistoryPayload;
  } catch {
    return { updatedAt: null, runs: [] } satisfies ThumbnailHistoryPayload;
  }
}

async function readLatestExistingGeneratedPreviewRun(
  _options: Pick<ThumbnailHistoryOptions, 'publicImageRoot'> = {},
): Promise<ThumbnailHistoryRun | null> {
  // Public e2e-run images were useful as developer evidence, but they do not
  // carry a durable "Tzuyang is visible" proof. Never promote those arbitrary
  // files to the first-load canvas; use the bundled host-visible preview until
  // a canonical exact history or release record includes explicit host proof.
  return createBundledThumbnailPreviewRun();
}

function legacyHistorySources(): LegacyHistorySource[] {
  const legacyRoot = resolve(process.cwd(), THUMBNAIL_HISTORY_LEGACY_PUBLIC_ROOT);
  return [
    {
      path: join(legacyRoot, 'history.json'),
      imageBaseUrl: '/qa-history/youtube-thumbnail-generator',
    },
    {
      path: join(legacyRoot, 'e2e-runs', 'history.json'),
      imageBaseUrl: '/qa-history/youtube-thumbnail-generator/e2e-runs',
    },
  ];
}

export async function readThumbnailHistory(
  env: ThumbnailHistoryEnv = process.env,
  options: ThumbnailHistoryOptions = {},
): Promise<ThumbnailHistoryPayload> {
  const limit = historyLimit(options);
  const historyRoot = resolveThumbnailHistoryRoot(env, options);
  const canonical = await readHistorySource({
    path: join(historyRoot, 'history.json'),
    imageBaseUrl: THUMBNAIL_HISTORY_PUBLIC_IMAGE_BASE_URL,
  }, limit, options);
  const latestCanonicalPreview = canonical.runs[0] ?? await readLatestExistingGeneratedPreviewRun(options);
  if (canonical.runs.length || options.includeLegacyFallback === false) {
    return { ...canonical, latestPreviewRun: latestCanonicalPreview };
  }

  for (const source of legacyHistorySources()) {
    const legacy = await readHistorySource(source, limit, options);
    if (legacy.runs.length) return { ...legacy, latestPreviewRun: legacy.runs[0] ?? latestCanonicalPreview };
  }
  return { ...canonical, latestPreviewRun: latestCanonicalPreview };
}

function isLocalHistoryWriteEnabled(env: ThumbnailHistoryEnv) {
  return env.NODE_ENV !== 'production' && env[THUMBNAIL_LOCAL_HISTORY_WRITE_ENV] !== '0';
}

function decodeImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) return null;
  const mime = match[1] as 'image/png' | 'image/jpeg' | 'image/webp';
  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  return { mime, extension, bytes: Buffer.from(match[2].replace(/\s+/g, ''), 'base64') };
}

function safeFileName(value: string) {
  const fileName = value.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 180);
  return SAFE_HISTORY_FILE_PATTERN.test(fileName) ? fileName : `thumbnail-history-${Date.now()}`;
}

async function readCanonicalRuns(historyRoot: string) {
  const payload = await readHistorySource({
    path: join(historyRoot, 'history.json'),
    imageBaseUrl: THUMBNAIL_HISTORY_PUBLIC_IMAGE_BASE_URL,
  }, THUMBNAIL_HISTORY_LIMIT, { includeNonExactQaRuns: true });
  return payload.runs;
}

export async function persistLocalThumbnailHistory(
  result: ThumbnailGenerationResult,
  payload: ThumbnailGeneratorPayload,
  env: ThumbnailHistoryEnv = process.env,
  options: PersistThumbnailHistoryOptions = {},
) {
  if (!isLocalHistoryWriteEnabled(env)) {
    return { persisted: false as const, reason: 'disabled' as const };
  }

  const decodedImage = decodeImageDataUrl(result.baseImage.dataUrl);
  if (!decodedImage) {
    return { persisted: false as const, reason: 'non_persistable_image' as const };
  }

  const now = options.now ?? new Date();
  const completedAt = now.toISOString();
  const timestamp = safeHistoryTimestamp(completedAt, now);
  const runId = safeHistoryId(options.runId || `thumbnail-${timestamp}`);
  const imageFileName = safeFileName(`${runId}.${decodedImage.extension}`);
  const rawFileName = safeFileName(`${runId}.json`);
  const historyRoot = resolveThumbnailHistoryRoot(env, options);
  const publicImageRoot = resolveThumbnailPublicImageRoot(options);
  const imagePath = assertSafePath(publicImageRoot, join(publicImageRoot, imageFileName));
  const runsRoot = assertSafePath(historyRoot, join(historyRoot, 'runs'));
  const rawPath = assertSafePath(historyRoot, join(runsRoot, rawFileName));
  const historyPath = assertSafePath(historyRoot, join(historyRoot, 'history.json'));
  const latestPath = assertSafePath(historyRoot, join(historyRoot, 'latest.json'));
  const publicImageUrl = `${THUMBNAIL_HISTORY_PUBLIC_IMAGE_BASE_URL}/${imageFileName}`;
  const hostPresence = normalizeThumbnailReleaseHostPresenceProof(result.baseImage);

  const run: ThumbnailHistoryRun = {
    id: runId,
    timestamp,
    completedAt,
    status: 'passed',
    providerId: result.baseImage.providerId,
    model: result.baseImage.model || 'requested:gpt-image-2',
    modelProvenance: result.baseImage.modelProvenance ?? 'unknown',
    generationMode: payload.generationMode,
    topic: payload.topic,
    headline: payload.headline,
    warnings: normalizeWarnings(result.warnings),
    imagePath: publicImageUrl,
    ...(hostPresence ? { hostPresence } : {}),
    ...(result.retrieval ? { retrieval: result.retrieval.diagnostics } : {}),
    rawPath: `./runs/${rawFileName}`,
  };

  const rawPayload = {
    ...run,
    baseImage: {
      ...result.baseImage,
      dataUrl: '[stored separately as imagePath]',
      persistedImageMime: decodedImage.mime,
      targetWidth: YOUTUBE_THUMBNAIL_TARGET_WIDTH,
      targetHeight: YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
    },
    prompt: result.prompt,
    backendAgent: result.backendAgent,
    retrieval: result.retrieval,
  };

  await mkdir(publicImageRoot, { recursive: true });
  await mkdir(runsRoot, { recursive: true });
  await writeFile(imagePath, decodedImage.bytes);
  const rawJson = `${JSON.stringify(rawPayload, null, 2)}\n`;
  await writeFile(rawPath, rawJson, 'utf8');
  await writeFile(latestPath, rawJson, 'utf8');

  const previousRuns = await readCanonicalRuns(historyRoot);
  const runs = [run, ...previousRuns.filter((item) => item.id !== run.id)].slice(0, THUMBNAIL_HISTORY_LIMIT);
  await writeFile(historyPath, `${JSON.stringify({ updatedAt: completedAt, runs }, null, 2)}\n`, 'utf8');

  return {
    persisted: true as const,
    run,
    historyPath,
    rawPath,
    imagePath,
  };
}
