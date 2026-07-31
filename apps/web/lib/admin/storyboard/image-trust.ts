import type {
  StoryboardGeneratedImageProvenance,
  StoryboardGenerationResult,
  StoryboardSceneGeneratedImage,
} from './types';

export const STORYBOARD_GENERATED_IMAGE_TRUST_POLICY = 'storyboard-gpt-image-2-panel-v1' as const;

function isSupportedStoryboardImageMime(value: unknown) {
  return (
    value === 'image/png' ||
    value === 'image/jpeg' ||
    value === 'image/webp'
  );
}

function hasStoryboardImageLocation(value: unknown) {
  if (typeof value !== 'string') return false;
  return (
    /^data:image\/(?:png|jpeg|webp);base64,/i.test(value) ||
    /^\/qa-history\/storyboard\/generated\/[^?#]+\/cut-\d{2}\.png$/i.test(
      value,
    ) ||
    /^\/storyboard-seed\/generated\/cut-\d{2}\.png$/i.test(
      value,
    )
  );
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isExactLocalCodexStoryboardProvenance(
  provenance: Partial<StoryboardGeneratedImageProvenance>,
) {
  return (
    provenance.providerId === 'local-codex' &&
    provenance.authMode === 'codex_oauth' &&
    provenance.endpoint === 'https://chatgpt.com/backend-api/codex/responses' &&
    provenance.hasOpenAIAPIKey === false
  );
}

function isExactBrowserOpenAIStoryboardProvenance(
  provenance: Partial<StoryboardGeneratedImageProvenance>,
) {
  return (
    provenance.providerId === 'browser-openai-api-key' &&
    provenance.authMode === 'browser_memory_only_api_key' &&
    provenance.endpoint === 'https://api.openai.com/v1/images/generations' &&
    provenance.hasOpenAIAPIKey === true
  );
}

export function isExactStoryboardGeneratedImageProvenance(
  value: unknown,
): value is StoryboardGeneratedImageProvenance {
  if (!value || typeof value !== 'object') return false;
  const provenance = value as Partial<StoryboardGeneratedImageProvenance>;
  return (
    (
      isExactLocalCodexStoryboardProvenance(provenance) ||
      isExactBrowserOpenAIStoryboardProvenance(provenance)
    ) &&
    provenance.requestToolType === 'image_generation' &&
    provenance.requestToolModel === 'gpt-image-2' &&
    provenance.model === 'gpt-image-2' &&
    provenance.modelProvenance === 'exact' &&
    typeof provenance.responseId === 'string' &&
    provenance.responseId.trim().length > 0 &&
    typeof provenance.imageCallId === 'string' &&
    provenance.imageCallId.trim().length > 0 &&
    typeof provenance.imageItemCount === 'number' &&
    provenance.imageItemCount > 0 &&
    Array.isArray(provenance.rawImageItemTypes) &&
    provenance.rawImageItemTypes[0] === 'image_generation_call' &&
    (!Array.isArray(provenance.generatedImageItemTypes) ||
      provenance.generatedImageItemTypes.includes('image_generation_call')) &&
    isSha256Hex(provenance.requestHash) &&
    isSha256Hex(provenance.responseHash) &&
    typeof provenance.generatedAt === 'string' &&
    Number.isFinite(Date.parse(provenance.generatedAt))
  );
}

export function getExactStoryboardGeneratedImageProvenance(
  value: unknown,
): StoryboardGeneratedImageProvenance | null {
  return isExactStoryboardGeneratedImageProvenance(value) ? value : null;
}

export function isTrustedStoryboardGeneratedImage(
  value: unknown,
): value is StoryboardSceneGeneratedImage {
  if (!value || typeof value !== 'object') return false;
  const image = value as Partial<StoryboardSceneGeneratedImage>;
  return (
    (
      image.providerId === 'local-codex' ||
      image.providerId === 'browser-openai-api-key'
    ) &&
    image.model === 'gpt-image-2' &&
    isSupportedStoryboardImageMime(image.mime) &&
    hasStoryboardImageLocation(image.dataUrl) &&
    isExactStoryboardGeneratedImageProvenance(image.provenance) &&
    image.trustPolicy === STORYBOARD_GENERATED_IMAGE_TRUST_POLICY
  );
}

export function getTrustedStoryboardGeneratedImage(
  value: unknown,
): StoryboardSceneGeneratedImage | null {
  return isTrustedStoryboardGeneratedImage(value) ? value : null;
}

export function countTrustedStoryboardGeneratedImages(
  scenes: StoryboardGenerationResult['storyboard']['scenes'],
) {
  return scenes.filter((scene) =>
    isTrustedStoryboardGeneratedImage(scene.generatedImage),
  ).length;
}

export function stripUntrustedStoryboardGeneratedImages(
  result: StoryboardGenerationResult,
): StoryboardGenerationResult {
  return {
    ...result,
    storyboard: {
      ...result.storyboard,
      scenes: result.storyboard.scenes.map((scene) => {
        if (
          !scene.generatedImage ||
          isTrustedStoryboardGeneratedImage(scene.generatedImage)
        ) {
          return scene;
        }
        const safeScene = { ...scene };
        delete safeScene.generatedImage;
        return safeScene;
      }),
    },
  };
}
