import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type {
  GeminiThumbnailImageModel,
  OpenAIThumbnailImageModel,
  ThumbnailGenerationResult,
  ThumbnailGeneratorPayload,
  ThumbnailProviderId,
  ThumbnailReferenceImage,
} from './types';
import {
  GEMINI_THUMBNAIL_IMAGE_MODELS,
  OPENAI_THUMBNAIL_IMAGE_MODELS,
  ThumbnailGenerationError,
  YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
  YOUTUBE_THUMBNAIL_TARGET_WIDTH,
} from './types';
import { buildYoutubeThumbnailPrompt } from './prompt';

const execFileAsync = promisify(execFile);

const OPENAI_KEY_NAMES = ['OPENAI_API_KEY', 'STORYBOARD_AGENT_OPENAI_API_KEY'] as const;
const GEMINI_KEY_NAMES = ['GEMINI_API_KEY', 'STORYBOARD_AGENT_GEMINI_API_KEY', 'GOOGLE_API_KEY', 'NANO_BANANA_2_API_KEY', 'NANO_BANANA_API_KEY', 'STORYBOARD_AGENT_NANO_BANANA_API_KEY', 'STORYBOARD_AGENT_IMAGE_API_KEY'] as const;
const EXACT_OPENAI_THUMBNAIL_MODEL = 'gpt-image-2' satisfies OpenAIThumbnailImageModel;
const LOCAL_CODEX_DEFAULT_MODEL = 'requested:gpt-image-2';
const LOCAL_CODEX_TIMEOUT_MS = 720_000;
const LOCAL_CODEX_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const LOCAL_CODEX_DEFAULT_ARGS = [
  '--prompt-file',
  '{promptFile}',
  '--output',
  '{outputFile}',
  '--json-output',
  '{outputJsonFile}',
  '--reference-manifest',
  '{referenceManifestFile}',
  '--model',
  '{model}',
] as const;

type ProviderRuntimeInput = {
  payload: ThumbnailGeneratorPayload;
  referenceImages: ThumbnailReferenceImage[];
  prompt: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  runId?: string;
};

type ThumbnailProviderExecutionOptions = {
  signal?: AbortSignal;
  runId?: string;
};

export function isThumbnailProviderId(value: unknown): value is ThumbnailProviderId {
  return value === 'openai-gpt-image' || value === 'gemini-nano-banana' || value === 'local-codex';
}

function pickEnv(env: NodeJS.ProcessEnv, names: readonly string[]) {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function isOpenAIThumbnailImageModel(value: string): value is OpenAIThumbnailImageModel {
  return (OPENAI_THUMBNAIL_IMAGE_MODELS as readonly string[]).includes(value);
}

function isGeminiThumbnailImageModel(value: string): value is GeminiThumbnailImageModel {
  return (GEMINI_THUMBNAIL_IMAGE_MODELS as readonly string[]).includes(value);
}

export function resolveOpenAIThumbnailModel(env: NodeJS.ProcessEnv = process.env): OpenAIThumbnailImageModel {
  const configured = env.THUMBNAIL_OPENAI_IMAGE_MODEL?.trim() || EXACT_OPENAI_THUMBNAIL_MODEL;
  if (!isOpenAIThumbnailImageModel(configured) || configured !== EXACT_OPENAI_THUMBNAIL_MODEL) {
    throw new ThumbnailGenerationError(
      'unsupported_model',
      `이 썸네일 생성기는 정확한 GPT Image 2 API만 허용합니다: ${EXACT_OPENAI_THUMBNAIL_MODEL}`,
      400,
    );
  }
  return configured;
}

export function resolveGeminiThumbnailModel(env: NodeJS.ProcessEnv = process.env): GeminiThumbnailImageModel {
  const configured = env.THUMBNAIL_GEMINI_IMAGE_MODEL?.trim() || 'gemini-3-pro-image-preview';
  const aliases: Record<string, GeminiThumbnailImageModel> = {
    'nano-banana': 'gemini-2.5-flash-image',
    'nano-banana-pro': 'gemini-3-pro-image-preview',
  };
  const resolved = aliases[configured] ?? configured;
  if (!isGeminiThumbnailImageModel(resolved)) {
    throw new ThumbnailGenerationError('unsupported_model', `지원하지 않는 Gemini 이미지 모델입니다: ${configured}`, 400);
  }
  return resolved;
}

export function resolveLocalCodexThumbnailModel(env: NodeJS.ProcessEnv = process.env) {
  return env.THUMBNAIL_LOCAL_CODEX_IMAGE_MODEL?.trim() || LOCAL_CODEX_DEFAULT_MODEL;
}

function parseLocalCodexArgs(env: NodeJS.ProcessEnv) {
  const rawJson = env.THUMBNAIL_LOCAL_CODEX_ARGS_JSON?.trim();
  if (!rawJson) return [...LOCAL_CODEX_DEFAULT_ARGS];
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
      throw new Error('args must be a string array');
    }
    return parsed;
  } catch (error) {
    throw new ThumbnailGenerationError(
      'provider_unavailable',
      `THUMBNAIL_LOCAL_CODEX_ARGS_JSON은 문자열 배열 JSON이어야 합니다: ${error instanceof Error ? error.message : 'invalid json'}`,
      503,
    );
  }
}

