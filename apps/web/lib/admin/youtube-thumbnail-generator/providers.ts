import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

import type {
  ThumbnailGenerationResult,
  ThumbnailGeneratorPayload,
  ThumbnailProviderId,
  ThumbnailReferenceImage,
} from './types';
import {
  ThumbnailGenerationError,
  YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
  YOUTUBE_THUMBNAIL_TARGET_WIDTH,
} from './types';
import { buildYoutubeThumbnailPrompt } from './prompt';

const LOCAL_CODEX_DEFAULT_MODEL = 'unconfigured:gpt-image-2';
const LOCAL_CODEX_EXACT_IMAGE_MODEL = 'gpt-image-2';
const LOCAL_CODEX_PROVIDER_ID = 'local-codex' as const;
const OPENAI_GPT_IMAGE_2_PROVIDER_ID = 'openai-gpt-image-2' as const;
const OPENAI_GPT_IMAGE_2_MODEL = 'gpt-image-2';
const OPENAI_GPT_IMAGE_2_DEFAULT_SIZE = `${YOUTUBE_THUMBNAIL_TARGET_WIDTH}x${YOUTUBE_THUMBNAIL_TARGET_HEIGHT}`;
const OPENAI_GPT_IMAGE_2_DEFAULT_QUALITY = 'medium';
const DEFAULT_OPENAI_IMAGE_API_URL = 'https://api.openai.com/v1/images/generations';
const DEFAULT_LOCAL_CODEX_SCRIPT = 'scripts/codex-imagegen-thumbnail-provider.py';
const DEFAULT_LOCAL_CODEX_PROVENANCE_FILE = '.omx/artifacts/gpt-image-2-provenance/latest-verified.json';
const DEFAULT_LOCAL_CODEX_DURABLE_OUTPUT_DIR = '.omx/artifacts/gpt-image-2-provenance/generated';
const OPENAI_IMAGE_API_TIMEOUT_MS = 300_000;
const LOCAL_CODEX_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const LOCAL_CODEX_COMMAND_MAX_OUTPUT_BYTES = 3 * 1024 * 1024;
const LOCAL_CODEX_C2PATOOL_TIMEOUT_MS = 30 * 1000;
const LOCAL_CODEX_C2PATOOL_MAX_OUTPUT_BYTES = 3 * 1024 * 1024;
const THUMBNAIL_GENERATION_CACHE_VERSION = 'thumbnail-generation-cache-v1';
const THUMBNAIL_GENERATION_CACHE_DIR = '.omx/runtime/youtube-thumbnail-cache';

type ThumbnailProviderExecutionOptions = {
  signal?: AbortSignal;
  runId?: string;
};

type ThumbnailGenerationCacheEntry = {
  version: typeof THUMBNAIL_GENERATION_CACHE_VERSION;
  cacheKey: string;
  createdAt: string;
  providerId: typeof LOCAL_CODEX_PROVIDER_ID;
  model: typeof LOCAL_CODEX_EXACT_IMAGE_MODEL;
  modelProvenance: 'exact';
  mime: 'image/png';
  width: typeof YOUTUBE_THUMBNAIL_TARGET_WIDTH;
  height: typeof YOUTUBE_THUMBNAIL_TARGET_HEIGHT;
  imageFile: string;
  prompt: string;
  warnings: string[];
};

type LocalCodexProviderProofSummary = {
  authMode: 'codex_oauth';
  endpoint: string;
  agentModel?: string;
  requestToolType: 'image_generation';
  requestToolModel: typeof LOCAL_CODEX_EXACT_IMAGE_MODEL;
  responseId: string;
  imageCallId: string;
  imageItemCount: number;
  mime: 'image/png';
  bytes: number;
  outputPath: string;
  c2pa: {
    ok: true;
    claimGeneratorInfo: 'OpenAI Media Service API';
    softwareAgentName: 'gpt-image';
    softwareAgentVersion: '2.0';
    source: 'png-caBX-c2pa';
  };
  generatedAt?: string;
};

type LocalCodexCommandResult = {
  ok?: boolean;
  providerId?: string;
  authMode?: string;
  endpoint?: string;
  agentModel?: string;
  requestToolType?: string;
  requestToolModel?: string;
  model?: string;
  modelProvenance?: string;
  responseId?: string;
  imageCallId?: string;
  imageItemCount?: number;
  rawImageItemTypes?: string[];
  mime?: string;
  bytes?: number;
  path?: string;
  transientOutputPath?: string;
  outputPath?: string;
  durableOutputPath?: string;
  rawGeneratedPath?: string;
  rawResponsePath?: string;
  hasOpenAIAPIKey?: boolean;
  generatedAt?: string;
  warnings?: string[];
  code?: string;
  error?: string;
};

export function isThumbnailProviderId(value: unknown): value is ThumbnailProviderId {
  return value === LOCAL_CODEX_PROVIDER_ID || value === OPENAI_GPT_IMAGE_2_PROVIDER_ID;
}

export function resolveLocalCodexThumbnailModel(env: NodeJS.ProcessEnv = process.env) {
  return env.THUMBNAIL_LOCAL_CODEX_IMAGE_MODEL?.trim() || LOCAL_CODEX_DEFAULT_MODEL;
}

export function resolveOpenAiGptImage2ThumbnailModel(env: NodeJS.ProcessEnv = process.env) {
  return env.THUMBNAIL_OPENAI_IMAGE_MODEL?.trim() || OPENAI_GPT_IMAGE_2_MODEL;
}

function resolveRepoRoot(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.TZUDONG_REPO_ROOT?.trim() || env.CODEX_IMAGEGEN_WORKDIR?.trim();
  if (configured) return resolve(configured);
  return process.cwd().endsWith('/apps/web') ? resolve(process.cwd(), '../..') : process.cwd();
}

