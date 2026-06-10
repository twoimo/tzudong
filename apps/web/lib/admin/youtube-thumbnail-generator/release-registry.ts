import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

import { readThumbnailReleaseCandidates, type ThumbnailReleaseCandidate, type ThumbnailReleaseEnv, type ThumbnailReleaseOptions } from './release-candidates';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

export const THUMBNAIL_RELEASE_KEY = 'youtube-thumbnail-generator/current';
export const THUMBNAIL_RELEASE_STORAGE_BUCKET = 'youtube-thumbnail-releases';
export const THUMBNAIL_RELEASE_TABLE = 'youtube_thumbnail_releases';
export const THUMBNAIL_DURABLE_RELEASE_REASON_MISSING_ENV = 'missing_supabase_env';
export const THUMBNAIL_DURABLE_RELEASE_REASON_MISSING_TABLE = 'missing_release_table';

const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;
const MAX_TEXT_LAYERS = 8;
const SAFE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const RELEASE_STORAGE_OBJECT_PATTERN = /^youtube-thumbnail-generator\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i;
const SAFE_BROWSER_IMAGE_PREFIX = '/api/admin/youtube-thumbnail-generator/releases/assets/';
const SAFE_HISTORY_IMAGE_PREFIX = '/qa-history/youtube-thumbnail-generator/';
const PUBLIC_RAW_PATH_PATTERNS = ['.omx/artifacts', '.omx/runtime', 'SUPABASE_SERVICE_ROLE_KEY', 'storage_object_path'];

export type ThumbnailReleaseTextLayer = {
  id: string;
  content: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  shadow: string;
  align: 'left' | 'center' | 'right';
  rotation: number;
  zIndex: number;
};

export type ThumbnailDurableRelease = {
  id: string;
  releaseKey: typeof THUMBNAIL_RELEASE_KEY;
  status: 'active';
  candidateId: string;
  sourceManifestId: string;
  sourceImageId: string;
  browserImagePath: string;
  sha256: string;
  width: 1280;
  height: 720;
  mimeType: 'image/png';
  providerId: 'local-codex';
  model: 'gpt-image-2';
  modelProvenance: 'exact';
  score: number;
  issueTags: ['none'];
  textLayers: ThumbnailReleaseTextLayer[];
  canvas: { width: 1280; height: 720 };
  sourceQualityGate: Record<string, unknown>;
  publishedAt: string;
  updatedAt: string;
};

export type ThumbnailDurableReleasePayload = {
  status: 'ready' | 'empty' | 'unavailable';
  updatedAt: string | null;
  release: ThumbnailDurableRelease | null;
  diagnostics: {
    durableRegistryAvailable: boolean;
    storageBucket: typeof THUMBNAIL_RELEASE_STORAGE_BUCKET;
    releaseKey: typeof THUMBNAIL_RELEASE_KEY;
    reason?: string;
    warnings: string[];
  };
};

export type ThumbnailPublishDurableReleaseRequest = {
  candidateId: string;
  textLayers?: unknown;
  publishedBy?: string | null;
};

type ReleaseRow = {
  id: string;
  release_key: string;
  status: string;
  candidate_id: string;
  source_manifest_id: string;
  source_image_id: string;
  storage_bucket: string;
  storage_object_path: string;
  browser_image_path: string;
  sha256: string;
  width: number;
  height: number;
  mime_type: string;
  provider_id: string;
  model: string;
  model_provenance: string;
  score: number | string;
  issue_tags: unknown;
  text_layers: unknown;
  canvas: unknown;
  source_quality_gate: unknown;
  published_at: string;
  updated_at: string;
};

type InsertReleaseRow = Omit<ReleaseRow, 'updated_at'> & {
  published_by?: string | null;
  created_at?: string;
};

export type ThumbnailReleaseRegistryAdapter = {
  readCurrentRelease(releaseKey: string): Promise<ReleaseRow | null>;
  publishRelease(row: InsertReleaseRow): Promise<ReleaseRow>;
  uploadReleaseAsset(bucket: string, objectPath: string, bytes: Buffer): Promise<void>;
  deleteReleaseAsset(bucket: string, objectPath: string): Promise<void>;
  downloadReleaseAsset(bucket: string, objectPath: string): Promise<{ bytes: Buffer; contentType: string }>;
};

export type ThumbnailReleaseRegistryOptions = ThumbnailReleaseOptions & {
  adapter?: ThumbnailReleaseRegistryAdapter;
  releaseId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, numberValue));
}

