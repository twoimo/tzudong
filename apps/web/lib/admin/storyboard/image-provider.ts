import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  isTrustedStoryboardGeneratedImage,
  STORYBOARD_GENERATED_IMAGE_TRUST_POLICY,
} from './image-trust';
import type {
  StoryboardGenerateRequest,
  StoryboardScene,
  StoryboardSceneGeneratedImage,
} from './types';

const execFileAsync = promisify(execFile);

const STORYBOARD_IMAGE_TARGET_WIDTH = 1280 as const;
const STORYBOARD_IMAGE_TARGET_HEIGHT = 720 as const;
const LOCAL_CODEX_DEFAULT_MODEL = 'gpt-image-2';
const LOCAL_CODEX_TIMEOUT_MS = 720_000;
const LOCAL_CODEX_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const LOCAL_CODEX_DEFAULT_ARGS = [
  '--prompt-file',
  '{promptFile}',
  '--output',
  '{outputFile}',
  '--json-output',
  '{outputJsonFile}',
  '--model',
  '{model}',
] as const;

type StoryboardImageContext = {
  title: string;
  logline: string;
  request: StoryboardGenerateRequest;
};

export type StoryboardImageProviderAvailability = {
  available: boolean;
  reason:
    | 'local_codex_command_configured'
    | 'local_codex_gate_disabled'
    | 'local_codex_disabled_in_production'
    | 'local_codex_command_not_configured';
  command?: string;
  model: string;
  target: {
    width: typeof STORYBOARD_IMAGE_TARGET_WIDTH;
    height: typeof STORYBOARD_IMAGE_TARGET_HEIGHT;
    aspectRatio: '16:9';
  };
};

type LocalCodexJsonResult = {
  dataUrl?: unknown;
  b64_json?: unknown;
  base64?: unknown;
  mime?: unknown;
  model?: unknown;
  warnings?: unknown;
  path?: unknown;
};

export class StoryboardImageGenerationError extends Error {
  constructor(
    public readonly code: 'provider_unavailable' | 'invalid_payload',
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'StoryboardImageGenerationError';
  }
}

function defaultStoryboardCommand() {
  const command = resolve(process.cwd(), '../../scripts/codex-imagegen-storyboard-provider.py');
  return existsSync(command) ? command : null;
}

function getLocalCodexCommand(env: NodeJS.ProcessEnv) {
  return env.STORYBOARD_LOCAL_CODEX_COMMAND?.trim() || defaultStoryboardCommand();
}

export function resolveLocalCodexStoryboardModel(env: NodeJS.ProcessEnv = process.env) {
  return env.STORYBOARD_LOCAL_CODEX_IMAGE_MODEL?.trim()
    || env.THUMBNAIL_LOCAL_CODEX_IMAGE_MODEL?.trim()
    || LOCAL_CODEX_DEFAULT_MODEL;
}

function isLocalCodexGateOpen(env: NodeJS.ProcessEnv) {
  return env.NODE_ENV !== 'production'
    && (env.ALLOW_LOCAL_CLI_STORYBOARD_IMAGES === 'true' || env.ALLOW_LOCAL_CLI_THUMBNAIL === 'true');
}

function getLocalCodexTimeoutMs(env: NodeJS.ProcessEnv) {
  const configured = Number(env.STORYBOARD_LOCAL_CODEX_TIMEOUT_MS ?? env.THUMBNAIL_LOCAL_CODEX_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 5_000 && configured <= 900_000) return configured;
  return LOCAL_CODEX_TIMEOUT_MS;
}

function parseLocalCodexArgs(env: NodeJS.ProcessEnv) {
  const rawJson = env.STORYBOARD_LOCAL_CODEX_ARGS_JSON?.trim();
  if (!rawJson) return [...LOCAL_CODEX_DEFAULT_ARGS];
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
      throw new Error('args must be a string array');
    }
    return parsed;
  } catch (error) {
    throw new StoryboardImageGenerationError(
      'provider_unavailable',
      `STORYBOARD_LOCAL_CODEX_ARGS_JSON은 문자열 배열 JSON이어야 합니다: ${error instanceof Error ? error.message : 'invalid json'}`,
      503,
    );
  }
}

export function getStoryboardImageProviderAvailability(
  env: NodeJS.ProcessEnv = process.env,
): StoryboardImageProviderAvailability {
  const model = resolveLocalCodexStoryboardModel(env);
  const target = {
    width: STORYBOARD_IMAGE_TARGET_WIDTH,
    height: STORYBOARD_IMAGE_TARGET_HEIGHT,
    aspectRatio: '16:9' as const,
  };

  if (!isLocalCodexGateOpen(env)) {
    return {
      available: false,
      reason: env.NODE_ENV === 'production' ? 'local_codex_disabled_in_production' : 'local_codex_gate_disabled',
      model,
      target,
    };
  }

  const command = getLocalCodexCommand(env);
  if (!command) {
    return {
      available: false,
      reason: 'local_codex_command_not_configured',
      model,
      target,
    };
  }

  return {
    available: true,
    reason: 'local_codex_command_configured',
    command,
    model,
    target,
  };
}

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

function detectGeneratedImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
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

  const outputPath = resolveLocalCodexOutputPath(result?.path, workDir);
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

function resolveLocalCodexOutputPath(value: unknown, workDir: string) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const rawPath = value.trim();
  if (isAbsolute(rawPath)) return null;

  const root = resolve(workDir);
  const outputPath = resolve(root, rawPath);
  const pathFromRoot = relative(root, outputPath);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    return null;
  }

  return outputPath;
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
  return value.replace(/\{(promptFile|outputFile|outputJsonFile|workDir|model|width|height|sceneNo)\}/g, (_, key: string) => replacements[key] ?? '');
}

