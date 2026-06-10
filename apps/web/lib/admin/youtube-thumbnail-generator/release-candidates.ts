import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type { ThumbnailGenerationMode, ThumbnailProviderId } from './types';

export const THUMBNAIL_RELEASE_CANDIDATE_MANIFEST_ENV = 'THUMBNAIL_RELEASE_CANDIDATE_MANIFEST';
export const THUMBNAIL_RELEASE_PROMOTION_ROOT_ENV = 'THUMBNAIL_RELEASE_PROMOTION_ROOT';
export const THUMBNAIL_RELEASE_CANDIDATE_DEFAULT_MANIFEST = '.omx/artifacts/thumbnail-live-aesthetic/live-aesthetic-loop-v1b-20260610T130040Z/release-candidates.json';
export const THUMBNAIL_RELEASE_PROMOTION_DEFAULT_ROOT = '.omx/runtime/youtube-thumbnail-release-promotion';
export const THUMBNAIL_RELEASE_PUBLIC_IMAGE_DIR = 'public/qa-history/youtube-thumbnail-generator/release-candidates';
export const THUMBNAIL_RELEASE_PUBLIC_IMAGE_BASE_URL = '/qa-history/youtube-thumbnail-generator/release-candidates';
export const THUMBNAIL_RELEASE_MIN_SCORE = 90;
export const THUMBNAIL_RELEASE_MAX_MANIFEST_BYTES = 2_000_000;

const SAFE_RELEASE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

export type ThumbnailReleaseEnv = NodeJS.ProcessEnv;

export type ThumbnailReleaseOptions = {
  repoRoot?: string;
  webRoot?: string;
  manifestPath?: string;
  promotionRoot?: string;
  publicImageRoot?: string;
  historyRoot?: string;
  now?: Date;
};

type RawReleaseCandidate = {
  id?: unknown;
  subjectId?: unknown;
  imagePath?: unknown;
  providerId?: unknown;
  model?: unknown;
  modelProvenance?: unknown;
  sha256?: unknown;
  score?: unknown;
  issueTags?: unknown;
  assignedBy?: unknown;
};

type RawReleaseManifest = {
  generatedAt?: unknown;
  eligibility?: unknown;
  comparison?: unknown;
  totalRuns?: unknown;
  releaseCandidateCount?: unknown;
  releaseCandidates?: unknown;
};

export type ThumbnailReleaseCandidate = {
  id: string;
  subjectId: string;
  sourceManifestId: string;
  sourceImageId: string;
  browserImagePath: string;
  providerId: ThumbnailProviderId;
  model: 'gpt-image-2';
  modelProvenance: 'exact';
  generationMode: ThumbnailGenerationMode;
  topic: string;
  headline: string;
  sha256: string;
  score: number;
  issueTags: string[];
  assignedBy: string;
  releaseCandidate: true;
  normalizedFromManifestMembership: true;
};

export type ThumbnailPromotionState = {
  schemaVersion: 1;
  promotedAt: string;
  promotedBy: string;
  sourceManifestId: string;
  candidateId: string;
  browserImagePath: string;
  model: 'gpt-image-2';
  modelProvenance: 'exact';
  providerId: ThumbnailProviderId;
  score: number;
  sha256: string;
};

export type ThumbnailReleaseCandidatesPayload = {
  updatedAt: string | null;
  sourceManifestId: string | null;
  candidates: ThumbnailReleaseCandidate[];
  promotionState: ThumbnailPromotionState | null;
  batchSummary: {
    totalRuns: number;
    releaseCandidateCount: number;
    eligibility: {
      providerId: ThumbnailProviderId;
      model: 'gpt-image-2';
      modelProvenance: 'exact';
      minVisualScore: number;
      issueTags: string[];
      passedV1Gate: boolean;
    };
  } | null;
  diagnostics: {
    manifestFound: boolean;
    promotionStateValid: boolean;
    ignoredPromotionReason?: string;
    warnings: string[];
  };
};