function isLocalCodexGateOpen(env: NodeJS.ProcessEnv) {
  return env.NODE_ENV !== 'production' && env.ALLOW_LOCAL_CLI_THUMBNAIL === 'true';
}

function getLocalCodexCommand(env: NodeJS.ProcessEnv) {
  return env.THUMBNAIL_LOCAL_CODEX_COMMAND?.trim() || null;
}

function getLocalCodexTimeoutMs(env: NodeJS.ProcessEnv) {
  const configured = Number(env.THUMBNAIL_LOCAL_CODEX_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 5_000 && configured <= 900_000) return configured;
  return LOCAL_CODEX_TIMEOUT_MS;
}

function detectGeneratedImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

type LocalCodexJsonResult = {
  dataUrl?: unknown;
  b64_json?: unknown;
  base64?: unknown;
  mime?: unknown;
  model?: unknown;
  warnings?: unknown;
  path?: unknown;
};

function parseLocalCodexJson(text: string): LocalCodexJsonResult | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const jsonCandidate = trimmed.startsWith('{')
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0] ?? '';
  if (!jsonCandidate) return null;
  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as LocalCodexJsonResult : null;
  } catch {
    return null;
  }
}


function resolveLocalCodexResultPath(workDir: string, outputPath: unknown) {
  if (typeof outputPath !== 'string' || !outputPath.trim()) return null;
  const rawPath = outputPath.trim();
  if (isAbsolute(rawPath)) return null;
  const normalizedWorkDir = resolve(workDir);
  const candidate = resolve(normalizedWorkDir, rawPath);
  const relativePath = relative(normalizedWorkDir, candidate);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  return candidate;
}

function normalizeLocalDataUrl(dataUrl: unknown) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) return null;
  return {
    mime: match[1] as 'image/png' | 'image/jpeg' | 'image/webp',
    dataUrl: `data:${match[1]};base64,${match[2].replace(/\s+/g, '')}`,
  };
}

function normalizeLocalBase64(base64: unknown, mime: unknown) {
  if (typeof base64 !== 'string' || !base64.trim()) return null;
  const normalizedMime = mime === 'image/jpeg' || mime === 'image/webp' ? mime : 'image/png';
  const normalizedBase64 = base64.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(normalizedBase64)) return null;
  return {
    mime: normalizedMime,
    dataUrl: `data:${normalizedMime};base64,${normalizedBase64}`,
  };
}

async function readLocalCodexImageFromJson(result: LocalCodexJsonResult | null, workDir: string, fallbackModel: string) {
  const fromDataUrl = normalizeLocalDataUrl(result?.dataUrl);
  if (fromDataUrl) {
    return {
      ...fromDataUrl,
      model: typeof result?.model === 'string' && result.model.trim() ? result.model.trim() : fallbackModel,
      warnings: Array.isArray(result?.warnings) ? result.warnings.filter((warning): warning is string => typeof warning === 'string') : [],
    };
  }

  const fromBase64 = normalizeLocalBase64(result?.b64_json ?? result?.base64, result?.mime);
  if (fromBase64) {
    return {
      ...fromBase64,
      model: typeof result?.model === 'string' && result.model.trim() ? result.model.trim() : fallbackModel,
      warnings: Array.isArray(result?.warnings) ? result.warnings.filter((warning): warning is string => typeof warning === 'string') : [],
    };
  }

  const outputPath = resolveLocalCodexResultPath(workDir, result?.path);
  if (!outputPath) return null;
  const bytes = await readFile(outputPath);
  if (bytes.byteLength > LOCAL_CODEX_MAX_OUTPUT_BYTES) return null;
  const mime = detectGeneratedImageMime(bytes);
  if (!mime) return null;
  return {
    mime,
    dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
    model: typeof result?.model === 'string' && result.model.trim() ? result.model.trim() : fallbackModel,
    warnings: Array.isArray(result?.warnings) ? result.warnings.filter((warning): warning is string => typeof warning === 'string') : [],
  };
}