function resolveDefaultLocalCodexScript(env: NodeJS.ProcessEnv) {
  return resolve(resolveRepoRoot(env), DEFAULT_LOCAL_CODEX_SCRIPT);
}

function parseArgsJson(value: string | undefined) {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function resolveNodeBinary() {
  return process.versions.bun ? (process.env.NODE || 'node') : process.execPath;
}

function resolvePythonBinary(env: NodeJS.ProcessEnv = process.env) {
  return env.PYTHON?.trim() || process.env.PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3');
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
function toShellScriptArg(command: string) {
  return process.platform === 'win32' ? command.replaceAll('\\', '/') : command;
}


function resolveScriptCommand(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
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

function resolveLocalCodexThumbnailCommandParts(env: NodeJS.ProcessEnv) {
  const configuredCommand = env.THUMBNAIL_LOCAL_CODEX_COMMAND?.trim();
  if (configuredCommand) {
    const args = parseArgsJson(env.THUMBNAIL_LOCAL_CODEX_ARGS_JSON);
    return {
      command: configuredCommand,
      args,
      label: [configuredCommand, ...args].join(' '),
      scriptPath: configuredCommand,
      configured: true,
    };
  }

  const scriptPath = resolveDefaultLocalCodexScript(env);
  const python = resolvePythonBinary(env);
  return {
    command: python,
    args: [scriptPath],
    label: `${python} ${DEFAULT_LOCAL_CODEX_SCRIPT}`,
    scriptPath,
    configured: false,
  };
}

function isLocalCodexCommandAvailable(env: NodeJS.ProcessEnv) {
  const commandParts = resolveLocalCodexThumbnailCommandParts(env);
  if (!commandParts.configured) return existsSync(commandParts.scriptPath);
  if (commandParts.command.includes('/') || commandParts.command.includes('\\')) {
    return existsSync(commandParts.command);
  }
  return true;
}

function getLocalCodexCommand(env: NodeJS.ProcessEnv) {
  return resolveLocalCodexThumbnailCommandParts(env).label || undefined;
}

function resolveLocalCodexProvenanceFile(env: NodeJS.ProcessEnv) {
  return resolve(
    resolveRepoRoot(env),
    env.THUMBNAIL_LOCAL_CODEX_PROVENANCE_FILE?.trim() || DEFAULT_LOCAL_CODEX_PROVENANCE_FILE,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getLocalCodexDurableOutputRoot(env: NodeJS.ProcessEnv = process.env) {
  return resolve(
    resolveRepoRoot(env),
    env.THUMBNAIL_LOCAL_CODEX_DURABLE_OUTPUT_DIR?.trim() || DEFAULT_LOCAL_CODEX_DURABLE_OUTPUT_DIR,
  );
}

function getThumbnailGenerationCacheRoot(env: NodeJS.ProcessEnv = process.env) {
  return resolve(
    resolveRepoRoot(env),
    env.THUMBNAIL_GENERATION_CACHE_ROOT?.trim() || THUMBNAIL_GENERATION_CACHE_DIR,
  );
}

function sha256(value: string | Uint8Array | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createThumbnailGenerationCacheKey(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[],
  prompt: string,
) {
  return sha256(stableStringify({
    version: THUMBNAIL_GENERATION_CACHE_VERSION,
    providerId: payload.providerId,
    generationMode: payload.generationMode,
    model: LOCAL_CODEX_EXACT_IMAGE_MODEL,
    promptHash: sha256(prompt),
    references: referenceImages.map((image, index) => ({
      index,
      name: image.name,
      role: image.role,
      mime: image.mime,
      bytes: image.bytes.byteLength,
      sha256: sha256(image.bytes),
    })),
  }));
}

function decodeCacheDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/);
  return match ? Buffer.from(match[1].replace(/\s+/g, ''), 'base64') : null;
}

async function readThumbnailGenerationCache(
  cacheKey: string,
  prompt: string,
  env: NodeJS.ProcessEnv,
): Promise<ThumbnailGenerationResult | null> {
  if (env.THUMBNAIL_GENERATION_CACHE_DISABLED === '1') return null;
  const cacheRoot = getThumbnailGenerationCacheRoot(env);
  const entryPath = resolve(cacheRoot, `${cacheKey}.json`);
  const imagePath = resolve(cacheRoot, `${cacheKey}.png`);
  if (!isPathInside(cacheRoot, entryPath) || !isPathInside(cacheRoot, imagePath)) return null;

  try {
    const entry = JSON.parse(await readFile(entryPath, 'utf8')) as ThumbnailGenerationCacheEntry;
    if (
      entry.version !== THUMBNAIL_GENERATION_CACHE_VERSION ||
      entry.cacheKey !== cacheKey ||
      entry.providerId !== LOCAL_CODEX_PROVIDER_ID ||
      entry.model !== LOCAL_CODEX_EXACT_IMAGE_MODEL ||
      entry.modelProvenance !== 'exact' ||
      entry.mime !== 'image/png' ||
      entry.imageFile !== `${cacheKey}.png` ||
      entry.prompt !== prompt ||
      !hasPngMagic(imagePath) ||
      !hasStructuralExactGptImage2C2paProof(imagePath, env)
    ) {
      return null;
    }
    const bytes = await readFile(imagePath);
    return {
      baseImage: {
        dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
        mime: 'image/png',
        width: YOUTUBE_THUMBNAIL_TARGET_WIDTH,
        height: YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
        targetWidth: YOUTUBE_THUMBNAIL_TARGET_WIDTH,
        targetHeight: YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
        providerId: LOCAL_CODEX_PROVIDER_ID,
        model: LOCAL_CODEX_EXACT_IMAGE_MODEL,
        modelProvenance: 'exact',
      },
      prompt,
      warnings: [
        'thumbnail_generation_cache_hit: exact gpt-image-2 cached base image reused.',
        `thumbnail_generation_cache_key:${cacheKey}`,
        ...entry.warnings.filter((warning) => typeof warning === 'string').slice(0, 8),
      ],
    };
  } catch {
    return null;
  }
}

async function writeThumbnailGenerationCache(
  cacheKey: string,
  result: ThumbnailGenerationResult,
  env: NodeJS.ProcessEnv,
) {
  if (env.THUMBNAIL_GENERATION_CACHE_DISABLED === '1') return;
  if (
    result.baseImage.providerId !== LOCAL_CODEX_PROVIDER_ID ||
    result.baseImage.model !== LOCAL_CODEX_EXACT_IMAGE_MODEL ||
    result.baseImage.modelProvenance !== 'exact' ||
    result.baseImage.mime !== 'image/png'
  ) {
    return;
  }
  const bytes = decodeCacheDataUrl(result.baseImage.dataUrl);
  if (!bytes || bytes.length <= 0) return;

  const cacheRoot = getThumbnailGenerationCacheRoot(env);
  const imagePath = resolve(cacheRoot, `${cacheKey}.png`);
  const entryPath = resolve(cacheRoot, `${cacheKey}.json`);
  if (!isPathInside(cacheRoot, imagePath) || !isPathInside(cacheRoot, entryPath)) return;
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(imagePath, bytes);
  const entry: ThumbnailGenerationCacheEntry = {
    version: THUMBNAIL_GENERATION_CACHE_VERSION,
    cacheKey,
    createdAt: new Date().toISOString(),
    providerId: LOCAL_CODEX_PROVIDER_ID,
    model: LOCAL_CODEX_EXACT_IMAGE_MODEL,
    modelProvenance: 'exact',
    mime: 'image/png',
    width: YOUTUBE_THUMBNAIL_TARGET_WIDTH,
    height: YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
    imageFile: `${cacheKey}.png`,
    prompt: result.prompt,
    warnings: result.warnings.filter((warning) => typeof warning === 'string').slice(0, 12),
  };
  await writeFile(entryPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
}

function isPathInside(root: string, target: string) {
  const safeRoot = resolve(root);
  const safeTarget = resolve(target);
  const pathFromRoot = relative(safeRoot, safeTarget);
  return !pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot);
}

function hasPngMagic(outputPath: string) {
  try {
    const magic = readFileSync(outputPath).subarray(0, 8);
    return magic.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  } catch {
    return false;
  }
}

function hasExactGptImage2C2paProof(proof: Record<string, unknown>) {
  const c2pa = proof.c2pa;
  if (!c2pa || typeof c2pa !== 'object') return false;
  const value = c2pa as Record<string, unknown>;
  return value.ok === true
    && value.claimGeneratorInfo === 'OpenAI Media Service API'
    && value.softwareAgentName === 'gpt-image'
    && value.softwareAgentVersion === '2.0'
    && value.source === 'png-caBX-c2pa';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validationCodes(validation: unknown, field: string) {
  const validationRecord = asRecord(validation);
  const entries = validationRecord?.[field];
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => asRecord(entry)?.code)
    .filter((code): code is string => typeof code === 'string');
}

function candidateC2paToolBins(env: NodeJS.ProcessEnv) {
  const configured = env.THUMBNAIL_LOCAL_CODEX_C2PATOOL_BIN?.trim()
    || env.CODEX_IMAGEGEN_C2PATOOL_BIN?.trim()
    || env.C2PATOOL_BIN?.trim();
  if (configured) return [configured];
  const candidates = ['c2patool'];
  const cargoBin = join(homedir(), '.cargo', 'bin', 'c2patool');
  if (existsSync(cargoBin)) candidates.push(cargoBin);
  return candidates;
}

function hasStructuralExactGptImage2C2paProof(outputPath: string, env: NodeJS.ProcessEnv) {
  let lastFailure = '';
  for (const c2patoolBin of candidateC2paToolBins(env)) {
    const toolCommand = resolveScriptCommand(c2patoolBin, ['--crjson', outputPath], env);
    const result = spawnSync(toolCommand.command, toolCommand.args, {
      encoding: 'utf8',
      maxBuffer: LOCAL_CODEX_C2PATOOL_MAX_OUTPUT_BYTES,
      timeout: Number(env.THUMBNAIL_LOCAL_CODEX_C2PATOOL_TIMEOUT_MS ?? LOCAL_CODEX_C2PATOOL_TIMEOUT_MS),
      windowsHide: true,
    });
    if (result.error) {
      lastFailure = result.error.message;
      if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      return false;
    }
    if (result.status !== 0 || !result.stdout.trim()) {
      lastFailure = result.stderr.slice(0, 800);
      continue;
    }

    try {
      const payload = asRecord(JSON.parse(result.stdout));
      const manifests = payload?.manifests;
      if (!Array.isArray(manifests)) continue;
      for (const manifestValue of manifests) {
        const manifest = asRecord(manifestValue);
        if (!manifest) continue;
        const claim = asRecord(manifest['claim.v2']) ?? asRecord(manifest.claim);
        const generator = asRecord(claim?.claim_generator_info);
        const assertions = asRecord(manifest.assertions);
        const actionsPayload = asRecord(assertions?.['c2pa.actions.v2']);
        const actions = actionsPayload?.actions;
        if (generator?.name !== 'OpenAI Media Service API' || !Array.isArray(actions)) continue;

        const hasGptImage2Action = actions.some((actionValue) => {
          const action = asRecord(actionValue);
          const softwareAgent = asRecord(action?.softwareAgent);
          return softwareAgent?.name === 'gpt-image' && String(softwareAgent.version) === '2.0';
        });
        if (!hasGptImage2Action) continue;

        const successCodes = new Set(validationCodes(manifest.validationResults, 'success'));
        if (!successCodes.has('claimSignature.validated') || !successCodes.has('assertion.dataHash.match')) {
          continue;
        }
        return true;
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'invalid c2patool JSON';
    }
  }

  if (lastFailure) {
    console.warn('[thumbnail/local-codex] c2patool structural proof failed:', lastFailure);
  }
  return false;
}

function getDurableProofOutputPath(
  proof: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!isNonEmptyString(proof.durableOutputPath)) return undefined;
  const outputPath = proof.durableOutputPath;
  const durableRoot = getLocalCodexDurableOutputRoot(env);
  if (!isPathInside(durableRoot, outputPath)) return undefined;
  if (!existsSync(durableRoot) || !existsSync(outputPath)) return undefined;

  try {
    const realRoot = realpathSync(durableRoot);
    const realOutputPath = realpathSync(outputPath);
    if (!isPathInside(realRoot, realOutputPath)) return undefined;
    const stats = statSync(realOutputPath);
    if (!stats.isFile()) return undefined;
    if (extname(realOutputPath).toLowerCase() !== '.png') return undefined;
    if (typeof proof.bytes !== 'number' || stats.size !== proof.bytes || stats.size <= 0) return undefined;
    if (!hasPngMagic(realOutputPath)) return undefined;
  } catch {
    return undefined;
  }

  return outputPath;
}

function toProofSummary(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): LocalCodexProviderProofSummary | null {
  if (!value || typeof value !== 'object') return null;
  const proof = value as Record<string, unknown>;
  if (
    proof.ok !== true ||
    proof.providerId !== LOCAL_CODEX_PROVIDER_ID ||
    proof.authMode !== 'codex_oauth' ||
    proof.requestToolType !== 'image_generation' ||
    proof.requestToolModel !== LOCAL_CODEX_EXACT_IMAGE_MODEL ||
    proof.model !== LOCAL_CODEX_EXACT_IMAGE_MODEL ||
    proof.modelProvenance !== 'exact' ||
    proof.mime !== 'image/png' ||
    !isNonEmptyString(proof.endpoint) ||
    !isNonEmptyString(proof.responseId) ||
    !isNonEmptyString(proof.imageCallId) ||
    typeof proof.imageItemCount !== 'number' ||
    proof.imageItemCount < 1 ||
    typeof proof.bytes !== 'number' ||
    proof.bytes <= 0 ||
    proof.hasOpenAIAPIKey !== false ||
    !hasExactGptImage2C2paProof(proof)
  ) {
    return null;
  }

  const outputPath = getDurableProofOutputPath(proof, env);
  if (!outputPath) return null;
  if (outputPath && !existsSync(outputPath)) return null;
  if (!hasStructuralExactGptImage2C2paProof(outputPath, env)) return null;

  return {
    authMode: 'codex_oauth',
    endpoint: proof.endpoint,
    agentModel: isNonEmptyString(proof.agentModel) ? proof.agentModel : undefined,
    requestToolType: 'image_generation',
    requestToolModel: LOCAL_CODEX_EXACT_IMAGE_MODEL,
    responseId: proof.responseId,
    imageCallId: proof.imageCallId,
    imageItemCount: proof.imageItemCount,
    mime: 'image/png',
    bytes: proof.bytes,
    outputPath,
    c2pa: {
      ok: true,
      claimGeneratorInfo: 'OpenAI Media Service API',
      softwareAgentName: 'gpt-image',
      softwareAgentVersion: '2.0',
      source: 'png-caBX-c2pa',
    },
    generatedAt: isNonEmptyString(proof.generatedAt) ? proof.generatedAt : undefined,
  };
}

function readLocalCodexProof(env: NodeJS.ProcessEnv) {
  try {
    return toProofSummary(JSON.parse(readFileSync(resolveLocalCodexProvenanceFile(env), 'utf8')), env);
  } catch {
    return null;
  }
}

function getLocalCodexStrictBlock(env: NodeJS.ProcessEnv) {
  const model = resolveLocalCodexThumbnailModel(env);
  if (model !== LOCAL_CODEX_EXACT_IMAGE_MODEL) {
    return {
      code: 'unsupported_model',
      status: 400,
      reason: 'local_codex_model_not_allowed',
      message: `Local Codex built-in image_generation은 exact ${LOCAL_CODEX_EXACT_IMAGE_MODEL}만 허용합니다. 요청 라벨 또는 다른 모델은 실행하지 않습니다: ${model}`,
      model,
    } as const;
  }

  if (!isLocalCodexCommandAvailable(env)) {
    return {
      code: 'provider_unavailable',
      status: 503,
      reason: 'local_codex_bridge_unavailable',
      message: 'Local Codex gpt-image-2 bridge 명령을 찾을 수 없어 생성을 중단합니다.',
      model,
    } as const;
  }

  const proof = readLocalCodexProof(env);
  if (!proof) {
    return {
      code: 'provider_unavailable',
      status: 503,
      reason: 'local_codex_model_provenance_unverified',
      message: 'Local Codex built-in image_generation은 exact gpt-image-2 provenance proof가 없거나 유효하지 않아 생성을 중단합니다.',
      model,
    } as const;
  }

  return null;
}

function throwIfProviderAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ThumbnailGenerationError('thumbnail_generation_aborted', '썸네일 이미지 생성 작업이 취소되었습니다.', 499);
  }
}

export async function probeLocalCodex(env: NodeJS.ProcessEnv = process.env) {
  const model = resolveLocalCodexThumbnailModel(env);
  const command = getLocalCodexCommand(env);
  const proof = readLocalCodexProof(env);
  const strictBlock = getLocalCodexStrictBlock(env);
  if (strictBlock) {
    return {
      available: false,
      reason: strictBlock.reason,
      model: strictBlock.model,
      strictExactModelRequired: true,
      command,
      providerId: LOCAL_CODEX_PROVIDER_ID,
      modelProvenance: 'unverified' as const,
      proof: proof ?? undefined,
    } as const;
  }

  return {
    available: true,
    reason: 'ready',
    model: LOCAL_CODEX_EXACT_IMAGE_MODEL,
    strictExactModelRequired: true,
    command,
    providerId: LOCAL_CODEX_PROVIDER_ID,
    modelProvenance: 'exact' as const,
    proof: proof!,
  } as const;
}

function createThumbnailRunId(runId?: string) {
  return runId || `thumbnail-local-codex-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

async function writeReferenceManifest(tempDir: string, referenceImages: ThumbnailReferenceImage[]) {
  const manifest: Array<{ path: string; name: string; mime: string; role: string }> = [];
  const refsDir = join(tempDir, 'references');
  await mkdir(refsDir, { recursive: true });
  for (const [index, image] of referenceImages.slice(0, 8).entries()) {
    const extension = image.mime === 'image/jpeg' ? 'jpg' : image.mime.split('/')[1];
    const path = join(refsDir, `reference-${index + 1}-${image.role}.${extension}`);
    await writeFile(path, image.bytes);
    manifest.push({ path, name: image.name, mime: image.mime, role: image.role });
  }
  const manifestPath = join(tempDir, 'references.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifestPath;
}

function expandLocalCodexArgs(
  args: string[],
  placeholders: Record<string, string>,
) {
  return args.map((arg) => Object.entries(placeholders).reduce(
    (next, [key, value]) => next.replaceAll(`{${key}}`, value),
    arg,
  ));
}

function buildLocalCodexCommand(
  env: NodeJS.ProcessEnv,
  placeholders: Record<string, string>,
) {
  const parts = resolveLocalCodexThumbnailCommandParts(env);
  const shouldUseConfiguredArgs = parts.configured && parts.args.length > 0;
  const args = shouldUseConfiguredArgs
    ? expandLocalCodexArgs(parts.args, placeholders)
    : [
      ...parts.args,
      '--prompt-file', placeholders.promptFile,
      '--output', placeholders.output,
      '--json-output', placeholders.outputJsonFile,
      '--model', placeholders.model,
      '--reference-manifest', placeholders.referenceManifest,
    ];
  return { command: parts.command, args };
}

function parseLocalCodexCommandStdout(stdout: string): LocalCodexCommandResult {
  const jsonLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.startsWith('{') && line.endsWith('}'));
  if (!jsonLine) {
    throw new ThumbnailGenerationError(
      'provider_unavailable',
      '로컬 Codex gpt-image-2 bridge가 JSON 결과를 반환하지 않았습니다.',
      502,
    );
  }
  try {
    return JSON.parse(jsonLine) as LocalCodexCommandResult;
  } catch (error) {
    throw new ThumbnailGenerationError(
      'provider_unavailable',
      `로컬 Codex gpt-image-2 bridge JSON 파싱에 실패했습니다: ${error instanceof Error ? error.message : 'unknown'}`,
      502,
    );
  }
}

function hasMatchingLatestCodexProof(
  commandProof: LocalCodexProviderProofSummary,
  latestProof: LocalCodexProviderProofSummary | null,
) {
  return Boolean(latestProof)
    && latestProof?.responseId === commandProof.responseId
    && latestProof.imageCallId === commandProof.imageCallId
    && latestProof.outputPath === commandProof.outputPath
    && latestProof.bytes === commandProof.bytes
    && latestProof.requestToolModel === commandProof.requestToolModel
    && latestProof.c2pa.softwareAgentName === 'gpt-image'
    && latestProof.c2pa.softwareAgentVersion === '2.0';
}

function validateLocalCodexCommandResult(
  result: LocalCodexCommandResult,
  expectedOutputPath: string,
  env: NodeJS.ProcessEnv,
): LocalCodexProviderProofSummary {
  const commandProof = toProofSummary(result, env);
  const transientOutputPath = result.transientOutputPath ?? result.path;
  const latestProof = commandProof ? readLocalCodexProof(env) : null;
  if (!commandProof || transientOutputPath !== expectedOutputPath || !hasMatchingLatestCodexProof(commandProof, latestProof)) {
    throw new ThumbnailGenerationError(
      'provider_unavailable',
      '로컬 Codex bridge가 exact local-codex gpt-image-2 provenance를 증명하지 못해 이미지를 폐기했습니다.',
      502,
    );
  }
  return commandProof;
}

function assertPathInside(root: string, target: string) {
  const safeRoot = resolve(root);
  const safeTarget = resolve(target);
  const pathFromRoot = relative(safeRoot, safeTarget);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw new ThumbnailGenerationError(
      'provider_unavailable',
      '로컬 Codex bridge 출력 경로가 허용된 임시 디렉터리를 벗어났습니다.',
      502,
    );
  }
  return safeTarget;
}

function readLocalCodexResultFile(outputJsonFile: string) {
  try {
    return JSON.parse(readFileSync(outputJsonFile, 'utf8')) as LocalCodexCommandResult;
  } catch {
    return null;
  }
}

function runLocalCodexThumbnailCommand(
  env: NodeJS.ProcessEnv,
  placeholders: Record<string, string>,
  options: ThumbnailProviderExecutionOptions,
) {
  const { command, args } = buildLocalCodexCommand(env, placeholders);
  const runnable = resolveScriptCommand(command, args, env);
  const repoRoot = resolveRepoRoot(env);
  return new Promise<LocalCodexCommandResult>((resolveCommand, rejectCommand) => {
    const child = spawn(runnable.command, runnable.args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env,
        CODEX_IMAGEGEN_WORKDIR: repoRoot,
        CODEX_IMAGEGEN_DURABLE_OUTPUT_DIR: getLocalCodexDurableOutputRoot(env),
        CODEX_IMAGEGEN_PROVENANCE_FILE: resolveLocalCodexProvenanceFile(env),
        OPENAI_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let stdout = '';
    let stderr = '';

    const rejectOnce = (error: ThumbnailGenerationError) => {
      if (settled) return;
      settled = true;
      rejectCommand(error);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      rejectOnce(new ThumbnailGenerationError(
        'provider_unavailable',
        '로컬 Codex gpt-image-2 bridge 실행 시간이 초과되었습니다.',
        504,
      ));
    }, LOCAL_CODEX_COMMAND_TIMEOUT_MS);

    const abortListener = () => {
      child.kill('SIGTERM');
      rejectOnce(new ThumbnailGenerationError('thumbnail_generation_aborted', '썸네일 이미지 생성 작업이 취소되었습니다.', 499));
    };
    options.signal?.addEventListener('abort', abortListener, { once: true });

    const appendStdout = (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > LOCAL_CODEX_COMMAND_MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        rejectOnce(new ThumbnailGenerationError(
          'provider_unavailable',
          '로컬 Codex gpt-image-2 bridge stdout이 허용 크기를 초과했습니다.',
          502,
        ));
      }
    };
    const appendStderr = (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > LOCAL_CODEX_COMMAND_MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        rejectOnce(new ThumbnailGenerationError(
          'provider_unavailable',
          '로컬 Codex gpt-image-2 bridge stderr가 허용 크기를 초과했습니다.',
          502,
        ));
      }
    };

    child.stdout.on('data', appendStdout);
    child.stderr.on('data', appendStderr);
    child.on('error', (error) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortListener);
      rejectOnce(new ThumbnailGenerationError(
        'provider_unavailable',
        `로컬 Codex gpt-image-2 bridge를 실행하지 못했습니다: ${error.message}`,
        502,
      ));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortListener);
      if (settled) return;
      if (code !== 0) {
        let parsed: LocalCodexCommandResult | null = null;
        try {
          parsed = stdout.trim() ? parseLocalCodexCommandStdout(stdout) : readLocalCodexResultFile(placeholders.outputJsonFile);
        } catch {
          parsed = readLocalCodexResultFile(placeholders.outputJsonFile);
        }
        rejectOnce(new ThumbnailGenerationError(
          'provider_unavailable',
          parsed?.error
            ? `로컬 Codex gpt-image-2 bridge 실패: ${parsed.error}`
            : `로컬 Codex gpt-image-2 bridge가 실패했습니다(exit ${code}): ${stderr.slice(0, 800)}`,
          502,
        ));
        return;
      }
      try {
        settled = true;
        resolveCommand(stdout.trim() ? parseLocalCodexCommandStdout(stdout) : readLocalCodexResultFile(placeholders.outputJsonFile) ?? parseLocalCodexCommandStdout(stdout));
      } catch (error) {
        rejectCommand(error);
      }
    });
  });
}

async function generateLocalCodexThumbnail(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[],
  prompt: string,
  env: NodeJS.ProcessEnv,
  options: ThumbnailProviderExecutionOptions,
): Promise<ThumbnailGenerationResult> {
  const startedAt = Date.now();
  throwIfProviderAborted(options.signal);
  const strictBlock = getLocalCodexStrictBlock(env);
  if (strictBlock) {
    throw new ThumbnailGenerationError(strictBlock.code, strictBlock.message, strictBlock.status);
  }

  const cacheKey = createThumbnailGenerationCacheKey(payload, referenceImages, prompt);
  const cached = await readThumbnailGenerationCache(cacheKey, prompt, env);
  if (cached) {
    cached.warnings.push(`thumbnail_timing_ms:provider_total=${Date.now() - startedAt}`);
    return cached;
  }

  const runId = createThumbnailRunId(options.runId);
  const tempDir = await mkdtemp(join(tmpdir(), `${runId}-`));
  const promptFile = join(tempDir, 'prompt.txt');
  const outputPath = assertPathInside(tempDir, join(tempDir, 'thumbnail.png'));
  const outputJsonFile = join(tempDir, 'provider-result.json');
  const referenceManifest = await writeReferenceManifest(tempDir, referenceImages);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(promptFile, prompt, 'utf8');

  const commandStartedAt = Date.now();
  const result = await runLocalCodexThumbnailCommand(
    env,
    {
      promptFile,
      output: outputPath,
      outputJsonFile,
      model: LOCAL_CODEX_EXACT_IMAGE_MODEL,
      referenceManifest,
      runId,
    },
    options,
  );
  const commandElapsedMs = Date.now() - commandStartedAt;
  const proofStartedAt = Date.now();
  const proof = validateLocalCodexCommandResult(result, outputPath, env);
  const proofElapsedMs = Date.now() - proofStartedAt;
  const proofOutputStat = await stat(proof.outputPath);
  if (!proofOutputStat.isFile() || proofOutputStat.size !== proof.bytes || proofOutputStat.size <= 0) {
    throw new ThumbnailGenerationError('provider_unavailable', '로컬 Codex bridge가 유효한 durable PNG 썸네일을 증명하지 못했습니다.', 502);
  }

  const bytes = await readFile(proof.outputPath);
  const warnings = [
    'local_codex_provider: generated via local Codex OAuth built-in image_generation and validated for exact gpt-image-2 provenance.',
    `exact_provenance: ${proof.requestToolType}.${proof.requestToolModel} response=${proof.responseId} call=${proof.imageCallId}`,
    ...(Array.isArray(result.warnings) ? result.warnings.filter((item): item is string => typeof item === 'string') : []),
  ];
  if (payload.generationMode === 'backend_agent') {
    warnings.push('backend_agent_mode: direct provider image generated after backend planning.');
  }

  const generatedResult: ThumbnailGenerationResult = {
    baseImage: {
      dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
      mime: 'image/png',
      width: YOUTUBE_THUMBNAIL_TARGET_WIDTH,
      height: YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
      targetWidth: YOUTUBE_THUMBNAIL_TARGET_WIDTH,
      targetHeight: YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
      providerId: LOCAL_CODEX_PROVIDER_ID,
      model: LOCAL_CODEX_EXACT_IMAGE_MODEL,
      modelProvenance: 'exact',
    },
    prompt,
    warnings,
  };
  generatedResult.warnings.push(`thumbnail_generation_cache_miss:${cacheKey}`);
  generatedResult.warnings.push(`thumbnail_timing_ms:provider_command=${commandElapsedMs}`);
  generatedResult.warnings.push(`thumbnail_timing_ms:provider_proof=${proofElapsedMs}`);
  generatedResult.warnings.push(`thumbnail_timing_ms:provider_total=${Date.now() - startedAt}`);
  await writeThumbnailGenerationCache(cacheKey, generatedResult, env);
  return generatedResult;
}

function getOpenAiGptImage2ApiKey(env: NodeJS.ProcessEnv) {
  return env.OPENAI_API_KEY?.trim() || undefined;
}

function getOpenAiGptImage2StrictBlock(env: NodeJS.ProcessEnv) {
  const model = resolveOpenAiGptImage2ThumbnailModel(env);
  if (model !== OPENAI_GPT_IMAGE_2_MODEL) {
    return {
      code: 'unsupported_model' as const,
      status: 400,
      reason: 'openai_model_not_allowed' as const,
      model,
      message: 'OpenAI 이미지 생성은 gpt-image-2만 허용됩니다.',
    };
  }
  if (!getOpenAiGptImage2ApiKey(env)) {
    return {
      code: 'provider_unavailable' as const,
      status: 400,
      reason: 'openai_api_key_required' as const,
      model,
      message: 'OpenAI gpt-image-2 생성을 사용하려면 브라우저 설정에 OpenAI API 키를 저장해 주세요.',
    };
  }
  return null;
}

function resolveOpenAiImageApiUrl(env: NodeJS.ProcessEnv) {
  return env.THUMBNAIL_OPENAI_IMAGE_API_URL?.trim() || DEFAULT_OPENAI_IMAGE_API_URL;
}

function resolveOpenAiImageApiTimeoutMs(env: NodeJS.ProcessEnv) {
  const parsed = Number(env.THUMBNAIL_OPENAI_IMAGE_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return OPENAI_IMAGE_API_TIMEOUT_MS;
  return Math.max(10_000, Math.min(600_000, Math.floor(parsed)));
}

function resolveOpenAiImageSize(env: NodeJS.ProcessEnv) {
  return env.THUMBNAIL_OPENAI_IMAGE_SIZE?.trim() || OPENAI_GPT_IMAGE_2_DEFAULT_SIZE;
}

function resolveOpenAiImageQuality(env: NodeJS.ProcessEnv) {
  return env.THUMBNAIL_OPENAI_IMAGE_QUALITY?.trim() || OPENAI_GPT_IMAGE_2_DEFAULT_QUALITY;
}

function assertOpenAiGptImage2Size(size: string) {
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) {
    throw new ThumbnailGenerationError('unsupported_model', 'OpenAI 이미지 크기는 1280x720처럼 숫자x숫자 형식이어야 합니다.', 400);
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 3840 ||
    height > 3840 ||
    width % 16 !== 0 ||
    height % 16 !== 0
  ) {
    throw new ThumbnailGenerationError(
      'unsupported_model',
      'OpenAI gpt-image-2 이미지 크기는 각 변이 16의 배수이고 최대 3840px 이하여야 합니다.',
      400,
    );
  }
}

function extractOpenAiImageBase64(responseJson: unknown) {
  const record = asRecord(responseJson);
  const data = Array.isArray(record?.data) ? record.data : [];
  const firstItem = asRecord(data[0]);
  const b64Json = firstItem?.b64_json;
  return typeof b64Json === 'string' && b64Json.trim() ? b64Json.trim() : null;
}

async function generateOpenAiGptImage2Thumbnail(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[],
  prompt: string,
  env: NodeJS.ProcessEnv,
  options: ThumbnailProviderExecutionOptions,
): Promise<ThumbnailGenerationResult> {
  const startedAt = Date.now();
  throwIfProviderAborted(options.signal);
  const strictBlock = getOpenAiGptImage2StrictBlock(env);
  if (strictBlock) {
    throw new ThumbnailGenerationError(strictBlock.code, strictBlock.message, strictBlock.status);
  }

  const apiKey = getOpenAiGptImage2ApiKey(env)!;
  const apiUrl = resolveOpenAiImageApiUrl(env);
  const size = resolveOpenAiImageSize(env);
  const quality = resolveOpenAiImageQuality(env);
  assertOpenAiGptImage2Size(size);

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), resolveOpenAiImageApiTimeoutMs(env));
  const abortListener = () => timeoutController.abort();
  options.signal?.addEventListener('abort', abortListener, { once: true });
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      signal: timeoutController.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_GPT_IMAGE_2_MODEL,
        prompt,
        size,
        quality,
        n: 1,
      }),
    });
    const responseJson = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const errorRecord = asRecord(asRecord(responseJson)?.error);
      const errorMessage = typeof errorRecord?.message === 'string'
        ? errorRecord.message
        : `OpenAI Images API 요청이 실패했습니다(status ${response.status}).`;
      throw new ThumbnailGenerationError('provider_unavailable', `OpenAI gpt-image-2 생성 실패: ${errorMessage}`, response.status);
    }

    const b64Json = extractOpenAiImageBase64(responseJson);
    if (!b64Json) {
      throw new ThumbnailGenerationError('provider_unavailable', 'OpenAI gpt-image-2 응답에서 이미지를 찾지 못했습니다.', 502);
    }

    const [width, height] = size.split('x').map((value) => Number(value));
    return {
      baseImage: {
        dataUrl: `data:image/png;base64,${b64Json}`,
        mime: 'image/png',
        width,
        height,
        targetWidth: YOUTUBE_THUMBNAIL_TARGET_WIDTH,
        targetHeight: YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
        providerId: OPENAI_GPT_IMAGE_2_PROVIDER_ID,
        model: OPENAI_GPT_IMAGE_2_MODEL,
        modelProvenance: 'requested-label',
      },
      prompt,
      warnings: [
        'openai_gpt_image_2_provider: generated through a browser-provided, request-scoped OpenAI API key.',
        'openai_gpt_image_2_requested_label: API request was pinned to model=gpt-image-2; no alternate image model fallback was used.',
        'browser_api_key_storage: key is accepted only from the current browser request and is not persisted by the server.',
        ...(referenceImages.length
          ? [`openai_reference_images_described_only:${referenceImages.length}`]
          : []),
        ...(payload.generationMode === 'backend_agent'
          ? ['backend_agent_mode: direct OpenAI provider image generated after backend planning.']
          : []),
        `thumbnail_timing_ms:provider_total=${Date.now() - startedAt}`,
      ],
    };
  } catch (error) {
    if (timeoutController.signal.aborted || options.signal?.aborted) {
      throw new ThumbnailGenerationError('thumbnail_generation_aborted', 'OpenAI gpt-image-2 이미지 생성 작업이 취소되었거나 시간이 초과되었습니다.', options.signal?.aborted ? 499 : 504);
    }
    if (error instanceof ThumbnailGenerationError) throw error;
    throw new ThumbnailGenerationError(
      'provider_unavailable',
      `OpenAI gpt-image-2 생성 요청을 처리하지 못했습니다: ${error instanceof Error ? error.message : 'unknown'}`,
      502,
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortListener);
  }
}

export async function generateYoutubeThumbnailWithPrompt(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[],
  prompt: string,
  env: NodeJS.ProcessEnv = process.env,
  options: ThumbnailProviderExecutionOptions = {},
): Promise<ThumbnailGenerationResult> {
  switch (payload.providerId) {
    case 'local-codex':
      return generateLocalCodexThumbnail(payload, referenceImages, prompt, env, options);
    case 'openai-gpt-image-2':
      return generateOpenAiGptImage2Thumbnail(payload, referenceImages, prompt, env, options);
    default: {
      throw new ThumbnailGenerationError('provider_unavailable', '지원하지 않는 provider입니다.', 400);
    }
  }
}

export async function generateYoutubeThumbnail(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[],
  env: NodeJS.ProcessEnv = process.env,
  options: ThumbnailProviderExecutionOptions = {},
): Promise<ThumbnailGenerationResult> {
  const prompt = buildYoutubeThumbnailPrompt(payload, referenceImages);
  return generateYoutubeThumbnailWithPrompt(payload, referenceImages, prompt, env, options);
}

export function getThumbnailProviderAvailability(env: NodeJS.ProcessEnv = process.env) {
  const model = resolveLocalCodexThumbnailModel(env);
  const command = getLocalCodexCommand(env);
  const proof = readLocalCodexProof(env);
  const strictBlock = getLocalCodexStrictBlock(env);
  const openAiStrictBlock = getOpenAiGptImage2StrictBlock(env);
  const openAiAvailability = openAiStrictBlock
    ? {
      available: false,
      reason: openAiStrictBlock.reason,
      model: openAiStrictBlock.model,
      providerId: OPENAI_GPT_IMAGE_2_PROVIDER_ID,
      modelProvenance: 'requested-label' as const,
      liveEnabled: true,
      browserKeyStorage: 'browser_local_storage_only' as const,
      strictExactModelRequired: false,
    }
    : {
      available: true,
      reason: 'ready' as const,
      model: OPENAI_GPT_IMAGE_2_MODEL,
      providerId: OPENAI_GPT_IMAGE_2_PROVIDER_ID,
      modelProvenance: 'requested-label' as const,
      liveEnabled: true,
      browserKeyStorage: 'browser_local_storage_only' as const,
      strictExactModelRequired: false,
    };
  if (strictBlock) {
    return {
      localCodex: {
        available: false,
        reason: strictBlock.reason,
        model: strictBlock.model,
        strictExactModelRequired: true,
        command,
        providerId: LOCAL_CODEX_PROVIDER_ID,
        modelProvenance: 'unverified' as const,
        proof: proof ?? undefined,
      },
      openaiGptImage2: openAiAvailability,
    };
  }

  return {
    localCodex: {
      available: true,
      reason: 'ready' as const,
      model,
      strictExactModelRequired: true,
      command,
      providerId: LOCAL_CODEX_PROVIDER_ID,
      modelProvenance: 'exact' as const,
      proof: proof!,
    },
    openaiGptImage2: openAiAvailability,
  };
}