function trimForPrompt(value: string, maxLength: number) {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

export function buildStoryboardSceneImagePrompt(scene: StoryboardScene, context: StoryboardImageContext) {
  return [
    'Create exactly one 16:9 raster storyboard panel for a Korean food-travel / mukbang planning board.',
    'Style: hand-drawn storyboard sketch, clean black pencil lines, subtle warm food-color accents, cinematic composition, no UI chrome.',
    'Safety: do not recreate a real person likeness; show a generic host silhouette or cropped hands only. No logos, watermarks, readable brand names, URLs, prices, or final typography.',
    `Storyboard title: ${trimForPrompt(context.title, 120)}`,
    `Overall logline: ${trimForPrompt(context.logline, 180)}`,
    `User brief: ${trimForPrompt(context.request.prompt, 220)}`,
    `CUT ${scene.sceneNo}: ${trimForPrompt(scene.title, 80)}`,
    `Visual direction: ${trimForPrompt(scene.visualDirection, 220)}`,
    `Operator intent: ${trimForPrompt(scene.operatorIntent, 180)}`,
    `Caption idea for mood only, do not render readable text: ${trimForPrompt(scene.captionIdea, 120)}`,
    `Heatmap evidence mood: ${scene.heatmapEvidence.peakTime}, replay score ${scene.heatmapEvidence.replayScore}.`,
    'Output only the image. Keep the panel readable as one frame inside a 2x2 storyboard grid.',
  ].join('\n');
}

export async function generateStoryboardSceneImage(
  scene: StoryboardScene,
  context: StoryboardImageContext,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoryboardSceneGeneratedImage> {
  const availability = getStoryboardImageProviderAvailability(env);
  if (!availability.available) {
    throw new StoryboardImageGenerationError(
      'provider_unavailable',
      `Local Codex 스토리보드 이미지 생성이 준비되지 않았습니다: ${availability.reason}`,
      503,
    );
  }

  const command = availability.command;
  if (!command) {
    throw new StoryboardImageGenerationError('provider_unavailable', 'STORYBOARD_LOCAL_CODEX_COMMAND가 설정되지 않았습니다.', 503);
  }

  const model = availability.model;
  const prompt = buildStoryboardSceneImagePrompt(scene, context);
  const workDir = await mkdtemp(join(tmpdir(), 'tzudong-local-codex-storyboard-'));
  try {
    const promptFile = join(workDir, `cut-${scene.sceneNo}-prompt.txt`);
    const outputFile = join(workDir, `cut-${scene.sceneNo}.png`);
    const outputJsonFile = join(workDir, `cut-${scene.sceneNo}.json`);
    await writeFile(promptFile, prompt, 'utf8');

    const replacements = {
      promptFile,
      outputFile,
      outputJsonFile,
      workDir,
      model,
      width: String(STORYBOARD_IMAGE_TARGET_WIDTH),
      height: String(STORYBOARD_IMAGE_TARGET_HEIGHT),
      sceneNo: String(scene.sceneNo),
    };
    const args = parseLocalCodexArgs(env).map((arg) => renderLocalCodexArgTemplate(arg, replacements));
    const result = await execFileAsync(command, args, {
      timeout: getLocalCodexTimeoutMs(env),
      maxBuffer: LOCAL_CODEX_MAX_OUTPUT_BYTES,
      cwd: workDir,
      env: { ...process.env, ...env },
    });
    const image = await readLocalCodexOutput(result.stdout, outputJsonFile, outputFile, workDir, model);
    if (!image) {
      const stderr = result.stderr.trim().slice(0, 300);
      throw new StoryboardImageGenerationError(
        'provider_unavailable',
        `Local Codex 출력에서 스토리보드 이미지 데이터를 찾지 못했습니다.${stderr ? ` stderr: ${stderr}` : ''}`,
        503,
      );
    }

    const generatedImage: StoryboardSceneGeneratedImage = {
      dataUrl: image.dataUrl,
      mime: image.mime as 'image/png' | 'image/jpeg' | 'image/webp',
      providerId: 'local-codex',
      trustPolicy: STORYBOARD_GENERATED_IMAGE_TRUST_POLICY,
      model: image.model,
      prompt,
      generatedAt: new Date().toISOString(),
      warnings: [
        'local_codex_provider: 로컬 Codex/GPT Image 결과는 게시 전 사람이 검수해야 합니다.',
        ...image.warnings,
      ],
    };

    if (!isTrustedStoryboardGeneratedImage(generatedImage)) {
      throw new StoryboardImageGenerationError(
        'provider_unavailable',
        'Local Codex 출력이 스토리보드 이미지 신뢰 정책을 통과하지 못했습니다.',
        503,
      );
    }

    return generatedImage;
  } catch (error) {
    if (error instanceof StoryboardImageGenerationError) throw error;
    const stderr = typeof (error as { stderr?: unknown }).stderr === 'string'
      ? (error as { stderr: string }).stderr.trim().slice(-800)
      : '';
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new StoryboardImageGenerationError(
      'provider_unavailable',
      `Local Codex 실행 실패: ${reason}${stderr ? ` stderr: ${stderr}` : ''}`,
      503,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function generateStoryboardSceneImages(
  scenes: StoryboardScene[],
  context: StoryboardImageContext,
  env: NodeJS.ProcessEnv = process.env,
) {
  const limitedScenes = scenes.slice(0, 4);
  const images: Array<{ sceneNo: number; image: StoryboardSceneGeneratedImage }> = [];
  for (const scene of limitedScenes) {
    images.push({
      sceneNo: scene.sceneNo,
      image: await generateStoryboardSceneImage(scene, context, env),
    });
  }
  return images;
}