async function readLocalCodexOutput(stdout: string, outputJsonFile: string, outputFile: string, workDir: string, model: string) {
  const stdoutResult = await readLocalCodexImageFromJson(parseLocalCodexJson(stdout), workDir, model);
  if (stdoutResult) return stdoutResult;

  const jsonFile = await readFile(outputJsonFile, 'utf8').catch(() => null);
  if (jsonFile) {
    const fileResult = await readLocalCodexImageFromJson(parseLocalCodexJson(jsonFile), workDir, model);
    if (fileResult) return fileResult;
  }

  const bytes = await readFile(outputFile).catch(() => null);
  if (bytes && bytes.byteLength <= LOCAL_CODEX_MAX_OUTPUT_BYTES) {
    const mime = detectGeneratedImageMime(bytes);
    if (mime) {
      return {
        mime,
        dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
        model,
        warnings: [],
      };
    }
  }

  return null;
}

function renderLocalCodexArgTemplate(value: string, replacements: Record<string, string>) {
  return value.replace(/\{(promptFile|outputFile|outputJsonFile|referenceManifestFile|workDir|model|width|height)\}/g, (_, key: string) => replacements[key] ?? '');
}

function assertLiveApiEnabled(env: NodeJS.ProcessEnv) {
  if (env.THUMBNAIL_GENERATOR_ENABLE_LIVE_API !== '1') {
    throw new ThumbnailGenerationError('provider_unavailable', '라이브 이미지 API는 THUMBNAIL_GENERATOR_ENABLE_LIVE_API=1 일 때만 실행합니다.', 503);
  }
}

function isAbortError(error: unknown) {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted')));
}

function throwIfProviderAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ThumbnailGenerationError('thumbnail_generation_aborted', '썸네일 이미지 생성 작업이 취소되었습니다.', 499);
  }
}

function createLinkedTimeoutSignal(source: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), timeoutMs);
  const abort = () => controller.abort(source?.reason);
  source?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      source?.removeEventListener('abort', abort);
    },
  };
}

async function generateOpenAIThumbnail(input: ProviderRuntimeInput): Promise<ThumbnailGenerationResult> {
  const env = input.env ?? process.env;
  throwIfProviderAborted(input.signal);
  assertLiveApiEnabled(env);
  const apiKey = pickEnv(env, OPENAI_KEY_NAMES);
  if (!apiKey) throw new ThumbnailGenerationError('provider_unavailable', 'OpenAI 서버 키가 설정되지 않았습니다.', 503);
  const model = resolveOpenAIThumbnailModel(env);
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey });
  const response = await (async () => {
    try {
      return input.signal
        ? await client.images.generate({ model, prompt: input.prompt, size: '1536x864' as never, n: 1 }, { signal: input.signal })
        : await client.images.generate({ model, prompt: input.prompt, size: '1536x864' as never, n: 1 });
    } catch (error) {
      if (isAbortError(error)) {
        throw new ThumbnailGenerationError('thumbnail_generation_aborted', '썸네일 이미지 생성 작업이 취소되었습니다.', 499);
      }
      throw error;
    }
  })();
  const image = response.data?.[0];
  const b64 = image && 'b64_json' in image ? image.b64_json : null;
  if (!b64) throw new ThumbnailGenerationError('provider_unavailable', 'OpenAI 이미지 응답에 base64 데이터가 없습니다.', 503);
  return {
    baseImage: {
      dataUrl: `data:image/png;base64,${b64}`,
      mime: 'image/png',
      targetWidth: YOUTUBE_THUMBNAIL_TARGET_WIDTH,
      targetHeight: YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
      providerId: 'openai-gpt-image',
      model,
      modelProvenance: 'exact',
    },
    prompt: input.prompt,
    warnings: [`live_provider_exact_gpt_image_2: OpenAI Images API에 model=${model}로 직접 요청했습니다. 업로드 전 사람이 검수해야 합니다.`],
  };
}