type PromotionRequest = {
  candidateId: string;
  sourceManifestId?: string;
  promotedBy?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isSafeRelativePathFrom(root: string, target: string) {
  const pathFromRoot = relative(resolve(root), resolve(target));
  return Boolean(pathFromRoot) && !pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot);
}

function assertInside(root: string, target: string, code: string) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedRoot !== resolvedTarget && !isSafeRelativePathFrom(resolvedRoot, resolvedTarget)) {
    throw new Error(code);
  }
  return resolvedTarget;
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function findRepoRoot(start = process.cwd()) {
  let current = resolve(start);
  if (basename(current) === 'web' && basename(dirname(current)) === 'apps') {
    current = dirname(dirname(current));
  }
  for (let depth = 0; depth < 8; depth += 1) {
    if (await pathExists(join(current, 'apps', 'web', 'package.json'))) return current;
    if (await pathExists(join(current, '.git')) && await pathExists(join(current, '.omx', 'artifacts'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(start);
}

async function resolveRoots(options: Pick<ThumbnailReleaseOptions, 'repoRoot' | 'webRoot'> = {}) {
  const repoRoot = options.repoRoot ? resolve(options.repoRoot) : await findRepoRoot();
  const webRoot = options.webRoot
    ? resolve(options.webRoot)
    : basename(repoRoot) === 'web' && basename(dirname(repoRoot)) === 'apps'
      ? repoRoot
      : resolve(repoRoot, 'apps/web');
  return { repoRoot, webRoot };
}

function safeReleaseId(value: string) {
  const normalized = value.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 120);
  return normalized && SAFE_RELEASE_ID_PATTERN.test(normalized) ? normalized : `release-candidate-${Date.now()}`;
}

function normalizeIssueTags(value: unknown) {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean).slice(0, 10)
    : [];
}

function resolveMaybeRelativePath(root: string, value: string) {
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

async function resolveManifestPath(env: ThumbnailReleaseEnv, options: ThumbnailReleaseOptions, repoRoot: string) {
  const configured = options.manifestPath?.trim() || env[THUMBNAIL_RELEASE_CANDIDATE_MANIFEST_ENV]?.trim() || THUMBNAIL_RELEASE_CANDIDATE_DEFAULT_MANIFEST;
  const manifestPath = resolveMaybeRelativePath(repoRoot, configured);
  const artifactRoot = resolve(repoRoot, '.omx/artifacts/thumbnail-live-aesthetic');
  assertInside(artifactRoot, manifestPath, 'thumbnail_release_manifest_path_escape');
  if (basename(manifestPath) !== 'release-candidates.json') throw new Error('thumbnail_release_manifest_must_be_release_candidates_json');
  return manifestPath;
}

async function resolvePromotionRoot(env: ThumbnailReleaseEnv, options: ThumbnailReleaseOptions, webRoot: string) {
  const configured = options.promotionRoot?.trim() || env[THUMBNAIL_RELEASE_PROMOTION_ROOT_ENV]?.trim() || THUMBNAIL_RELEASE_PROMOTION_DEFAULT_ROOT;
  const promotionRoot = resolveMaybeRelativePath(webRoot, configured);
  const publicRoot = resolve(webRoot, 'public');
  if (promotionRoot === publicRoot || isSafeRelativePathFrom(publicRoot, promotionRoot)) {
    throw new Error('thumbnail_release_promotion_root_must_not_be_public');
  }
  return promotionRoot;
}

function resolvePublicImageRoot(options: ThumbnailReleaseOptions, webRoot: string) {
  return resolveMaybeRelativePath(webRoot, options.publicImageRoot?.trim() || THUMBNAIL_RELEASE_PUBLIC_IMAGE_DIR);
}

function toManifestId(manifestPath: string) {
  const batchId = basename(dirname(manifestPath));
  return `${safeReleaseId(batchId)}/release-candidates.json`;
}

function toSourceImageId(path: string) {
  return safeReleaseId(basename(path));
}

async function readJsonFile(path: string) {
  const file = await readFile(path, 'utf8');
  if (Buffer.byteLength(file, 'utf8') > THUMBNAIL_RELEASE_MAX_MANIFEST_BYTES) {
    throw new Error('thumbnail_release_manifest_too_large');
  }
  return JSON.parse(file) as RawReleaseManifest;
}

function readEligibility(raw: unknown) {
  const eligibility = isRecord(raw) ? raw : {};
  const batchGate = isRecord(eligibility.batchGate) ? eligibility.batchGate : {};
  const minVisualScore = Number(eligibility.minVisualScore);
  return {
    providerId: toString(eligibility.providerId, 40),
    model: toString(eligibility.model, 80),
    modelProvenance: toString(eligibility.modelProvenance, 40),
    minVisualScore: Number.isFinite(minVisualScore) ? minVisualScore : Number.NaN,
    issueTags: normalizeIssueTags(eligibility.issueTags),
    passedV1Gate: batchGate.passedV1Gate === true,
  };
}

function isEligibleCandidate(candidate: RawReleaseCandidate, eligibility: ReturnType<typeof readEligibility>) {
  const issueTags = normalizeIssueTags(candidate.issueTags);
  const score = Number(candidate.score);
  const sha256 = toString(candidate.sha256, 80);
  return (
    candidate.providerId === 'local-codex' &&
    candidate.model === 'gpt-image-2' &&
    candidate.modelProvenance === 'exact' &&
    SHA256_HEX_PATTERN.test(sha256) &&
    Number.isFinite(score) &&
    score >= eligibility.minVisualScore &&
    issueTags.length === 1 &&
    issueTags[0] === 'none' &&
    eligibility.providerId === 'local-codex' &&
    eligibility.model === 'gpt-image-2' &&
    eligibility.modelProvenance === 'exact' &&
    eligibility.issueTags.length === 1 &&
    eligibility.issueTags[0] === 'none' &&
    eligibility.passedV1Gate
  );
}

function resolveCandidateSourceImagePath(rawImagePath: unknown, repoRoot: string) {
  const imagePath = toString(rawImagePath, 500);
  if (!imagePath || imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('//') || imagePath.startsWith('data:')) {
    return null;
  }
  const resolved = resolveMaybeRelativePath(repoRoot, imagePath);
  const artifactRoot = resolve(repoRoot, '.omx/artifacts/thumbnail-live-aesthetic');
  return assertInside(artifactRoot, resolved, 'thumbnail_release_candidate_image_path_escape');
}

function candidatePublicFileName(candidate: Pick<RawReleaseCandidate, 'id' | 'sha256'>) {
  const id = safeReleaseId(toString(candidate.id, 120));
  const shaPrefix = toString(candidate.sha256, 80).replace(/[^a-fA-F0-9]/g, '').slice(0, 12);
  return `${id}${shaPrefix ? `-${shaPrefix}` : ''}.png`;
}

async function mirrorCandidateForBrowser(candidate: RawReleaseCandidate, sourceImagePath: string, options: ThumbnailReleaseOptions, webRoot: string) {
  const publicImageRoot = resolvePublicImageRoot(options, webRoot);
  const publicFilePath = assertInside(publicImageRoot, join(publicImageRoot, candidatePublicFileName(candidate)), 'thumbnail_release_public_image_path_escape');
  await mkdir(publicImageRoot, { recursive: true });
  await copyFile(sourceImagePath, publicFilePath);
  return `${THUMBNAIL_RELEASE_PUBLIC_IMAGE_BASE_URL}/${basename(publicFilePath)}`;
}

function createTopicAndHeadline(candidate: RawReleaseCandidate) {
  const subjectId = toString(candidate.subjectId, 80);
  const topic = subjectId
    ? `라이브 미학 평가에서 승인된 ${subjectId} 유튜브 썸네일 릴리즈 후보`
    : '라이브 미학 평가에서 승인된 유튜브 썸네일 릴리즈 후보';
  const headline = subjectId.includes('tteokbokki')
    ? '떡볶이 폭발'
    : subjectId.includes('seafood')
      ? '해산물 한상'
      : subjectId.includes('night-market')
        ? '야시장 끝판왕'
        : subjectId.includes('pork')
          ? '역대급 먹방'
          : '먹방 레전드';
  return { topic, headline };
}

async function normalizeCandidates(rawManifest: RawReleaseManifest, manifestPath: string, repoRoot: string, webRoot: string, options: ThumbnailReleaseOptions) {
  const eligibility = readEligibility(rawManifest.eligibility);
  const rawCandidates = Array.isArray(rawManifest.releaseCandidates) ? rawManifest.releaseCandidates.filter(isRecord) as RawReleaseCandidate[] : [];
  const candidates: ThumbnailReleaseCandidate[] = [];
  const warnings: string[] = [];

  for (const rawCandidate of rawCandidates) {
    if (!isEligibleCandidate(rawCandidate, eligibility)) {
      warnings.push(`ineligible:${toString(rawCandidate.id, 120) || 'unknown'}`);
      continue;
    }
    const sourceImagePath = resolveCandidateSourceImagePath(rawCandidate.imagePath, repoRoot);
    if (!sourceImagePath) {
      warnings.push(`missing-image-path:${toString(rawCandidate.id, 120) || 'unknown'}`);
      continue;
    }
    try {
      await stat(sourceImagePath);
      const browserImagePath = await mirrorCandidateForBrowser(rawCandidate, sourceImagePath, options, webRoot);
      if (!browserImagePath.startsWith('/qa-history/youtube-thumbnail-generator/')) {
        warnings.push(`unsafe-browser-path:${toString(rawCandidate.id, 120) || 'unknown'}`);
        continue;
      }
      const { topic, headline } = createTopicAndHeadline(rawCandidate);
      candidates.push({
        id: safeReleaseId(toString(rawCandidate.id, 120)),
        subjectId: safeReleaseId(toString(rawCandidate.subjectId, 80) || 'general'),
        sourceManifestId: toManifestId(manifestPath),
        sourceImageId: toSourceImageId(sourceImagePath),
        browserImagePath,
        providerId: 'local-codex',
        model: 'gpt-image-2',
        modelProvenance: 'exact',
        generationMode: 'direct_provider',
        topic,
        headline,
        sha256: toString(rawCandidate.sha256, 80),
        score: Number(rawCandidate.score),
        issueTags: ['none'],
        assignedBy: toString(rawCandidate.assignedBy, 80) || 'human-vision-adjudication',
        releaseCandidate: true,
        normalizedFromManifestMembership: true,
      });
    } catch (error) {
      console.error('[youtube-thumbnail/release-candidates] failed to mirror manifest artifact:', error);
      warnings.push(`mirror-failed:${toString(rawCandidate.id, 120) || 'unknown'}:source_image_unavailable`);
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { candidates, eligibility, warnings };
}

function validatePromotionState(value: unknown, candidates: ThumbnailReleaseCandidate[]) {
  if (!isRecord(value)) return { state: null, reason: 'missing_or_invalid_state' };
  if (value.schemaVersion !== 1) return { state: null, reason: 'unsupported_schema_version' };
  const candidateId = toString(value.candidateId, 120);
  const candidate = candidates.find((item) => item.id === candidateId);
  if (!candidate) return { state: null, reason: 'candidate_not_in_current_manifest' };
  if (value.providerId !== 'local-codex' || value.model !== 'gpt-image-2' || value.modelProvenance !== 'exact') {
    return { state: null, reason: 'non_exact_model_provenance' };
  }
  if (value.browserImagePath !== candidate.browserImagePath || value.sha256 !== candidate.sha256) {
    return { state: null, reason: 'stale_candidate_asset' };
  }
  return {
    state: {
      schemaVersion: 1,
      promotedAt: toString(value.promotedAt, 80),
      promotedBy: toString(value.promotedBy, 80) || 'local-dev-admin',
      sourceManifestId: candidate.sourceManifestId,
      candidateId: candidate.id,
      browserImagePath: candidate.browserImagePath,
      providerId: 'local-codex',
      model: 'gpt-image-2',
      modelProvenance: 'exact',
      score: candidate.score,
      sha256: candidate.sha256,
    } satisfies ThumbnailPromotionState,
    reason: null,
  };
}

async function readPromotionState(promotionRoot: string, candidates: ThumbnailReleaseCandidate[]) {
  try {
    const payload = JSON.parse(await readFile(join(promotionRoot, 'current.json'), 'utf8')) as unknown;
    return validatePromotionState(payload, candidates);
  } catch {
    return { state: null, reason: 'promotion_state_not_found' };
  }
}

export async function readThumbnailReleaseCandidates(
  env: ThumbnailReleaseEnv = process.env,
  options: ThumbnailReleaseOptions = {},
): Promise<ThumbnailReleaseCandidatesPayload> {
  const { repoRoot, webRoot } = await resolveRoots(options);
  const manifestPath = await resolveManifestPath(env, options, repoRoot);
  const promotionRoot = await resolvePromotionRoot(env, options, webRoot);

  try {
    const rawManifest = await readJsonFile(manifestPath);
    const { candidates, eligibility, warnings } = await normalizeCandidates(rawManifest, manifestPath, repoRoot, webRoot, options);
    const promotion = await readPromotionState(promotionRoot, candidates);
    return {
      updatedAt: toString(rawManifest.generatedAt, 80) || null,
      sourceManifestId: toManifestId(manifestPath),
      candidates,
      promotionState: promotion.state,
      batchSummary: {
        totalRuns: Number(rawManifest.totalRuns) || candidates.length,
        releaseCandidateCount: Number(rawManifest.releaseCandidateCount) || candidates.length,
        eligibility: {
          providerId: 'local-codex',
          model: 'gpt-image-2',
          modelProvenance: 'exact',
          minVisualScore: Number.isFinite(eligibility.minVisualScore) ? eligibility.minVisualScore : THUMBNAIL_RELEASE_MIN_SCORE,
          issueTags: ['none'],
          passedV1Gate: eligibility.passedV1Gate,
        },
      },
      diagnostics: {
        manifestFound: true,
        promotionStateValid: Boolean(promotion.state),
        ...(promotion.reason && promotion.reason !== 'promotion_state_not_found' ? { ignoredPromotionReason: promotion.reason } : {}),
        warnings,
      },
    };
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        updatedAt: null,
        sourceManifestId: toManifestId(manifestPath),
        candidates: [],
        promotionState: null,
        batchSummary: null,
        diagnostics: {
          manifestFound: false,
          promotionStateValid: false,
          ignoredPromotionReason: 'manifest_not_found',
          warnings: ['release_candidate_manifest_missing'],
        },
      };
    }
    throw error;
  }
}

export async function promoteThumbnailReleaseCandidate(
  request: PromotionRequest,
  env: ThumbnailReleaseEnv = process.env,
  options: ThumbnailReleaseOptions = {},
): Promise<ThumbnailReleaseCandidatesPayload> {
  const candidateId = safeReleaseId(request.candidateId || '');
  if (!candidateId) throw new Error('thumbnail_release_candidate_id_required');
  const { repoRoot, webRoot } = await resolveRoots(options);
  const payload = await readThumbnailReleaseCandidates(env, {
    ...options,
    manifestPath: options.manifestPath,
    repoRoot,
    webRoot,
  });
  const candidate = payload.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error('thumbnail_release_candidate_not_found');

  const promotionRoot = await resolvePromotionRoot(env, options, webRoot);
  const promotedAt = (options.now ?? new Date()).toISOString();
  const state: ThumbnailPromotionState = {
    schemaVersion: 1,
    promotedAt,
    promotedBy: safeReleaseId(request.promotedBy || 'local-dev-admin'),
    sourceManifestId: candidate.sourceManifestId,
    candidateId: candidate.id,
    browserImagePath: candidate.browserImagePath,
    providerId: 'local-codex',
    model: 'gpt-image-2',
    modelProvenance: 'exact',
    score: candidate.score,
    sha256: candidate.sha256,
  };
  await mkdir(promotionRoot, { recursive: true });
  await writeFile(join(promotionRoot, 'current.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  return {
    ...payload,
    promotionState: state,
    diagnostics: {
      ...payload.diagnostics,
      promotionStateValid: true,
      ignoredPromotionReason: undefined,
    },
  };
}
