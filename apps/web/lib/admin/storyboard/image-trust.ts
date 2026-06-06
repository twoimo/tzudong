import type {
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
    )
  );
}

function isTrustedLegacyPersistedStoryboardImage(
  image: Partial<StoryboardSceneGeneratedImage>,
) {
  const warnings = Array.isArray(image.warnings) ? image.warnings : [];
  return (
    image.trustPolicy === undefined &&
    typeof image.dataUrl === 'string' &&
    /^\/qa-history\/storyboard\/generated\/[^?#]+\/cut-\d{2}\.png$/i.test(
      image.dataUrl,
    ) &&
    typeof image.prompt === 'string' &&
    /^Persisted local Codex GPT Image 2 storyboard panel for CUT \d+$/i.test(
      image.prompt.trim(),
    ) &&
    warnings.some(
      (warning) =>
        typeof warning === 'string' &&
        warning.includes('generated via local Codex OAuth provider') &&
        warning.includes('persisted for admin storyboard display'),
    )
  );
}

export function isTrustedStoryboardGeneratedImage(
  value: unknown,
): value is StoryboardSceneGeneratedImage {
  if (!value || typeof value !== 'object') return false;
  const image = value as Partial<StoryboardSceneGeneratedImage>;
  return (
    image.providerId === 'local-codex' &&
    image.model === 'gpt-image-2' &&
    isSupportedStoryboardImageMime(image.mime) &&
    hasStoryboardImageLocation(image.dataUrl) &&
    (image.trustPolicy === STORYBOARD_GENERATED_IMAGE_TRUST_POLICY ||
      isTrustedLegacyPersistedStoryboardImage(image))
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