function isSupabaseEnvConfigured(env: ThumbnailReleaseEnv) {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function isMissingReleaseTableError(error: unknown) {
  if (!isRecord(error)) return false;
  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';
  if (code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883') return true;
  return (
    /relation [\"']?(?:public\.)?youtube_thumbnail_releases[\"']? does not exist/i.test(message) ||
    /function [\"']?(?:public\.)?publish_youtube_thumbnail_release\b[^\n]* does not exist/i.test(message) ||
    /could not find (?:the )?(?:table|relation)[^\n]*youtube_thumbnail_releases[^\n]*schema cache/i.test(message) ||
    /could not find (?:the )?function[^\n]*publish_youtube_thumbnail_release[^\n]*schema cache/i.test(message)
  );
}

function assertRedactedPublicPayload(value: unknown) {
  const serialized = JSON.stringify(value);
  const leaked = PUBLIC_RAW_PATH_PATTERNS.find((pattern) => serialized.includes(pattern));
  if (leaked) throw new Error(`thumbnail_durable_release_payload_leaks_raw_path:${leaked}`);
}

function releaseAssetBrowserPath(releaseId: string) {
  return `${SAFE_BROWSER_IMAGE_PREFIX}${releaseId}`;
}

function isReleaseStorageObjectPath(value: string) {
  return RELEASE_STORAGE_OBJECT_PATTERN.test(value);
}

function isSafeRelativePathFrom(root: string, target: string) {
  const pathFromRoot = relative(resolve(root), resolve(target));
  return Boolean(pathFromRoot) && !pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot);
}

function assertInside(root: string, target: string, code: string) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedRoot !== resolvedTarget && !isSafeRelativePathFrom(resolvedRoot, resolvedTarget)) throw new Error(code);
  return resolvedTarget;
}

function resolveWebRoot(options: ThumbnailReleaseRegistryOptions) {
  if (options.webRoot) return resolve(options.webRoot);
  if (options.repoRoot) return resolve(options.repoRoot, 'apps/web');
  const cwd = resolve(process.cwd());
  return basename(cwd) === 'web' ? cwd : resolve(cwd, 'apps/web');
}

function resolveCandidatePublicImagePath(candidate: ThumbnailReleaseCandidate, options: ThumbnailReleaseRegistryOptions) {
  if (!candidate.browserImagePath.startsWith(SAFE_HISTORY_IMAGE_PREFIX)) throw new Error('thumbnail_durable_release_candidate_browser_path_unsafe');
  const webRoot = resolveWebRoot(options);
  const publicRoot = resolve(webRoot, 'public');
  return assertInside(publicRoot, join(publicRoot, candidate.browserImagePath), 'thumbnail_durable_release_public_path_escape');
}

function normalizeHexSha256(value: string) {
  return value.trim().toLowerCase();
}

function createReleaseSourceQualityGate(candidate: ThumbnailReleaseCandidate, actualSha256: string) {
  return {
    candidateId: candidate.id,
    sourceManifestId: candidate.sourceManifestId,
    sourceImageId: candidate.sourceImageId,
    score: candidate.score,
    providerId: 'local-codex',
    model: 'gpt-image-2',
    modelProvenance: 'exact',
    issueTags: ['none'],
    releaseCandidate: true,
    normalizedFromManifestMembership: true,
    sha256Verified: normalizeHexSha256(candidate.sha256) === actualSha256,
  };
}

function normalizeTextLayer(value: unknown, index: number, fallbackHeadline: string): ThumbnailReleaseTextLayer | null {
  if (!isRecord(value)) return null;
  const content = toString(value.content, 48) || (index === 0 ? fallbackHeadline : '');
  if (!content) return null;
  const id = toString(value.id, 40).replace(/[^A-Za-z0-9_-]/g, '-') || `releaseLayer${index + 1}`;
  const fontFamilyRaw = toString(value.fontFamily, 80);
  const fontFamily = /impact/i.test(fontFamilyRaw)
    ? 'Impact, Pretendard, system-ui, sans-serif'
    : 'Pretendard, system-ui, sans-serif';
  const align = value.align === 'left' || value.align === 'right' ? value.align : 'center';
  const fill = /^#[0-9a-f]{6}$/i.test(toString(value.fill, 16)) ? toString(value.fill, 16) : index === 1 ? '#fff200' : '#ffffff';
  const stroke = /^#[0-9a-f]{6}$/i.test(toString(value.stroke, 16)) ? toString(value.stroke, 16) : '#111111';
  return {
    id,
    content,
    x: Math.round(clampNumber(value.x, 80, TARGET_WIDTH - 80, index === 1 ? 1010 : 640)),
    y: Math.round(clampNumber(value.y, 72, TARGET_HEIGHT - 72, index === 1 ? 162 : 552)),
    fontFamily,
    fontSize: Math.round(clampNumber(value.fontSize, 24, 140, index === 1 ? 44 : 88)),
    fontWeight: Math.round(clampNumber(value.fontWeight, 300, 950, 900)),
    fill,
    stroke,
    strokeWidth: clampNumber(value.strokeWidth, 0, 20, index === 1 ? 7 : 10),
    shadow: toString(value.shadow, 120) || '0 12px 24px rgba(0,0,0,0.72)',
    align,
    rotation: clampNumber(value.rotation, -18, 18, index === 1 ? -4 : 0),
    zIndex: Math.round(clampNumber(value.zIndex, 0, 99, index + 5)),
  };
}

export function normalizeThumbnailReleaseTextLayers(input: unknown, fallbackHeadline = '먹방 레전드') {
  const rawLayers = Array.isArray(input) ? input : [];
  const normalized = rawLayers
    .map((layer, index) => normalizeTextLayer(layer, index, fallbackHeadline))
    .filter((layer): layer is ThumbnailReleaseTextLayer => Boolean(layer))
    .slice(0, MAX_TEXT_LAYERS);
  if (normalized.length) return normalized;
  return [
    normalizeTextLayer({ id: 'headline', content: fallbackHeadline, x: 640, y: 552, fontFamily: 'Impact', fontSize: 88, zIndex: 5 }, 0, fallbackHeadline)!,
    normalizeTextLayer({ id: 'subHeadline', content: '검증 완료', x: 1010, y: 162, fontFamily: 'Pretendard', fontSize: 44, fill: '#fff200', rotation: -4, zIndex: 6 }, 1, fallbackHeadline)!,
  ];
}

function normalizeReleaseRow(row: ReleaseRow): ThumbnailDurableRelease | null {
  if (row.release_key !== THUMBNAIL_RELEASE_KEY || row.status !== 'active') return null;
  if (row.provider_id !== 'local-codex' || row.model !== 'gpt-image-2' || row.model_provenance !== 'exact') return null;
  if (!row.browser_image_path.startsWith(SAFE_BROWSER_IMAGE_PREFIX)) return null;
  const issueTags = Array.isArray(row.issue_tags) ? row.issue_tags : [];
  if (issueTags.length !== 1 || issueTags[0] !== 'none') return null;
  const textLayers = normalizeThumbnailReleaseTextLayers(row.text_layers, toString(row.candidate_id, 32));
  const release: ThumbnailDurableRelease = {
    id: row.id,
    releaseKey: THUMBNAIL_RELEASE_KEY,
    status: 'active',
    candidateId: row.candidate_id,
    sourceManifestId: row.source_manifest_id,
    sourceImageId: row.source_image_id,
    browserImagePath: row.browser_image_path,
    sha256: row.sha256,
    width: 1280,
    height: 720,
    mimeType: 'image/png',
    providerId: 'local-codex',
    model: 'gpt-image-2',
    modelProvenance: 'exact',
    score: Number(row.score),
    issueTags: ['none'],
    textLayers,
    canvas: { width: 1280, height: 720 },
    sourceQualityGate: isRecord(row.source_quality_gate) ? row.source_quality_gate : {},
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
  assertRedactedPublicPayload(release);
  return release;
}

function createUnavailablePayload(reason: string, warnings: string[] = []): ThumbnailDurableReleasePayload {
  return {
    status: 'unavailable',
    updatedAt: null,
    release: null,
    diagnostics: {
      durableRegistryAvailable: false,
      storageBucket: THUMBNAIL_RELEASE_STORAGE_BUCKET,
      releaseKey: THUMBNAIL_RELEASE_KEY,
      reason,
      warnings,
    },
  };
}

function createSupabaseRegistryAdapter(): ThumbnailReleaseRegistryAdapter {
  const supabase = createSupabaseServiceRoleClient();
  return {
    async readCurrentRelease(releaseKey: string) {
      const { data, error } = await supabase
        .from(THUMBNAIL_RELEASE_TABLE)
        .select('*')
        .eq('release_key', releaseKey)
        .eq('status', 'active')
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as ReleaseRow | null;
    },
    async publishRelease(row: InsertReleaseRow) {
      const { data, error } = await supabase
        .rpc('publish_youtube_thumbnail_release', {
          p_id: row.id,
          p_release_key: row.release_key,
          p_candidate_id: row.candidate_id,
          p_source_manifest_id: row.source_manifest_id,
          p_source_image_id: row.source_image_id,
          p_storage_bucket: row.storage_bucket,
          p_storage_object_path: row.storage_object_path,
          p_browser_image_path: row.browser_image_path,
          p_sha256: row.sha256,
          p_score: row.score,
          p_issue_tags: row.issue_tags,
          p_text_layers: row.text_layers,
          p_canvas: row.canvas,
          p_source_quality_gate: row.source_quality_gate,
          p_published_by: row.published_by ?? null,
          p_published_at: row.published_at,
        });
      if (error) throw error;
      return data as ReleaseRow;
    },
    async uploadReleaseAsset(bucket: string, objectPath: string, bytes: Buffer) {
      const { error } = await supabase.storage.from(bucket).upload(objectPath, bytes, {
        contentType: 'image/png',
        upsert: true,
      });
      if (error) throw error;
    },
    async deleteReleaseAsset(bucket: string, objectPath: string) {
      const { error } = await supabase.storage.from(bucket).remove([objectPath]);
      if (error) throw error;
    },
    async downloadReleaseAsset(bucket: string, objectPath: string) {
      const { data, error } = await supabase.storage.from(bucket).download(objectPath);
      if (error) throw error;
      const bytes = Buffer.from(await data.arrayBuffer());
      return { bytes, contentType: data.type || 'image/png' };
    },
  };
}

function getRegistryAdapter(env: ThumbnailReleaseEnv, options: ThumbnailReleaseRegistryOptions) {
  if (options.adapter) return options.adapter;
  if (!isSupabaseEnvConfigured(env)) return null;
  return createSupabaseRegistryAdapter();
}

export async function readCurrentThumbnailDurableRelease(
  env: ThumbnailReleaseEnv = process.env,
  options: ThumbnailReleaseRegistryOptions = {},
): Promise<ThumbnailDurableReleasePayload> {
  const adapter = getRegistryAdapter(env, options);
  if (!adapter) return createUnavailablePayload(THUMBNAIL_DURABLE_RELEASE_REASON_MISSING_ENV);

  try {
    const row = await adapter.readCurrentRelease(THUMBNAIL_RELEASE_KEY);
    if (!row) {
      return {
        status: 'empty',
        updatedAt: null,
        release: null,
        diagnostics: {
          durableRegistryAvailable: true,
          storageBucket: THUMBNAIL_RELEASE_STORAGE_BUCKET,
          releaseKey: THUMBNAIL_RELEASE_KEY,
          warnings: [],
        },
      };
    }
    const release = normalizeReleaseRow(row);
    if (!release) return createUnavailablePayload('invalid_release_row', ['active row failed strict normalization']);
    const payload: ThumbnailDurableReleasePayload = {
      status: 'ready',
      updatedAt: release.updatedAt,
      release,
      diagnostics: {
        durableRegistryAvailable: true,
        storageBucket: THUMBNAIL_RELEASE_STORAGE_BUCKET,
        releaseKey: THUMBNAIL_RELEASE_KEY,
        warnings: [],
      },
    };
    assertRedactedPublicPayload(payload);
    return payload;
  } catch (error) {
    if (isMissingReleaseTableError(error)) return createUnavailablePayload(THUMBNAIL_DURABLE_RELEASE_REASON_MISSING_TABLE);
    throw error;
  }
}

export async function publishThumbnailDurableRelease(
  request: ThumbnailPublishDurableReleaseRequest,
  env: ThumbnailReleaseEnv = process.env,
  options: ThumbnailReleaseRegistryOptions = {},
): Promise<ThumbnailDurableReleasePayload> {
  const adapter = getRegistryAdapter(env, options);
  if (!adapter) return createUnavailablePayload(THUMBNAIL_DURABLE_RELEASE_REASON_MISSING_ENV);

  const candidateId = toString(request.candidateId, 120).replace(/[^A-Za-z0-9_.-]/g, '-');
  if (!candidateId) throw new Error('thumbnail_durable_release_candidate_id_required');
  const candidatesPayload = await readThumbnailReleaseCandidates(env, options);
  const candidate = candidatesPayload.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error('thumbnail_durable_release_candidate_not_found');
  if (candidate.providerId !== 'local-codex' || candidate.model !== 'gpt-image-2' || candidate.modelProvenance !== 'exact') {
    throw new Error('thumbnail_durable_release_non_exact_candidate');
  }
  if (candidate.issueTags.length !== 1 || candidate.issueTags[0] !== 'none') throw new Error('thumbnail_durable_release_candidate_has_issues');

  const sourceImagePath = resolveCandidatePublicImagePath(candidate, options);
  const bytes = await readFile(sourceImagePath);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  const candidateSha256 = normalizeHexSha256(candidate.sha256);
  if (!SHA256_HEX_PATTERN.test(candidateSha256) || candidateSha256 !== actualSha256) {
    throw new Error('thumbnail_durable_release_candidate_sha_mismatch');
  }

  const releaseId = options.releaseId && SAFE_ID_PATTERN.test(options.releaseId) ? options.releaseId : randomUUID();
  const now = (options.now ?? new Date()).toISOString();
  const objectPath = `youtube-thumbnail-generator/${releaseId}.png`;
  const browserImagePath = releaseAssetBrowserPath(releaseId);
  const textLayers = normalizeThumbnailReleaseTextLayers(request.textLayers, candidate.headline);
  const sourceQualityGate = createReleaseSourceQualityGate(candidate, actualSha256);

  if (!isReleaseStorageObjectPath(objectPath)) throw new Error('thumbnail_durable_release_storage_path_invalid');
  await adapter.uploadReleaseAsset(THUMBNAIL_RELEASE_STORAGE_BUCKET, objectPath, bytes);
  try {
    await adapter.publishRelease({
      id: releaseId,
      release_key: THUMBNAIL_RELEASE_KEY,
      status: 'active',
      candidate_id: candidate.id,
      source_manifest_id: candidate.sourceManifestId,
      source_image_id: candidate.sourceImageId,
      storage_bucket: THUMBNAIL_RELEASE_STORAGE_BUCKET,
      storage_object_path: objectPath,
      browser_image_path: browserImagePath,
      sha256: actualSha256,
      width: 1280,
      height: 720,
      mime_type: 'image/png',
      provider_id: 'local-codex',
      model: 'gpt-image-2',
      model_provenance: 'exact',
      score: candidate.score,
      issue_tags: ['none'],
      text_layers: textLayers,
      canvas: { width: 1280, height: 720 },
      source_quality_gate: sourceQualityGate,
      published_by: request.publishedBy ?? null,
      published_at: now,
      created_at: now,
    });
  } catch (error) {
    try {
      await adapter.deleteReleaseAsset(THUMBNAIL_RELEASE_STORAGE_BUCKET, objectPath);
    } catch (cleanupError) {
      console.error('[youtube-thumbnail/durable-release] failed to clean uploaded asset after publish error:', cleanupError);
    }
    if (isMissingReleaseTableError(error)) return createUnavailablePayload(THUMBNAIL_DURABLE_RELEASE_REASON_MISSING_TABLE);
    throw error;
  }

  const payload = await readCurrentThumbnailDurableRelease(env, { ...options, adapter });
  assertRedactedPublicPayload(payload);
  return payload;
}

export async function readThumbnailDurableReleaseAsset(
  releaseId: string,
  env: ThumbnailReleaseEnv = process.env,
  options: ThumbnailReleaseRegistryOptions = {},
) {
  const adapter = getRegistryAdapter(env, options);
  if (!adapter) throw new Error(THUMBNAIL_DURABLE_RELEASE_REASON_MISSING_ENV);
  const normalizedReleaseId = toString(releaseId, 80);
  if (!SAFE_ID_PATTERN.test(normalizedReleaseId)) throw new Error('thumbnail_durable_release_id_invalid');
  const row = await adapter.readCurrentRelease(THUMBNAIL_RELEASE_KEY).catch((error: unknown) => {
    if (isMissingReleaseTableError(error)) throw new Error(THUMBNAIL_DURABLE_RELEASE_REASON_MISSING_TABLE);
    throw error;
  });
  if (!row || row.id !== normalizedReleaseId || row.status !== 'active') throw new Error('thumbnail_durable_release_asset_not_found');
  if (row.browser_image_path !== releaseAssetBrowserPath(normalizedReleaseId)) throw new Error('thumbnail_durable_release_asset_path_mismatch');
  if (row.storage_bucket !== THUMBNAIL_RELEASE_STORAGE_BUCKET || !isReleaseStorageObjectPath(row.storage_object_path)) {
    throw new Error('thumbnail_durable_release_storage_path_invalid');
  }
  return adapter.downloadReleaseAsset(row.storage_bucket, row.storage_object_path);
}