async function generateGeminiThumbnail(input: ProviderRuntimeInput): Promise<ThumbnailGenerationResult> {
  const env = input.env ?? process.env;
  throwIfProviderAborted(input.signal);
  assertLiveApiEnabled(env);
  const apiKey = pickEnv(env, GEMINI_KEY_NAMES);
  if (!apiKey) throw new ThumbnailGenerationError('provider_unavailable', 'Gemini/Nano Banana 서버 키가 설정되지 않았습니다.', 503);
  const model = resolveGeminiThumbnailModel(env);
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
  for (const image of input.referenceImages.slice(0, 8)) {
    parts.push({ inlineData: { mimeType: image.mime, data: Buffer.from(image.bytes).toString('base64') } });
  }
  const timeoutSignal = createLinkedTimeoutSignal(input.signal, 90_000);
  const response = await (async () => {
    try {
      return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ parts }] }),
        signal: timeoutSignal.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new ThumbnailGenerationError('thumbnail_generation_aborted', '썸네일 이미지 생성 작업이 취소되었습니다.', 499);
      }
      throw error;
    } finally {
      timeoutSignal.cleanup();
    }
  })();
  if (!response.ok) throw new ThumbnailGenerationError('provider_unavailable', `Gemini 이미지 생성 실패: ${response.status}`, 503);
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
  const inline = payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((part) => part.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new ThumbnailGenerationError('provider_unavailable', 'Gemini 이미지 응답에 inline image 데이터가 없습니다.', 503);
  const mime = inline.mimeType === 'image/jpeg' || inline.mimeType === 'image/webp' ? inline.mimeType : 'image/png';
  return {
    baseImage: {
      dataUrl: `data:${mime};base64,${inline.data}`,
      mime,
      targetWidth: YOUTUBE_THUMBNAIL_TARGET_WIDTH,
      targetHeight: YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
      providerId: 'gemini-nano-banana',
      model,
      modelProvenance: 'unknown',
    },
    prompt: input.prompt,
    warnings: ['live_provider: Gemini/Nano Banana 결과는 업로드 전 사람이 검수해야 합니다.'],
  };
}

export async function probeLocalCodex(env: NodeJS.ProcessEnv = process.env) {
  if (!isLocalCodexGateOpen(env)) {
    return { available: false, reason: env.NODE_ENV === 'production' ? 'local_codex_disabled_in_production' : 'local_codex_gate_disabled' } as const;
  }

  const command = getLocalCodexCommand(env);
  if (!command) {
    return { available: false, reason: 'local_codex_command_not_configured', model: resolveLocalCodexThumbnailModel(env) } as const;
  }

  return {
    available: true,
    reason: 'local_codex_command_configured',
    command,
    model: resolveLocalCodexThumbnailModel(env),
  } as const;
}

