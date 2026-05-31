import { execFile } from 'node:child_process';
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

type ProviderRuntimeInput = {
  payload: ThumbnailGeneratorPayload;
  referenceImages: ThumbnailReferenceImage[];
  prompt: string;
  env?: NodeJS.ProcessEnv;
};

export function isThumbnailProviderId(value: unknown): value is ThumbnailProviderId {
  return value === 'mock' || value === 'openai-gpt-image' || value === 'gemini-nano-banana' || value === 'local-codex';
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
  const configured = env.THUMBNAIL_OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-1.5';
  if (!isOpenAIThumbnailImageModel(configured)) {
    throw new ThumbnailGenerationError('unsupported_model', `지원하지 않는 OpenAI 이미지 모델입니다: ${configured}`, 400);
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

function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function generateMockThumbnail(input: ProviderRuntimeInput): ThumbnailGenerationResult {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#ff7a1a"/><stop offset="0.55" stop-color="#cf152d"/><stop offset="1" stop-color="#201017"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity="0.45"/></filter></defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <circle cx="1070" cy="200" r="150" fill="#fff1"/><circle cx="1005" cy="210" r="92" fill="#ffe8c9" filter="url(#shadow)"/>
  <ellipse cx="360" cy="610" rx="430" ry="140" fill="#3a160a" opacity="0.85"/><ellipse cx="260" cy="535" rx="170" ry="72" fill="#f4d18b"/><ellipse cx="525" cy="560" rx="210" ry="84" fill="#ffc13b"/><ellipse cx="750" cy="610" rx="220" ry="92" fill="#d83f18"/>
  <rect x="70" y="95" width="760" height="220" rx="34" fill="#0006" filter="url(#shadow)"/>
  <rect x="115" y="145" width="510" height="42" rx="21" fill="#fff8"/>
  <rect x="115" y="220" width="650" height="58" rx="29" fill="#fff9"/>
  <circle cx="960" cy="430" r="62" fill="#fff8" stroke="#1118" stroke-width="10"/>
</svg>`;

  return {
    baseImage: {
      dataUrl: svgToDataUrl(svg),
      mime: 'image/svg+xml',
      width: YOUTUBE_THUMBNAIL_TARGET_WIDTH,
      height: YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
      targetWidth: YOUTUBE_THUMBNAIL_TARGET_WIDTH,
      targetHeight: YOUTUBE_THUMBNAIL_TARGET_HEIGHT,
      providerId: 'mock',
      model: 'mock-svg-v1',
    },
    prompt: input.prompt,
    warnings: ['mock_provider: 실제 이미지 API 호출 없이 검증용 SVG를 생성했습니다.'],
  };
}

function assertLiveApiEnabled(env: NodeJS.ProcessEnv) {
  if (env.THUMBNAIL_GENERATOR_ENABLE_LIVE_API !== '1') {
    throw new ThumbnailGenerationError('provider_unavailable', '라이브 이미지 API는 THUMBNAIL_GENERATOR_ENABLE_LIVE_API=1 일 때만 실행합니다.', 503);
  }
}

async function generateOpenAIThumbnail(input: ProviderRuntimeInput): Promise<ThumbnailGenerationResult> {
  const env = input.env ?? process.env;
  assertLiveApiEnabled(env);
  const apiKey = pickEnv(env, OPENAI_KEY_NAMES);
  if (!apiKey) throw new ThumbnailGenerationError('provider_unavailable', 'OpenAI 서버 키가 설정되지 않았습니다.', 503);
  const model = resolveOpenAIThumbnailModel(env);
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey });
  const response = await client.images.generate({ model, prompt: input.prompt, size: '1536x864' as never, n: 1 });
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
    },
    prompt: input.prompt,
    warnings: ['live_provider: OpenAI 결과는 업로드 전 사람이 검수해야 합니다.'],
  };
}

async function generateGeminiThumbnail(input: ProviderRuntimeInput): Promise<ThumbnailGenerationResult> {
  const env = input.env ?? process.env;
  assertLiveApiEnabled(env);
  const apiKey = pickEnv(env, GEMINI_KEY_NAMES);
  if (!apiKey) throw new ThumbnailGenerationError('provider_unavailable', 'Gemini/Nano Banana 서버 키가 설정되지 않았습니다.', 503);
  const model = resolveGeminiThumbnailModel(env);
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
  for (const image of input.referenceImages.slice(0, 8)) {
    parts.push({ inlineData: { mimeType: image.mime, data: Buffer.from(image.bytes).toString('base64') } });
  }
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts }] }),
    signal: AbortSignal.timeout(90_000),
  });
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
    },
    prompt: input.prompt,
    warnings: ['live_provider: Gemini/Nano Banana 결과는 업로드 전 사람이 검수해야 합니다.'],
  };
}

export async function probeLocalCodex(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === 'production' || env.ALLOW_LOCAL_CLI_THUMBNAIL !== 'true') {
    return { available: false, reason: 'local_codex_probe_disabled' } as const;
  }
  try {
    const version = await execFileAsync('codex', ['--version'], { timeout: 5_000, maxBuffer: 64 * 1024 });
    const help = await execFileAsync('codex', ['--help'], { timeout: 5_000, maxBuffer: 64 * 1024 });
    return {
      available: true,
      reason: 'codex_cli_available_but_image_output_command_unverified',
      version: version.stdout.trim(),
      supportsImageInput: help.stdout.includes('--image'),
    } as const;
  } catch {
    return { available: false, reason: 'codex_cli_not_available' } as const;
  }
}

async function generateLocalCodexThumbnail(input: ProviderRuntimeInput): Promise<ThumbnailGenerationResult> {
  const probe = await probeLocalCodex(input.env ?? process.env);
  throw new ThumbnailGenerationError('provider_unavailable', `Codex CLI 이미지 출력 명령이 검증되지 않았습니다: ${probe.reason}`, 503);
}

export async function generateYoutubeThumbnail(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<ThumbnailGenerationResult> {
  const prompt = buildYoutubeThumbnailPrompt(payload, referenceImages);
  const input = { payload, referenceImages, prompt, env };
  switch (payload.providerId) {
    case 'mock':
      return generateMockThumbnail(input);
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

export function getThumbnailProviderAvailability(env: NodeJS.ProcessEnv = process.env) {
  const openaiModel = (() => {
    try { return resolveOpenAIThumbnailModel(env); } catch { return null; }
  })();
  const geminiModel = (() => {
    try { return resolveGeminiThumbnailModel(env); } catch { return null; }
  })();
  return {
    mock: { available: true, model: 'mock-svg-v1' },
    openai: { available: Boolean(openaiModel && pickEnv(env, OPENAI_KEY_NAMES)), model: openaiModel, liveEnabled: env.THUMBNAIL_GENERATOR_ENABLE_LIVE_API === '1' },
    gemini: { available: Boolean(geminiModel && pickEnv(env, GEMINI_KEY_NAMES)), model: geminiModel, liveEnabled: env.THUMBNAIL_GENERATOR_ENABLE_LIVE_API === '1' },
    localCodex: { available: false, reason: 'codex_image_output_command_unverified' },
  };
}
