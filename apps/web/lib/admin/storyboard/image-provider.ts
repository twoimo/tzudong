import type {
  StoryboardGenerateRequest,
  StoryboardScene,
  StoryboardSceneGeneratedImage,
} from './types';

const STORYBOARD_IMAGE_TARGET_WIDTH = 1280 as const;
const STORYBOARD_IMAGE_TARGET_HEIGHT = 720 as const;
const LOCAL_CODEX_DEFAULT_MODEL = 'gpt-image-2';
const LOCAL_CODEX_ALLOWED_MODEL = 'gpt-image-2';

type StoryboardImageContext = {
  title: string;
  logline: string;
  request: StoryboardGenerateRequest;
};

export type StoryboardImageProviderAvailability = {
  available: false;
  reason:
    | 'local_codex_model_not_allowed'
    | 'local_codex_model_provenance_unverified';
  command?: string;
  model: string;
  target: {
    width: typeof STORYBOARD_IMAGE_TARGET_WIDTH;
    height: typeof STORYBOARD_IMAGE_TARGET_HEIGHT;
    aspectRatio: '16:9';
  };
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

export function resolveLocalCodexStoryboardModel(env: NodeJS.ProcessEnv = process.env) {
  return env.STORYBOARD_LOCAL_CODEX_IMAGE_MODEL?.trim()
    || LOCAL_CODEX_DEFAULT_MODEL;
}

function isAllowedLocalCodexStoryboardModel(model: string) {
  return model === LOCAL_CODEX_ALLOWED_MODEL;
}

function getLocalCodexCommand(env: NodeJS.ProcessEnv) {
  return env.STORYBOARD_LOCAL_CODEX_COMMAND?.trim() || undefined;
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

  if (!isAllowedLocalCodexStoryboardModel(model)) {
    return {
      available: false,
      reason: 'local_codex_model_not_allowed',
      command: getLocalCodexCommand(env),
      model,
      target,
    };
  }

  return {
    available: false,
    reason: 'local_codex_model_provenance_unverified',
    command: getLocalCodexCommand(env),
    model,
    target,
  };
}

function trimForPrompt(value: string, maxLength: number) {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

export function buildStoryboardSceneImagePrompt(scene: StoryboardScene, context: StoryboardImageContext) {
  return [
    'Create exactly one 16:9 raster storyboard panel for a Korean food-travel / mukbang planning board.',
    'Style: hand-drawn storyboard sketch, clean black pencil lines, subtle warm food-color accents, cinematic composition, no UI chrome.',
    'Safety: do not recreate a real person likeness; no recognizable face, no face close-up, and no detailed eyes/nose/mouth. Prefer cropped hands, chopsticks, food, over-shoulder silhouette, back-of-head silhouette, or face outside frame. No logos, watermarks, readable brand names, URLs, prices, or final typography.',
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
  void scene;
  void context;
  const availability = getStoryboardImageProviderAvailability(env);
  throw new StoryboardImageGenerationError(
    'provider_unavailable',
    `Local Codex 스토리보드 이미지 생성은 exact ${LOCAL_CODEX_ALLOWED_MODEL} backend provenance를 증명할 수 없어 중단되었습니다: ${availability.reason}`,
    503,
  );
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
