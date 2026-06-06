import type { StoryboardScene } from './types';
import { getTrustedStoryboardGeneratedImage } from './image-trust';

export function getVisibleTrustedStoryboardScenes(
  scenes: StoryboardScene[],
): StoryboardScene[] {
  return scenes.filter((scene) =>
    Boolean(getTrustedStoryboardGeneratedImage(scene.generatedImage)),
  );
}

export function getOmittedStoryboardSceneCount(scenes: StoryboardScene[]) {
  return Math.max(
    0,
    scenes.length - getVisibleTrustedStoryboardScenes(scenes).length,
  );
}

export function getStoryboardImageGenerationTargetScenes({
  allScenes,
  visibleScenes,
  page,
  pageSize,
}: {
  allScenes: StoryboardScene[];
  visibleScenes: StoryboardScene[];
  page: number;
  pageSize: number;
}): StoryboardScene[] {
  const safePage = Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0;
  const safePageSize = Number.isFinite(pageSize)
    ? Math.max(1, Math.trunc(pageSize))
    : 1;
  const visiblePageScenes = visibleScenes.slice(
    safePage * safePageSize,
    safePage * safePageSize + safePageSize,
  );

  if (visiblePageScenes.length > 0) return visiblePageScenes;
  if (safePage > 0) return [];
  return allScenes.slice(0, safePageSize);
}