async function generateLocalCodexThumbnail(input: ProviderRuntimeInput): Promise<ThumbnailGenerationResult> {
  const env = input.env ?? process.env;
  throwIfProviderAborted(input.signal);
  const probe = await probeLocalCodex(env);
  if (!probe.available) {
    throw new ThumbnailGenerationError('provider_unavailable', `Local Codex 이미지 생성이 준비되지 않았습니다: ${probe.reason}`, 503);
  }

  const command = getLocalCodexCommand(env);
  if (!command) {
    throw new ThumbnailGenerationError('provider_unavailable', 'THUMBNAIL_LOCAL_CODEX_COMMAND가 설정되지 않았습니다.', 503);
  }

  const model = resolveLocalCodexThumbnailModel(env);
  const workDir = await mkdtemp(join(tmpdir(), 'tzudong-local-codex-thumbnail-'));
  try {
    const promptFile = join(workDir, 'prompt.txt');
    const outputFile = join(workDir, 'thumbnail.png');
    const outputJsonFile = join(workDir, 'result.json');
    const referenceManifestFile = join(workDir, 'references.json');
    const references = [] as Array<{ name: string; mime: string; role: string; path: string }>;

    await writeFile(promptFile, input.prompt, 'utf8');
    for (const [index, image] of input.referenceImages.entries()) {
      const extension = image.mime === 'image/jpeg' ? 'jpg' : image.mime === 'image/webp' ? 'webp' : 'png';
      const imagePath = join(workDir, `reference-${index + 1}.${extension}`);
      await writeFile(imagePath, image.bytes);
      references.push({ name: image.name, mime: image.mime, role: image.role, path: imagePath });
    }
    await writeFile(referenceManifestFile, JSON.stringify(references, null, 2), 'utf8');

    const replacements = {
      promptFile,
      outputFile,
      outputJsonFile,
      referenceManifestFile,
      workDir,
      model,
      width: String(YOUTUBE_THUMBNAIL_TARGET_WIDTH),
      height: String(YOUTUBE_THUMBNAIL_TARGET_HEIGHT),
    };
    const args = parseLocalCodexArgs(env).map((arg) => renderLocalCodexArgTemplate(arg, replacements));
    const result = await execFileAsync(command, args, {
      timeout: getLocalCodexTimeoutMs(env),
      maxBuffer: 16 * 1024 * 1024,
      cwd: workDir,
      env: { ...process.env, ...env, THUMBNAIL_GENERATION_RUN_ID: input.runId ?? '' },
      signal: input.signal,
    });
    const image = await readLocalCodexOutput(result.stdout, outputJsonFile, outputFile, workDir, model);
    if (!image) {
      const stderr = result.stderr.trim().slice(0, 300);
      throw new ThumbnailGenerationError('provider_unavailable', `Local Codex 출력에서 이미지 데이터를 찾지 못했습니다.${stderr ? ` stderr: ${stderr}` : ''}`, 503);
    }

    return {
      baseImage: {
        dataUrl: image.dataUrl,
        mime: image.mime as 'image/png' | 'image/jpeg' | 'image/webp',
        targetWidth: YOUTUBE_THUMBNAIL_TARGET_WIDTH,
        targetHeight: YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
        providerId: 'local-codex',
        model: image.model,
        modelProvenance: 'requested-label',
      },
      prompt: input.prompt,
      warnings: [
        'local_codex_provider_opaque: 로컬 Codex built-in $imagegen 결과입니다. gpt-image-2는 요청 라벨일 뿐, backend model 확정 증거가 아니므로 업로드 전 사람이 검수해야 합니다.',
        ...image.warnings,
      ],
    };
  } catch (error) {
    if (error instanceof ThumbnailGenerationError) throw error;
    if (isAbortError(error)) {
      throw new ThumbnailGenerationError('thumbnail_generation_aborted', '썸네일 이미지 생성 작업이 취소되었습니다.', 499);
    }
    const stderr = typeof (error as { stderr?: unknown }).stderr === 'string'
      ? (error as { stderr: string }).stderr.trim().slice(-800)
      : '';
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new ThumbnailGenerationError(
      'provider_unavailable',
      `Local Codex 실행 실패: ${reason}${stderr ? ` stderr: ${stderr}` : ''}`,
      503,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function generateYoutubeThumbnailWithPrompt(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[],
  prompt: string,
  env: NodeJS.ProcessEnv = process.env,
  options: ThumbnailProviderExecutionOptions = {},
): Promise<ThumbnailGenerationResult> {
  const input = { payload, referenceImages, prompt, env, ...options };
  switch (payload.providerId) {
    case 'openai-gpt-image':
      return generateOpenAIThumbnail(input);
    case 'gemini-nano-banana':
      return generateGeminiThumbnail(input);
    case 'local-codex':
      return generateLocalCodexThumbnail(input);
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
  const openaiModel = (() => {
    try { return resolveOpenAIThumbnailModel(env); } catch { return null; }
  })();
  const geminiModel = (() => {
    try { return resolveGeminiThumbnailModel(env); } catch { return null; }
  })();
  const liveEnabled = env.THUMBNAIL_GENERATOR_ENABLE_LIVE_API === '1';
  return {
    openai: { available: Boolean(liveEnabled && openaiModel && pickEnv(env, OPENAI_KEY_NAMES)), model: openaiModel, liveEnabled },
    gemini: { available: Boolean(liveEnabled && geminiModel && pickEnv(env, GEMINI_KEY_NAMES)), model: geminiModel, liveEnabled },
    localCodex: (() => {
      if (!isLocalCodexGateOpen(env)) return { available: false, reason: env.NODE_ENV === 'production' ? 'local_codex_disabled_in_production' : 'local_codex_gate_disabled', model: resolveLocalCodexThumbnailModel(env) };
      const command = getLocalCodexCommand(env);
      return command
        ? { available: true, reason: 'local_codex_command_configured', command, model: resolveLocalCodexThumbnailModel(env) }
        : { available: false, reason: 'local_codex_command_not_configured', model: resolveLocalCodexThumbnailModel(env) };
    })(),
  };
}
